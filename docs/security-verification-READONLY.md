# PreShoot Security Verification

Independent read-only review of https://github.com/Dan904312/PRESHOOT (`main` @ `291bc08`, 2026-09-11) against live https://preshoot.vercel.app and project `jxtbgsologwvjmcaeahg`. No product code, SQL, Storage, keys, or policies were changed by this review.

Daniel’s claim: Supabase security remediation was already implemented. This review treats that as unproven until evidence says otherwise.

**Live probe method:** public anon JWT from live `/app.html` (same key as repo `app.html`). GET/POST only. Dummy parameters. No authenticated user JWT. No writes that returned success. No Advisor dashboard access.

## Verdict (PASS WITH WARNINGS)

Claimed PostgREST privilege hardening is **confirmed live for the `anon` role**: sensitive tables return `42501`, backend SECURITY DEFINER RPCs return `42501`, and `public.is_workspace_member` / `public.can_edit_workspace` / `public.workspace_role` / `public.workspace_id_from_realtime_topic` are **absent** from the Data API schema cache.

That is **not** a full pass:

- Function **bodies** (`search_path = ''`, `private.require_service_role()`) are **NOT VERIFIED** on live Postgres (cannot dump `pg_proc`).
- **Authenticated** JWT EXECUTE/RLS (including the old `workspace_members` TTL leak) is **NOT VERIFIED** live.
- Security Advisor **counts are NOT VERIFIED** (not documented in-repo; dashboard not available).
- Live schema is **behind the repo**: `workspace_comments`, `workspace_notifications`, `content_performance`, `activity_events`, `streak_rewards` are missing from PostgREST.
- Older SQL files still recreate DEFINER functions **without** the hardening guards. Re-pasting them would regress live.
- `npm test` **FAILS** on an unrelated docs assertion and aborts the rest of the script.

No **CRITICAL** live anon Data-API execution was confirmed in this pass.

## 1. Remediation verification (table)

| Claim | Repo evidence | Live evidence | Status |
|---|---|---|---|
| Move RLS helpers off PostgREST (`private` schema; drop `public.is_workspace_member` etc.) | `sql/20260911_security_definer_hardening.sql` + updated phase1/3a SQL | Named RPC `public.is_workspace_member(p_workspace_id,p_user_id)` → `PGRST202` (not in schema cache). Same for `can_edit_workspace`, `workspace_role`, `workspace_id_from_realtime_topic`. | **confirmed safe** (public RPC gone). Private helpers / `db-extra-search-path` **NOT VERIFIED**. |
| Bind helper `p_user_id` to `auth.uid()` for `authenticated` | Hardening + phase1 function bodies | Function bodies **NOT VERIFIED** live. | **NOT VERIFIED** live; **confirmed** in repo SQL. |
| Drop TTL policy that leaked `workspace_members` | Hardening `DROP POLICY IF EXISTS "Policy to implement Time To Live (TTL)"` | Cannot SELECT as anon (`42501`). Authenticated non-member SELECT **NOT VERIFIED**. | **NOT VERIFIED** live; **confirmed** as intent in SQL. |
| Backend RPCs: `REVOKE` anon/authenticated; `GRANT` service_role | Hardening + older SQL already had most REVOKEs | Anon named-arg calls → `42501 permission denied for function …` for every backend RPC probed (list in §2). | **confirmed safe** for **anon**. **authenticated** EXECUTE **NOT VERIFIED** live (SQL says revoked). |
| In-function `private.require_service_role()` | Hardening recreates public RPCs with `PERFORM private.require_service_role()` | Body **NOT VERIFIED** live. Older files (`supabase_setup.sql`, `supabase_onboarding_streak.sql`, `supabase_admin_console.sql`, `supabase_admin_analytics.sql`, `supabase_streak_activity.sql`, phase1 `ensure_personal_workspace`) still omit the guard. | **NOT VERIFIED** live. Repo **inconsistent** across files. |
| Pin `search_path = ''` on DEFINER + timezone/trigger helpers | Hardening | Bodies **NOT VERIFIED** live. Anon EXECUTE denied on `preshoot_sanitize_tz` / `preshoot_local_date` / `rls_auto_enable`. | **NOT VERIFIED** live; **confirmed** in hardening SQL. |
| Revoke client EXECUTE on `rls_auto_enable` | Hardening REVOKE; **no function body in repo** | Anon `{}` → `42501` (function **exists** live). | Privilege **confirmed safe** for anon. Body/search_path **NOT VERIFIED**. |
| Storage: RESTRICTIVE deny on `production-assets` | `supabase_workspaces_phase6_hardening.sql` only if bucket **already exists** | Anon `GET /storage/v1/bucket` → `[]`. Anon list `production-assets` → HTTP 200 `[]` (not 403). | **NOT VERIFIED** that RESTRICTIVE policies exist. Anon did not receive object names. |
| No `USING (true)` in hardening | Hardening has none. No `USING (true)` in any repo `*.sql`. | Policies **NOT VERIFIED** live. | Repo: **confirmed**. Live policies: **NOT VERIFIED**. |
| Security Advisor errors/warnings documented | `supabase_setup.sql` line 591 is a run-this-file comment only. No Advisor before/after counts anywhere. | Dashboard not accessible. | Advisor counts **NOT VERIFIED**. |
| Live DB matches latest `main` SQL | Hardening committed `291bc08` | Public helper RPCs dropped; backend RPCs present. Several later tables **missing** (see §3/§7). | **partial**. Privilege hardening looks applied. Schema completeness **does not match repo**. |

## 2. SECURITY DEFINER audit (table)

Ratings: **SAFE** = anon cannot execute / not in Data API, and app callers bind JWT id. **NEEDS ATTENTION** = residual search_path / file-order / unverified body. **HIGH RISK** / **CRITICAL** = confirmed client-callable DEFINER write or cross-user oracle. None of the named functions rated CRITICAL from live anon probes.

| Function | Definition summary (hardening SQL unless noted) | search_path | EXECUTE grants in SQL | PostgREST RPC risk | Callers (api/lib/js) | Used by RLS? | Accepts user_id / workspace_id / email? | Cross-user write risk | Rating |
|---|---|---|---|---|---|---|---|---|---|
| `admin_daily_usage` | Aggregate `usage_events` by UTC day | hardening: `''` + `require_service_role()`. `supabase_admin_analytics.sql`: `public`, **no** guard | REVOKE PUBLIC/anon/authenticated; GRANT service_role | Live anon `{}` → **42501**. Still in public schema cache. | `lib/admin-console.js` `fetchDailyUsageRpc` after admin session | no | optional `p_since` only | If EXECUTE leaked: reads all usage, no writes | **SAFE** (anon). Body **NOT VERIFIED**. Re-run analytics SQL strips guard. |
| `admin_usage_rollup` | Aggregate usage by user/type/model | same pattern; admin_console.sql uses `public` / SQL DEFINER / no guard | service_role only | Live anon → **42501** | `lib/admin-console.js` `fetchUsageRollup` | no | `p_since` | leaked EXECUTE = tenant-wide usage read | **SAFE** (anon). Same re-run risk. |
| `bump_usage_daily` | Atomic daily quota increment | hardening: `''` + guard. setup.sql: `public`, no guard | service_role | Live named args → **42501** | `lib/security.js` `bumpUsage` after `requireUser` | no | **`p_user_id`**, field, limit | DEFINER write. App binds JWT id. Client RPC would be quota fraud / cross-user bump. | **SAFE** if grants hold. **NEEDS ATTENTION**: grants/body live for `authenticated` **NOT VERIFIED**. |
| `bump_user_scan_count` | Increment `users.total_scans` | hardening: `''` + guard. admin_console.sql: `public`, no guard | service_role | Live → **42501** | `lib/usage-ledger.js` after server usage insert | no | **`p_user_id`** | Cross-user counter write if RPC leaked | **SAFE** (anon). Same caveats. |
| `can_edit_workspace` | Membership + owner/editor | private, `''`, uid bind for authenticated | REVOKE authenticated; GRANT service_role, postgres | Live **public** RPC **gone** (`PGRST202`) | Not called from JS/API (role checks are REST membership) | **not used** in current policies (policies use `is_workspace_member`) | workspace_id + **user_id** | Oracle / edit-bit if public+authenticated. Mitigated if private-only. | **SAFE** as public RPC. Private EXECUTE to authenticated is revoked in SQL. |
| `check_rate_limit` | Shared rate-limit bucket upsert | hardening: `''` + guard. setup.sql: `public` | service_role | Live → **42501** | `lib/security.js` | no | key/max/window (not user_id) | Leaked RPC = bypass/reset buckets | **SAFE** (anon). |
| `claim_stripe_event` | Insert Stripe event id (idempotency) | hardening: `''` + guard. setup.sql: `public` | service_role | Live → **42501** | `api/webhook.js` after Stripe signature | no | event_id, type | Leaked RPC = poison idempotency table | **SAFE** (anon). Webhook auth is Stripe sig, not user JWT. |
| `consume_onboarding_scan` | Decrement `free_scans_remaining` | hardening: `''` + guard. onboarding SQL: `public`, no guard | service_role | Live → **42501** | `lib/entitlements.js` via `requireScanAccess` | no | **`p_user_id`** | Steal/burn another user’s free scans if leaked | **SAFE** (anon). |
| `ensure_personal_workspace` | Create personal workspace + owner row | hardening: `''` + guard. **phase1.sql still `search_path = public` and NO guard** | service_role | Live → **42501** (function **exists**) | No direct `/rpc` in api/*.js (provisioner SQL / possible future) | no | **`p_user_id`** | DEFINER insert into `workspaces`/`workspace_members` for arbitrary user | **NEEDS ATTENTION**: live callable only if grants leak; phase1 re-run drops the guard and keeps `search_path=public`. |
| `grant_onboarding_reward` | One-time 3 scans + 24h trials | hardening: `''` + guard. onboarding SQL: `public`, no guard | service_role | Live → **42501** | `lib/entitlements.js` ← `api/check-plan.js` `handleReward` after `requireUser`; uses **`auth.user.id`** | no | **`p_user_id`**, timezone | Cross-user grant if leaked | **SAFE** (anon). App path confirmed JWT-bound. |
| `is_workspace_member` | EXISTS membership | private, `''`, authenticated cannot query other `p_user_id` | GRANT authenticated, service_role, postgres (private) | Live **public** RPC **gone** | RLS only (not JS) | **YES** (workspaces, workspace_data, workspace_members, versions, realtime) | workspace_id + **user_id** | Public+authenticated was a membership oracle. Public drop **confirmed live**. | **SAFE** as Data API. Helper still DEFINER by design (RLS recursion). |
| `record_creation_activity` | Streak update on `users` | hardening: `''` + guard. onboarding + streak_activity SQL: `public`, no guard | service_role | Live → **42501** | `lib/entitlements.js` (JS writer primary; RPC fallback) | no | **`p_user_id`**, kind, timezone | Cross-user streak write if leaked | **SAFE** (anon). Re-running `supabase_streak_activity.sql` **replaces** the hardened body. |
| `redeem_promo_code` | Promo → `subscriptions` Pro | hardening: `''` + guard. setup.sql: `public`, no guard | service_role | Live → **42501** | `api/promo.js` after `requireUser`; `p_user_id`/`p_email` from JWT | no | code, **user_id**, **email** | **CRITICAL if client-executable** (grant Pro to anyone). Anon denied live. | **SAFE** (anon). Authenticated EXECUTE **NOT VERIFIED** live. |
| `refund_onboarding_scan` | Cap refund at 3 | hardening: `''` + guard. onboarding: `public` | service_role | Live → **42501** | `lib/entitlements.js` / chat failure path; JWT user | no | **`p_user_id`** | Top up another user’s scans if leaked | **SAFE** (anon). |
| `rls_auto_enable` | **Body not in repo.** Typical event-trigger helper. | **NOT VERIFIED** | hardening: REVOKE PUBLIC/anon/authenticated; GRANT postgres | Live exists; anon `{}` → **42501** | none in app JS | n/a | unknown | If client-executable + DEFINER, depends on body. | **NEEDS ATTENTION** (unknown body). Anon EXECUTE denied. |
| `workspace_id_from_realtime_topic` | Parse `realtime.topic()` `workspace:{uuid}` | private, `''` | GRANT authenticated, service_role, postgres | Live **public** RPC **gone** | RLS on `realtime.messages` | **YES** | none (topic from Realtime) | Useless outside Realtime; UUID regex validated | **SAFE** as Data API. |
| `workspace_role` | Return role string | private, `''`, uid bind | REVOKE authenticated; GRANT service_role, postgres | Live **public** RPC **gone** | not used in current RLS | workspace_id + **user_id** | Role oracle if public | **SAFE** as Data API. |

**Also DEFINER (not in the original named list):**

| Function | Notes | Rating |
|---|---|---|
| `private.require_service_role` | `auth.role() === 'service_role'` else `42501`. `search_path = ''`. GRANT postgres, service_role. | **SAFE** in SQL. Live existence **NOT VERIFIED**. |
| `preshoot_gate_suspended_jwt` | DEFINER, **`search_path = public`** (notifications SQL). Hardening only REVOKEs EXECUTE; **does not pin search_path**. Live anon → **42501**. | **NEEDS ATTENTION** (mutable search_path on Auth hook). |
| `preshoot_custom_access_token_hook` | SQL wrapper; `search_path = public`; GRANT `supabase_auth_admin`. | **NEEDS ATTENTION** (same). |

**`preshoot_sanitize_tz`, `preshoot_local_date`, `update_updated_at`:** **not** SECURITY DEFINER in hardening (INVOKER). `SET search_path = ''`. Bodies use `pg_catalog.timezone` / `pg_catalog.now()` only. Timezone regex `^[A-Za-z0-9_+\-/]{1,64}$` then `PERFORM pg_catalog.timezone(...)`. **Mutable search_path is not exploitable in the hardening bodies** because (1) they are not DEFINER, (2) path is pinned empty, (3) catalog-qualified. Live bodies **NOT VERIFIED**. Anon EXECUTE denied on tz helpers. Trigger `update_updated_at` is not a zero-arg RPC (`PGRST202`).

**Classic DEFINER+`search_path=public` exploit** requires `CREATE` on `public` (shadow `users` / `workspace_members`). Whether `anon`/`authenticated` still have `CREATE` on `public` is **NOT VERIFIED** live. If they do, any remaining DEFINER with `search_path=public` (Auth hook; any RPC whose body was not rebuilt by hardening) is **HIGH RISK**. If `CREATE` was revoked (modern Supabase default), it is residual Advisor noise.

## 3. IDOR / tenant isolation

### `/api/sync` — **confirmed safe** in code

`requireUser` → `user_id = auth.user.id` only. Load/save filter/write `user_data` with that id. Client `data.user_id` is ignored. Rejects `workspace_id` / `shared_workspace` so personal sync cannot write `workspace_data`.

### `/api/workspaces` + `/api/workspace-sync` — **confirmed safe** in code (mocked tests pass)

Handler `requireUser` first. Every workspace UUID from the path/body goes through `assertWorkspaceMember` / `assertWorkspaceRole` **before** service-role REST. `addMember` `body.user_id` is an **owner-only** invitee id, not a substitute for the actor. Saves require `EDIT_ROLES`. Personal workspaces reject invites/members and workspace-sync.

`listMembers` after membership check calls Auth **admin** `GET /auth/v1/admin/users/{id}` and returns **emails** of fellow members to any member (including viewers). Not cross-tenant IDOR. Privacy expansion. **HARDEN LATER**.

`markNotificationRead` filters `id` **and** JWT `user_id`. Cross-user mark-read **confirmed blocked** in code. Workspace id in the URL is not re-checked on the row (user can mark their own notification from another workspace). Not IDOR.

### `/api/upload` — **confirmed safe** in code for path ACL

`create`: path is **server-built** `{jwtUserId}/…` or `workspaces/{uuid}/…` after `assertWorkspaceRole(..., EDIT_ROLES)`. Client `production_id` is sanitized to `[a-zA-Z0-9_-]` folder name only — **not** a cross-user ownership check (folder name under an already-authorized prefix). `put`/`complete`/`delete`/`sign_download`: `assertStoragePathAccess` + `isSafeStorageObjectPath` (rejects `..`, `//`, leading `/`, `\\`). Personal: `path.startsWith(userId + '/')`. Workspace: regex UUID + membership / edit role.

Unit tests in `tests/workspaces-phase1.test.mjs` cover personal/shared/cross-user/traversal. **Live signed-URL IDOR NOT VERIFIED** (no user JWT).

### `/api/director` — **confirmed safe** in code for workspace gate

`requireUser` + `requireDirectorAccess`. Optional `workspace_id` must be UUID; `assertWorkspaceMember(auth.user.id, …)` **before** model call. Mutation intent requires `roleCanEdit`. No client `user_id` write path.

### `/api/chat` — **confirmed safe** in code

`requireUser`; guest only when error is `auth_required`. Usage/streak/ledger use `user.id`, not body. Guest has no service-role user-row writes in the success path inspected.

### `/api/promo`, `/api/check-plan`, `/api/billing-portal`

Promo/plan/reward/activity bind JWT id. Billing portal uses `getSubscription(auth.user.id, auth.user.email)` then `stripe_customer_id` only (no `customers.list`). **confirmed safe** vs email-portal IDOR.

`getSubscription` still **rebinds** orphan `email:` / null-`user_id` Pro rows onto the current JWT user. Depends on Auth email uniqueness/verification. **NOT VERIFIED** live. **FIX BEFORE PUBLIC SCALE** if email confirmation can be skipped.

### Client-supplied `user_id`

No app API uses `req.body.user_id` as the subject of a service-role query except **owner adding a member** and **admin console** (admin session). **confirmed** via repo grep.

### Live Data API (anon)

All existing tenant tables probed: `42501 permission denied for table …`. Anon cannot read `user_data`, `users`, `subscriptions`, `workspace_*` (existing), `product_events`, `usage_*`, `app_settings`, admin tables.

**Authenticated** own-row SELECT is **intentional** (`GRANT SELECT` + `auth.uid()::text = user_id` or membership helpers). That path is **NOT VERIFIED** live (no user JWT). Viewers can `SELECT` full `workspace_data` / version snapshots via PostgREST if grants match SQL — same data as `/api/workspace-sync` load. Writes remain service-role-only in SQL (no authenticated UPDATE policy).

### Live schema drift

PostgREST `PGRST205` (table not in schema cache): `workspace_comments`, `workspace_notifications`, `content_performance`, `activity_events`, `streak_rewards`. Those migrations are **not applied** (or not exposed). Not an IDOR hole; features in repo SQL are **not live**.

## 4. Storage security

| Control | Evidence | Status |
|---|---|---|
| Bucket private in comments / upload.js create payload | `public: false`, 12MB, mime allowlist | **confirmed** in code. Live bucket list as anon is `[]` — existence **NOT VERIFIED**. |
| Client cannot use service key | Key only in Vercel env / `.env.example`. Frontend uses anon JWT. Tests assert HTML/JS do not embed `SUPABASE_SERVICE_KEY`. | **confirmed**. |
| Path ACL before sign/create/delete | See §3 upload | **confirmed** in code. |
| Production ownership | `production_id` is a path segment, not a DB FK check | **confirmed**: no production-row ACL. Relies on user/workspace prefix. |
| RLS RESTRICTIVE on `storage.objects` | Phase 6 uses `AS RESTRICTIVE … bucket_id IS DISTINCT FROM 'production-assets'` **inside `IF bucket exists`**. If bucket was created later (upload.js tries to create it), policies **never applied**. | **NOT VERIFIED** live. |
| Anon list objects | `POST /object/list/production-assets` → 200 `[]` | Does **not** prove deny; empty bucket and RLS-filter both yield `[]`. |
| Signed GET TTL | `expiresIn: 60 * 60` (1h). Upload sign 120s. | **confirmed** in code. Bearer of URL can fetch until expiry. **HARDEN LATER** if sharing paths in realtime/docs. |

## 5. Authentication / suspension

| Control | Evidence | Status |
|---|---|---|
| `requireUser` JWT via `/auth/v1/user` | `lib/security.js` | **confirmed** in code. |
| `requireActiveUser` inside `requireUser` | Suspended → 403; missing schema / timeout → **503 fail-closed**; missing `users` row → treat as active (first request) | **confirmed** in code. Live suspend behavior **NOT VERIFIED**. |
| Routes using `requireUser` | research, check-plan, upload, chat, workspaces, sync, billing-portal, director, promo | **confirmed**. |
| Exceptions | `api/webhook.js`: Stripe signature. `api/admin-data.js` / `admin-auth.js`: admin session, not user JWT. Chat guest: `auth_required` only. | Intentional. |
| Client IDs ignored for subject | See §3 | **confirmed**. |
| Auth hook `preshoot_gate_suspended_jwt` | SQL exists; live function exists; anon EXECUTE denied. Whether Dashboard hook is **enabled** | **NOT VERIFIED**. API-layer `requireActiveUser` is the guaranteed gate in code. |
| Admin APIs | `requireAdminSession`; rejects `x-admin-key` | **confirmed** in code. Live admin session **NOT VERIFIED**. |

## 6. Realtime

Repo SQL (phase 3a + 5b + hardening):

- Topic `workspace:{uuid}`; UUID regex before cast.
- SELECT broadcast/presence: member via `private.is_workspace_member(..., auth.uid())`.
- Presence INSERT: members only.
- Broadcast INSERT: **no** authenticated policy (service_role emits after `/api/workspace-sync`).
- Client `js/workspace-realtime.js`: private channel, metadata events, claims not to send documents.

Live: public `workspace_id_from_realtime_topic` **gone** (expected after move to `private`). Actual `realtime.messages` policies **NOT VERIFIED** (need member JWT + Realtime). `user_data` realtime publication is commented in `supabase_setup.sql` (“run once if not published”) — **NOT VERIFIED** live.

## 7. Remaining Security Advisor findings

**NOT VERIFIED.** Repo has **zero** Advisor screenshots, error IDs, or counts. The only mention is a setup comment to run `sql/20260911_security_definer_hardening.sql`.

Likely leftover Advisor rows **even after** a correct hardening paste (cannot confirm):

- DEFINER functions still in `public` (service_role RPCs) — Advisor flags DEFINER regardless of grants.
- `search_path` warnings if live bodies were not replaced.
- `rls_auto_enable` mutable search_path (body unknown).
- Auth hook `search_path = public`.
- `leaked_password_protection` / MFA / haveibeenpwned — not in this SQL set.
- Default privilege warnings if `ALTER DEFAULT PRIVILEGES … supabase_admin` hit `insufficient_privilege` (hardening catches that).

Do **not** treat “SQL exists on GitHub” as “Advisor is green.”

## 8. Critical findings

**None confirmed live for unauthenticated Data API / RPC execution.**

Highest residual items (not proven exploited):

1. **Re-run hazard (HIGH if an operator pastes old files after hardening).** `supabase_onboarding_streak.sql`, `supabase_streak_activity.sql`, `supabase_setup.sql`, `supabase_admin_console.sql`, `supabase_admin_analytics.sql`, and phase1 `ensure_personal_workspace` still `CREATE OR REPLACE` DEFINER functions with `SET search_path = public` and **without** `require_service_role()`. Grants would likely stay revoked, but Advisor + search_path exposure return. Streak SQL would **overwrite** the hardened `record_creation_activity` body.
2. **Auth hook search_path not hardened.** `preshoot_gate_suspended_jwt` remains DEFINER + `search_path = public`. Exploitable **only if** `CREATE` on `public` exists for a weaker role — **NOT VERIFIED**.
3. **Authenticated JWT untested.** TTL leak, membership RLS, EXECUTE on RPCs as `authenticated`, Storage as signed-in user: **NOT VERIFIED**.
4. **Storage RESTRICTIVE policies may never have run.** Gated on bucket already existing.
5. **Promo RPC is still in the public schema cache.** Anon cannot execute (`42501`). If `authenticated` ever regained EXECUTE, this is **CRITICAL** (DEFINER writes `subscriptions`). SQL says revoked; live authenticated **NOT VERIFIED**.

## 9. False alarms / intentional architecture

- **Service role on Vercel APIs** after `requireUser` / admin session / Stripe signature. RLS is not the app’s write path. This is the product architecture, not a finding by itself. Each call site still needs authz-before-query (mapped below).
- **`GRANT SELECT` to `authenticated`** on `user_data`, `users`, `subscriptions`, workspace tables, `product_events`, comments: own-row or membership SELECT. Writes denied (REVOKE + no write policies). Intentional.
- **SECURITY DEFINER RLS helpers** to avoid `workspace_members` recursion. Standard pattern **if** not in Data API and uid-bound.
- **Public anon key in `app.html`:** expected for Supabase. Must never be the service role (it is `role: anon` in the JWT payload).
- **Guest `/api/chat`:** intentional; IP rate-limit + scan cap. Not a tenant IDOR.
- **Admin console service role:** gated by `requireAdminSession`, not end-user JWT.
- **`content_performance` INSERT policies** in phase7 SQL: user-supplied metrics, `auth.uid() = user_id` (uuid column). Table **not live**. Weaker than other tables (no `TO authenticated`, no REVOKE, no workspace check) **if applied as written**.
- **`npm test` docs failure** (`UPDATE-0033-admin-console.md` missing string `sql/users_account_status.sql`): documentation drift, not a live control failure.

### Service-role usage map (authz-before-query)

| Location | Authz before query? | Verdict |
|---|---|---|
| `api/sync.js` | `requireUser` then `auth.user.id` | **confirmed safe** |
| `api/workspaces.js` + `lib/workspaces.js` | `requireUser` then membership/role | **confirmed safe** |
| `api/upload.js` | `requireUser` then path/role | **confirmed safe** |
| `api/director.js` | `requireUser` + optional membership | **confirmed safe** |
| `api/chat.js` | `requireUser` / guest cap; writes JWT id | **confirmed safe** |
| `api/promo.js` | `requireUser`; RPC ids from JWT | **confirmed safe** |
| `api/check-plan.js` | `requireUser`; track/reward/activity JWT-bound | **confirmed safe** (see `userId` typo in referral branch: `trackProductEventServer(userId, …)` uses undefined `userId` — bug, not IDOR) |
| `api/billing-portal.js` | `requireUser` + customer id from that user | **confirmed safe** |
| `api/research.js` trends/research/performance | `requireUser` before response. Trends **starts** a service-role `app_settings` read **in parallel** with auth; result not returned until auth succeeds | **confirmed safe** for client. Extra privileged read on unauthenticated hits: **HARDEN LATER**. |
| `api/webhook.js` | Stripe signature **before** DB. No user JWT. | **confirmed safe** as webhook. |
| `api/admin-data.js` + `lib/admin-*` | Admin session, then unrestricted service-role reads/writes | **confirmed** admin-scoped. Compromise of `ADMIN_SECRET` / session = full DB. |
| `lib/security.js` subscription/usage/rate-limit | Caller must pass JWT user id (routes do) | **confirmed** at route layer. `getSubscription(userId, email)` orphan rebind: **NEEDS ATTENTION**. |
| `lib/entitlements.js` | RPC `p_user_id` from caller; routes pass JWT id. `workspaceId` on activity is **metadata only** (no membership check) | Streak IDOR: **confirmed none**. Metadata pollution: **HARDEN LATER**. |
| `lib/account-status.js` | `requireActiveUser(user.id)` / admin `setAccountStatus` | **confirmed**. Empty `userId` would fail-open to active — routes always pass JWT id. |
| `lib/product-events.js` / `usage-ledger.js` | server user_id argument | **confirmed** if callers pass JWT id (they do). |

## 10. Recommended next actions (MUST FIX NOW / FIX BEFORE PUBLIC SCALE / HARDEN LATER / NO ACTION)

### MUST FIX NOW

- **None confirmed.** Do not “fix” live from this review. Operators: **do not re-paste** old `supabase_*.sql` files after hardening without re-applying `sql/20260911_security_definer_hardening.sql` last.

### FIX BEFORE PUBLIC SCALE

- Dump live `pg_proc` (`prosecdef`, `proconfig`/`search_path`, `proacl`) for every DEFINER function and compare to hardening SQL. Prove `require_service_role` and `search_path=''` — currently **NOT VERIFIED**.
- Prove as a real **authenticated** user: (a) `workspace_members` SELECT is membership-only (TTL gone), (b) backend RPCs still `42501`, (c) cannot `SELECT` another user’s `user_data`.
- Confirm Security Advisor in Dashboard; **write the counts in-repo**. Until then Advisor remains **NOT VERIFIED**.
- Confirm `production-assets` bucket exists and phase6 **RESTRICTIVE** policies are actually present; re-run phase6 **after** bucket create if needed.
- Pin Auth hook functions to `search_path = ''` and catalog-qualify (hardening currently skips bodies).
- Make hardening the **only** function source, or add `require_service_role` + empty `search_path` to every older `CREATE OR REPLACE FUNCTION` so a re-run cannot regress.
- Apply or explicitly defer missing live tables (`workspace_comments` / notifications / streak activity / `content_performance`) so repo and production match.
- If email/password signup allows unconfirmed email, close `getSubscription` orphan rebind (account takeover of webhook Pro rows).

### HARDEN LATER

- Stop using `SUPABASE_SERVICE_KEY` as join-code pepper (`JOIN_CODE_PEPPER`).
- 6-digit join codes (1e6 space) even with rate limits.
- `listMembers` email disclosure via Auth admin.
- 1-hour download signed URLs; consider shorter TTL.
- Parallel service-role trends cache fetch before auth completes.
- `content_performance` policies: add `TO authenticated`, REVOKE, workspace membership if that table is ever applied.
- `rls_auto_enable`: document or drop; pin search_path.
- `ALTER DEFAULT PRIVILEGES` for `supabase_admin` if the NOTICE fired.
- Reduce `workspace_data` PostgREST SELECT if you want API-only reads (viewers already get the document via API).

### NO ACTION

- Keep service-role writes on Vercel after JWT/admin/Stripe checks (intentional).
- Keep public anon key in the browser (intentional).
- Keep DEFINER RLS helpers in `private` (intentional **if** they stay off Data API).
- Do not treat Advisor “DEFINER function exists” as a vulnerability by itself when EXECUTE is service_role-only and search_path is pinned.

---

### Tests

| Run | Result |
|---|---|
| `npm test` (full script) | **FAIL**. Stops in `tests/admin-console.test.mjs`: `account_status SQL exists in-repo` — `UPDATE-0033-admin-console.md` does not contain the string `sql/users_account_status.sql`. Unrelated to controls. Because the npm script is `&&`-chained, later files including hardening tests **do not run** in that invocation. |
| Files after that point, run separately (including `tests/security-definer-hardening.test.mjs`) | **PASS**. Hardening tests are **source-string invariants**, not a live DB. |
| Workspace IDOR tests (`tests/workspaces-phase1.test.mjs`) | **PASS** against an in-process fake REST. Not live. |

### What this review did not do

No authenticated end-user session. No Advisor UI. No `pg_dump` of policies. No Storage object that was known to exist. No attempt to redeem a real promo, mutate rows, or use service_role. Live **authenticated** isolation remains the largest evidence gap.
