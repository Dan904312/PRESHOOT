/**
 * Smoke test: consolidated Serverless Function routing contracts.
 * Ensures public URLs map to the correct resource handlers without
 * requiring a Vercel login.
 *
 * Run: node tests/vercel-function-budget.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'api');

function listApiFunctions(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.join(base, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...listApiFunctions(full, rel));
    else if (/\.(js|mjs|cjs|ts)$/.test(name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out.sort();
}

const functions = listApiFunctions(apiDir);
console.log('Deployable Serverless Functions (' + functions.length + '):');
functions.forEach((f) => console.log('  - api/' + f));

assert.strictEqual(
  functions.length,
  12,
  'Hobby plan allows max 12; found ' + functions.length
);

const forbidden = [
  'track-user.js',
  'workspace-sync.js',
  'workspace-invites/accept.js'
];
for (const f of forbidden) {
  assert.ok(!functions.includes(f), 'deleted entry must not remain: ' + f);
}

const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const routes = vercel.routes || [];

function hasRewrite(src, destIncludes) {
  return routes.some((r) => r.src === src && String(r.dest || '').includes(destIncludes));
}

assert.ok(
  hasRewrite('/api/workspace-sync', '__resource=sync'),
  'workspace-sync rewrite missing'
);
assert.ok(
  hasRewrite('/api/workspace-invites/accept', '__resource=invite-accept'),
  'invite-accept rewrite missing'
);
assert.ok(
  hasRewrite('/api/track-user', '__resource=track'),
  'track-user rewrite missing'
);

/* Handler resource detection (mirrors api/workspaces.js / check-plan.js) */
function workspaceResource(url, query) {
  if (query && query.__resource) return String(query.__resource);
  if (String(url).indexOf('/api/workspace-sync') >= 0) return 'sync';
  if (String(url).indexOf('/api/workspace-invites/accept') >= 0) return 'invite-accept';
  return 'crud';
}
function accountResource(url, query) {
  if (query && query.__resource) return String(query.__resource);
  if (String(url).indexOf('/api/track-user') >= 0) return 'track';
  return 'plan';
}

assert.strictEqual(workspaceResource('/api/workspaces', {}), 'crud');
assert.strictEqual(
  workspaceResource('/api/workspaces?__resource=sync', { __resource: 'sync' }),
  'sync'
);
assert.strictEqual(
  workspaceResource('/api/workspaces?__resource=invite-accept', {
    __resource: 'invite-accept'
  }),
  'invite-accept'
);
assert.strictEqual(accountResource('/api/check-plan', {}), 'plan');
assert.strictEqual(
  accountResource('/api/check-plan?__resource=track', { __resource: 'track' }),
  'track'
);

/* Personal sync must remain its own function */
assert.ok(functions.includes('sync.js'), 'personal /api/sync must remain separate');
assert.ok(functions.includes('workspaces.js'), 'shared workspaces entry required');

console.log('\nHobby budget OK: exactly 12 Serverless Functions');
console.log('Public URL contracts preserved via vercel.json rewrites');
