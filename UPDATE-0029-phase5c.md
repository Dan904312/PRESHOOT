# UPDATE-0029 — Phase 5C Comments, Mentions & Production Review

- **Update ID:** UPDATE-0029
- **Version:** v2.15.0
- **Date:** 2026-08-11
- **Category:** Feature, Backend, Database, Security, UI/UX, AI System

## What Changed
Collaborative workspaces now support a separate comments/mentions/notifications/review layer on shared Studio entities. Comments are not stored in `workspace_data.document` or personal `user_data`. Personal `/api/sync` is unchanged. No new Vercel Serverless Functions (still 12).

## Files Changed
- `supabase_workspaces_phase5c_comments.sql` (new)
- `supabase_setup.sql`
- `lib/workspace-comments.js` (new)
- `api/workspaces.js`
- `js/workspace-sync.js`
- `js/workspace-context.js`
- `js/workspace-realtime.js`
- `js/workspace-ui.js`
- `js/workspace-comments.js` (new client UI)
- `js/studio-ui.js`
- `app.html`
- `tests/workspaces-phase5c.test.mjs` (new)
- `package.json`
- `CHANGE_LOG_RULES.md`
- `UPDATE-0029-phase5c.md` (this note — also log in PreShoot_Update_Security_Log.pdf)

## Explicitly NOT implemented
CRDT, OT, live cursors, chat, workspace billing, relational Studio rewrite.

## Testing
`npm test` (includes Phase 5C + Hobby budget assert).
