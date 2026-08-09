/**
 * Production asset uploads via Supabase Storage (server-side only).
 * Flow: create signed upload → client PUT → complete → signed download URL.
 * Optional workspace_id: shared path workspaces/{workspace_id}/... (editor+).
 */
import {
  setCors,
  handleOptions,
  requireUser,
  gateRouteRateLimit,
  sendRateLimitResponse,
  serviceHeaders
} from '../lib/security.js';
import {
  isUuid,
  assertWorkspaceRole,
  assertStoragePathAccess,
  EDIT_ROLES
} from '../lib/workspaces.js';

const BUCKET = 'production-assets';
const MAX_BYTES = 12 * 1024 * 1024; // 12MB
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
};

function clampStr(s, n) {
  return String(s || '').slice(0, n);
}

function safeId(s) {
  return String(s || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'upload',
    max: 30,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(200).json({
      ok: false,
      error: 'storage_unconfigured',
      message: 'File storage is not configured on this server yet.'
    });
  }

  const body = req.body || {};
  const action = body.action || 'create';
  const h = serviceHeaders();
  const userId = auth.user.id;

  try {
    if (action === 'create') {
      const productionId = safeId(body.production_id || body.productionId);
      const mime = String(body.mime || body.contentType || '').toLowerCase();
      const name = clampStr(body.name || body.filename || 'asset', 120);
      const size = Number(body.size) || 0;
      const workspaceId = body.workspace_id || body.workspaceId || null;
      if (!productionId) return res.status(400).json({ error: 'production_id required' });
      if (!ALLOWED[mime]) {
        return res.status(400).json({
          error: 'unsupported_type',
          message: 'That file type is not allowed.'
        });
      }
      if (size <= 0 || size > MAX_BYTES) {
        return res.status(400).json({
          error: 'file_too_large',
          message: 'Files must be under 12MB.'
        });
      }

      let pathPrefix = userId;
      if (workspaceId) {
        if (!isUuid(workspaceId)) {
          return res.status(400).json({ error: 'invalid_workspace_id' });
        }
        const access = await assertWorkspaceRole(userId, workspaceId, EDIT_ROLES);
        if (!access.ok) {
          return res.status(access.status || 403).json({
            error: access.error || 'forbidden',
            message: 'Shared uploads require owner or editor role.'
          });
        }
        if (access.workspace && access.workspace.kind === 'personal') {
          pathPrefix = userId;
        } else {
          pathPrefix = `workspaces/${workspaceId}`;
        }
      }

      const ext = ALLOWED[mime];
      const assetId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const path = `${pathPrefix}/${productionId}/${assetId}.${ext}`;

      await fetch(`${SUPA_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          id: BUCKET,
          name: BUCKET,
          public: false,
          file_size_limit: MAX_BYTES,
          allowed_mime_types: Object.keys(ALLOWED)
        })
      }).catch(function () {});

      const sign = await fetch(
        `${SUPA_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
        {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ expiresIn: 120 })
        }
      );
      const signed = await sign.json().catch(() => ({}));
      if (!sign.ok) {
        return res.status(200).json({
          ok: true,
          mode: 'direct',
          path,
          assetId,
          maxBytes: Math.min(MAX_BYTES, 900000),
          workspace_id: workspaceId || null,
          message: 'Use action=put for files under 900KB when signed upload is unavailable.'
        });
      }
      const token = signed.token || signed.signedToken;
      const uploadUrl = token
        ? `${SUPA_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(token)}`
        : signed.url || signed.signedUrl;
      return res.status(200).json({
        ok: true,
        mode: 'signed',
        path,
        assetId,
        uploadUrl,
        token: token || null,
        mime,
        name,
        workspace_id: workspaceId || null
      });
    }

    if (action === 'put') {
      const path = clampStr(body.path, 240);
      const mime = String(body.mime || '').toLowerCase();
      const b64 = String(body.data || '');
      const access = await assertStoragePathAccess(userId, path, { needEdit: true });
      if (!access.ok) {
        return res.status(access.status || 403).json({ error: access.error || 'forbidden_path' });
      }
      if (!ALLOWED[mime] || !b64) return res.status(400).json({ error: 'invalid_payload' });
      const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (buf.length > 900000) {
        return res.status(413).json({
          error: 'file_too_large',
          message: 'Direct upload max is 900KB. Use signed upload for larger files.'
        });
      }
      const up = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          ...h,
          'Content-Type': mime,
          'x-upsert': 'true'
        },
        body: buf
      });
      if (!up.ok) {
        const err = await up.text();
        return res.status(500).json({ error: 'upload_failed', detail: err.slice(0, 120) });
      }
      const signedGet = await fetch(`${SUPA_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 })
      });
      const sg = await signedGet.json().catch(() => ({}));
      const url = sg.signedURL
        ? `${SUPA_URL}/storage/v1${sg.signedURL}`
        : sg.signedUrl || null;
      return res.status(200).json({
        ok: true,
        path,
        url,
        size: buf.length,
        mime
      });
    }

    if (action === 'complete') {
      const path = clampStr(body.path, 240);
      const access = await assertStoragePathAccess(userId, path, { needEdit: false });
      if (!access.ok) {
        return res.status(access.status || 403).json({ error: access.error || 'forbidden_path' });
      }
      const signedGet = await fetch(`${SUPA_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 })
      });
      const sg = await signedGet.json().catch(() => ({}));
      if (!signedGet.ok) {
        return res.status(404).json({ error: 'not_found' });
      }
      const url = sg.signedURL
        ? `${SUPA_URL}/storage/v1${sg.signedURL}`
        : sg.signedUrl || null;
      return res.status(200).json({ ok: true, path, url });
    }

    if (action === 'delete') {
      const path = clampStr(body.path, 240);
      const access = await assertStoragePathAccess(userId, path, { needEdit: true });
      if (!access.ok) {
        return res.status(access.status || 403).json({ error: access.error || 'forbidden_path' });
      }
      await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: h,
        body: JSON.stringify({ prefixes: [path] })
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'sign_download') {
      const path = clampStr(body.path, 240);
      const access = await assertStoragePathAccess(userId, path, { needEdit: false });
      if (!access.ok) {
        return res.status(access.status || 403).json({ error: access.error || 'forbidden_path' });
      }
      const signedGet = await fetch(`${SUPA_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ expiresIn: 60 * 60 * 24 })
      });
      const sg = await signedGet.json().catch(() => ({}));
      if (!signedGet.ok) return res.status(404).json({ error: 'not_found' });
      const url = sg.signedURL
        ? `${SUPA_URL}/storage/v1${sg.signedURL}`
        : sg.signedUrl || null;
      return res.status(200).json({ ok: true, url });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    console.error('upload error');
    return res.status(500).json({ error: 'upload_failed' });
  }
}
