/**
 * Phase 5C — Comments, mentions, review, notifications.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  validateCommentTarget,
  parseMentionIds,
  roleCanComment,
  roleCanResolveComments,
  roleCanModerateComments,
  REVIEW_STATUSES,
  COMMENT_TARGET_TYPES
} from '../lib/workspace-comments.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
  }
}

console.log('\n== Phase 5C source invariants ==');

test('SQL creates comments + notifications with RLS select-only for clients', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase_workspaces_phase5c_comments.sql'), 'utf8');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS workspace_comments'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS workspace_notifications'));
  assert.ok(sql.includes('workspace_comments_select_member'));
  assert.ok(sql.includes('workspace_notifications_select_own'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE workspace_comments'));
  assert.ok(sql.includes("target_type IN ('project', 'production', 'script', 'shot', 'reference', 'asset')"));
  assert.ok(sql.includes('parent_id'));
  assert.ok(sql.includes('mentions jsonb'));
  assert.ok(sql.includes('deleted_at'));
  assert.ok(!/CRDT|operational transform/i.test(sql));
});

test('setup pointer mentions Phase 5C SQL', () => {
  const setup = fs.readFileSync(path.join(root, 'supabase_setup.sql'), 'utf8');
  assert.ok(setup.includes('supabase_workspaces_phase5c_comments.sql'));
});

test('target validation uses real Studio entities', () => {
  const doc = {
    projects: [
      {
        id: 'proj_1',
        name: 'Campaign',
        productions: [
          {
            id: 'prod_1',
            name: 'Launch',
            workspace: {
              shotList: [{ id: 'shot_1', order: 4, purpose: 'Hook' }],
              assets: [{ id: 'asset_1', name: 'Logo' }],
              references: { youtube: [{ id: 'ref_1', title: 'Ref' }] }
            }
          }
        ]
      }
    ]
  };
  assert.strictEqual(validateCommentTarget(doc, { targetType: 'project', targetId: 'proj_1' }).ok, true);
  assert.strictEqual(validateCommentTarget(doc, { targetType: 'production', targetId: 'prod_1' }).ok, true);
  assert.strictEqual(validateCommentTarget(doc, { targetType: 'script', targetId: 'prod_1' }).ok, true);
  assert.strictEqual(
    validateCommentTarget(doc, {
      targetType: 'shot',
      targetId: 'shot_1',
      productionId: 'prod_1'
    }).ok,
    true
  );
  assert.strictEqual(
    validateCommentTarget(doc, {
      targetType: 'asset',
      targetId: 'asset_1',
      productionId: 'prod_1'
    }).ok,
    true
  );
  assert.strictEqual(
    validateCommentTarget(doc, {
      targetType: 'reference',
      targetId: 'ref_1',
      productionId: 'prod_1'
    }).ok,
    true
  );
  assert.strictEqual(
    validateCommentTarget(doc, { targetType: 'production', targetId: 'prod_other' }).ok,
    false
  );
  assert.strictEqual(
    validateCommentTarget(doc, {
      targetType: 'shot',
      targetId: 'shot_x',
      productionId: 'prod_1'
    }).error,
    'target_not_found'
  );
  assert.ok(COMMENT_TARGET_TYPES.includes('script'));
  assert.ok(!COMMENT_TARGET_TYPES.includes('chat'));
});

test('roles: commenter can comment; viewer cannot; moderate is owner/editor', () => {
  assert.strictEqual(roleCanComment('owner'), true);
  assert.strictEqual(roleCanComment('editor'), true);
  assert.strictEqual(roleCanComment('commenter'), true);
  assert.strictEqual(roleCanComment('viewer'), false);
  assert.strictEqual(roleCanResolveComments('commenter'), true);
  assert.strictEqual(roleCanResolveComments('viewer'), false);
  assert.strictEqual(roleCanModerateComments('owner'), true);
  assert.strictEqual(roleCanModerateComments('editor'), true);
  assert.strictEqual(roleCanModerateComments('commenter'), false);
  assert.strictEqual(roleCanModerateComments('viewer'), false);
});

test('review statuses are constrained', () => {
  assert.deepStrictEqual(REVIEW_STATUSES, [
    'draft',
    'in_review',
    'changes_requested',
    'approved'
  ]);
});

test('mention IDs prefer structured client list; body tokens optional', () => {
  const ids = parseMentionIds('hello @[aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]', [
    '11111111-2222-3333-4444-555555555555'
  ]);
  assert.ok(ids.includes('11111111-2222-3333-4444-555555555555'));
  assert.ok(ids.includes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
});

test('API routes live in workspaces.js — no new serverless file', () => {
  const api = fs.readFileSync(path.join(root, 'api/workspaces.js'), 'utf8');
  assert.ok(api.includes("parts[1] === 'comments'"));
  assert.ok(api.includes("parts[3] === 'resolve'"));
  assert.ok(api.includes("parts[3] === 'reopen'"));
  assert.ok(api.includes("parts[3] === 'review'"));
  assert.ok(api.includes("parts[3] === 'review-status'"));
  assert.ok(api.includes("parts[1] === 'notifications'"));
  assert.ok(api.includes("route: 'workspace-comments'"));
  assert.ok(api.includes('createComment'));
  assert.ok(api.includes('setProductionReviewStatus'));
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
});

test('personal /api/sync untouched by comments', () => {
  const sync = fs.readFileSync(path.join(root, 'api/sync.js'), 'utf8');
  assert.ok(!sync.includes('workspace_comments'));
  assert.ok(!sync.includes('comment.created'));
  assert.ok(!/workspace-comments/.test(sync));
});

test('realtime handles comment events separately from revision gate', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-realtime.js'), 'utf8');
  assert.ok(src.includes('COMMENT_EVENTS'));
  assert.ok(src.includes('handleCommentEvent'));
  assert.ok(src.includes('onRemoteCommentEvent'));
  assert.ok(src.includes('comment.created'));
  assert.ok(!/CRDT|live cursor|character-level/i.test(src));
});

test('client comment UI + notifications + review exist', () => {
  const ui = fs.readFileSync(path.join(root, 'js/workspace-comments.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const studio = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(ui.includes('openSheet'));
  assert.ok(ui.includes('insertMention'));
  assert.ok(ui.includes('reviewCardHtml'));
  assert.ok(ui.includes('openNotifications'));
  assert.ok(html.includes('ws-comments-modal'));
  assert.ok(html.includes('ws-notifications-modal'));
  assert.ok(html.includes('workspace-comments.js'));
  assert.ok(html.includes('Unresolved collaborative feedback'));
  assert.ok(html.includes('MUTATION RULE'));
  assert.ok(studio.includes('reviewCardHtml'));
  assert.ok(studio.includes("commentChipHtml"));
});

test('comments stay out of Studio JSON persistence paths', () => {
  const lib = fs.readFileSync(path.join(root, 'lib/workspace-comments.js'), 'utf8');
  assert.ok(lib.includes('Separate from workspace_data.document') || lib.includes('separate from'));
  assert.ok(!lib.includes('document.comments'));
  assert.ok(lib.includes('validateMentions'));
  assert.ok(lib.includes('author_id: userId'));
});

test('Director mutation gate still denies commenter/viewer', () => {
  const dir = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
  assert.ok(dir.includes('roleCanEdit'));
  assert.ok(dir.includes('cannot mutate shared workspace'));
});

test('explicitly NOT implemented markers remain true in tree', () => {
  const forbidden = ['CRDT', 'operational transform', 'Yjs', 'Automerge'];
  const files = [
    'lib/workspace-comments.js',
    'js/workspace-comments.js',
    'api/workspaces.js',
    'js/workspace-realtime.js'
  ];
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    forbidden.forEach((term) => {
      assert.ok(!src.includes(term), f + ' should not contain ' + term);
    });
  });
});

console.log(`\nPhase 5C: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
