#!/usr/bin/env node
/**
 * Fail CI/local checks if api/ would deploy more than 12 Vercel Serverless Functions
 * (Hobby plan limit). Run: node scripts/assert-hobby-function-budget.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'api');
const HOBBY_MAX = 12;

function walk(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.join(base, name).replace(/\\/g, '/');
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, rel));
    else if (/\.(js|mjs|cjs|ts)$/.test(name)) out.push(rel);
  }
  return out.sort();
}

const functions = walk(apiDir);
console.log('Vercel Hobby Serverless Function inventory (' + functions.length + '/' + HOBBY_MAX + '):');
functions.forEach((f) => console.log('  api/' + f));

const forbidden = ['track-user.js', 'workspace-sync.js', 'workspace-invites/accept.js'];
for (const f of forbidden) {
  if (functions.includes(f)) {
    console.error('ERROR: leftover consolidated entry still present: api/' + f);
    process.exit(1);
  }
}

if (functions.length > HOBBY_MAX) {
  console.error('ERROR: ' + functions.length + ' functions exceeds Hobby limit of ' + HOBBY_MAX);
  process.exit(1);
}

const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const routes = vercel.routes || [];
const need = [
  ['/api/workspace-sync', '__resource=sync'],
  ['/api/workspace-invites/accept', '__resource=invite-accept'],
  ['/api/track-user', '__resource=track']
];
for (const [src, destPart] of need) {
  const ok = routes.some((r) => r.src === src && String(r.dest || '').includes(destPart));
  if (!ok) {
    console.error('ERROR: missing rewrite ' + src + ' → …' + destPart);
    process.exit(1);
  }
}

if (!functions.includes('workspaces.js')) {
  console.error('ERROR: api/workspaces.js missing — Phase 1 collaboration entry required');
  process.exit(1);
}
if (!functions.includes('sync.js')) {
  console.error('ERROR: api/sync.js missing — personal Studio must remain separate');
  process.exit(1);
}

console.log('OK: deployable function count is ' + functions.length + ' (≤ ' + HOBBY_MAX + ')');
