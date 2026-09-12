# PreShoot infrastructure review (READ-ONLY)

**Audience:** Atlas → Daniel executive merge  
**Repo:** https://github.com/Dan904312/PRESHOOT (`main` @ investigation time)  
**Live RC:** https://preshoot.vercel.app  
**Scope:** Evidence from repository source + SQL + `vercel.json`. No deploys, no Supabase changes, no secret rotation, no provider migration, no data deletion, no product-code edits.

**Method:** Grep + file reads of `api/*`, `lib/*`, `js/*`, `app.html`, SQL migrations, `.env.example`. Live RC confirms the shipped app is static HTML (`/app.html`), not the unused Next.js `pages/*` stubs.

**Do not treat this file as a schema or env change.** It is documentation only.

---

## Executive bullets (max 10)

1. **All LLM/vision spend is Anthropic-only, server-side.** Three Vercel routes (`/api/chat`, `/api/director`, `/api/research`) call `https://api.anthropic.com/v1/messages` with `ANTHROPIC_API_KEY`. The browser never holds that key; it posts to PreShoot APIs via `apiFetch` + user JWT.
2. **There is no provider SDK / adapter layer.** Each route `fetch`es Anthropic directly. `lib/ai-pricing.js` is a cost table, not an AI client. Switching providers means editing those three files (plus pricing).
3. **Director is the expensive path.** Hardcoded `claude-sonnet-4-6`, ~16k-char static system prompt, **no prompt caching**, client context budget 26k chars (script protected), last 30 messages, optional image. Scan (`/api/chat`) is also Sonnet but **does** use Anthropic ephemeral prompt cache. Research uses cheaper `claude-haiku-4-5-20251001`.
4. **Context over-send is real and duplicated.** `js/director-context.js` already embeds `PreShootDirectorOS.buildOSContext()` (including a second script excerpt). Studio AI (`js/studio-ui.js` `studioDirectorContextLines`) **appends OS context again**. Script-mutation and shot-plan calls also paste the full script into the **user** message.
5. **Secrets: AI + service role stay server-side.** `ANTHROPIC_API_KEY` / `SUPABASE_SERVICE_KEY` / `STRIPE_SECRET_KEY` / `ADMIN_SECRET` appear only under `api/` and `lib/`. Client `app.html` hardcodes the **anon** JWT (expected public key; JWT `role` is `anon`). No `NEXT_PUBLIC_` AI keys exist.
6. **AuthZ is consistent: JWT → `requireUser` → `requireActiveUser` (suspend gate) → route-specific entitlement.** Guest scans are the exception (IP quota). Shared-workspace mutations check membership/role. Storage paths are ACL’d in `/api/upload`.
7. **User state is JSON in Supabase + `localStorage`, not Markdown.** Director OS “memory” is an in-RAM JS object. Vercel serverless **cannot** persist local `.md` files as user memory. Repo `UPDATE-*.md` files are changelogs, not runtime state.
8. **Cost observability exists.** Successful AI calls write `usage_events` (tokens + `estimated_cost`) and `product_events` (`ai_request` / `api_error`). Admin console aggregates spend vs `ADMIN_*_SPEND_WARN`. Failed upstream calls are **not** ledgered.
9. **Hobby-plan constraint is binding:** exactly **12** Serverless Functions (`tests/vercel-function-budget.test.mjs`). Extra AI routes must be rewrites into existing files, not new `api/*.js` files.
10. **“Use Markdown files for memory” is incorrect for this stack.** Persist compact JSON summaries in `user_data` / `workspace_data` (already the pattern); binaries in Storage; engineering notes in git MD. Not local MD on Vercel.

---

## AI endpoint table

| Public URL | File | Trigger (client) | Auth / entitlement | Provider / model (env names only) | Context sources | Structured output? | Retries | Caching |
|---|---|---|---|---|---|---|---|---|
| `POST /api/chat` | `api/chat.js` | Scan: `app.html` `startScan()` / `startScanFallback()` → `scanChatPayload()` | `requireUser` **or** guest IP quota (`requireGuestScanAccess`). Signed-in: `requireScanAccess` (Pro unlimited; else onboarding credit then `FREE_DAILY_SCANS`). Route RL 30/min. | `ANTHROPIC_API_KEY`. Client may send `claude-sonnet-4-6` or `claude-haiku-4-5-20251001` (`lib/scan-request.js` allowlist; default Sonnet). | **Client-built:** `buildScanSystemPrompt()` + `buildScanUserPrompt()` (niche, platform, goals, aesthetic, gear, format, extra, live trends peek, hook engine) + base64 image (`S.scanB64`). Server: `buildSafeChatBody` (system ≤14k, msgs ≤8, image ≤500k b64 chars). | **Yes — scan JSON** (`ideas[]`, `sceneType`, `sceneLabel`, `mainSubject`). Parsed client-side (`finalParse`). Not Anthropic tool/JSON mode. | Client: stream fail → non-stream fallback (`startScanFallback`). **No server Anthropic retry.** | **Yes:** `anthropic-beta: prompt-caching-2024-07-31` + `cache_control: ephemeral` on system. Ledger records cache write/read units. |
| `POST /api/director` | `api/director.js` | (1) Chat: `app.html` `sendDirector()` (2) Studio advice: `js/studio-ui.js` `requestDirectorExplain` (3) Script AI: `requestScriptAi` (4) Shot plan: `requestShotPlanAi` | `requireUser` (no guest). `requireDirectorAccess` (Pro **or** `director_trial_ends_at` + `DIR_DAILY_MSGS`, default 50). Optional `workspace_id` → `assertWorkspaceMember`; mutation intent → editor+ only. Route RL 40/min. | `ANTHROPIC_API_KEY`. **Hardcoded** `claude-sonnet-4-6` (client cannot pick). | Server `DIRECTOR_SYSTEM` (~16k chars) + sanitized client `context` string (`CONTEXT_BUDGET` 26k, script section preserved by `budgetContext`) + last 30 messages (12k/msg) + optional image. Client context from `PreShootDirectorContext.build` ± OS tools. | **Yes — ad-hoc markers:** `[[ACTION:{...}]]`, `[[QUICK:[...]]]`, `[[SCRIPT:{...}]]`, `[[SHOTS:{...}]]`. Validated client-side (`validateShotPlan`, OS parsers). Not official structured-output API. | Chat: empty SSE **does not** re-call (avoids double bill); JSON fallback only if response was not SSE. Studio script UI has Retry. **No server retry.** | **No** Anthropic prompt cache on this route (no `cache_control`, no `anthropic-beta`). |
| `POST /api/research` | `api/research.js` | `js/creative-research.js`, `js/studio-ui.js` research panel | `requireUser` + `requireResearchAccess` (Pro **or** `studio_trial_ends_at` + `RESEARCH_DAILY_CALLS`, default 30). RL 40/min. | `ANTHROPIC_API_KEY`. **Hardcoded** `claude-haiku-4-5-20251001` (`callClaude`). YouTube: `YOUTUBE_API_KEY` or `GOOGLE_YOUTUBE_API_KEY`. | Clamped idea fields only (`sanitizeContext`: title/hook/niche/format/style ≤ ~400 chars each). **Not** full Studio document. | **Yes — JSON object** extracted from model text (`extractJson`). Fallback queries if parse fails. | **No retries.** Errors returned to client (message sliced). | **No** LLM cache. YouTube/CapCut are search, not model cache. |
| `GET/POST /api/trends` | rewrite → `api/research.js` `handleTrends` | `js/trending.js` | `requireUser` (no Pro gate). RL 30/min; refresh 4 / 15 min. | **No LLM.** Optional YouTube keys above. | Region + optional topic. | N/A | Fail → stale `app_settings` cache. | **Yes:** in-process `memCache` + `app_settings` key `trends_cache_{region}` (TTL 6h, stale 24h). |
| `POST /api/performance` | rewrite → `api/research.js` `handlePerformanceLookup` | `js/studio-ui.js` URL import | `requireUser`. RL 20/min. | **No LLM.** YouTube Data API if key set. TikTok/IG honestly unavailable (`TIKTOK_CLIENT_KEY` / `INSTAGRAM_ACCESS_TOKEN` names only). | URL only. | N/A | No | No |

**Non-AI routes (for completeness, not billed as LLM):** `/api/sync`, `/api/workspaces` (+ rewrites), `/api/upload`, `/api/check-plan` (+ `/api/track-user`), `/api/promo`, `/api/billing-portal`, `/api/webhook`, `/api/admin-auth`, `/api/admin-data`.

**Client never calls Anthropic.** `connect-src` CSP is `'self' https://*.supabase.co wss://*.supabase.co` — browser cannot talk to `api.anthropic.com`.

---

## 1) AI call map (detail)

### `/api/chat` — scene scan (vision)

- **Trigger:** User scans a photo after format lock. Payload built in `app.html` (`scanChatPayload`).
- **Image:** JPEG/PNG/WebP/GIF base64; client rejects `<500` or `>350000` chars; server `sanitizeImage` max `500000` chars.
- **System prompt:** “GENERATE 6 ideas…” + JSON schema + hook engine instructions (`buildScanSystemPrompt`).
- **User prompt:** creator niche/platform/skill/goals/aesthetic/gear/software/locations + format lock + extra + optional trend titles + hook section (`buildScanUserPrompt`).
- **Streaming default;** ledger write happens **after** `res.end()` so the client is not blocked.
- **Guest path:** unauthenticated callers consume Anthropic quota, capped per IP at `FREE_DAILY_SCANS` (default 3 / 24h) via `check_rate_limit` RPC.

### `/api/director` — Director™

- **Static system** `DIRECTOR_SYSTEM` in `api/director.js` (~16,208 characters): identity, PreShoot about-text, hook engine, shot pipeline, ACTION/QUICK/SHOTS contracts. Sent **every** request. Not cached.
- **Client context assembly:** `js/director-context.js` `build()` — see §3.
- **Token cap:** `max_tokens` 1000–4000; long output (script/shots) raises floor to 2800; images to 1600.
- **Workspace:** if `workspace_id` present, membership required; commenter/viewer blocked from mutation-shaped prompts (`detectDirectorMutationIntent`).

### `/api/research` — creative research

- **YouTube adapter:** 1× Haiku JSON plan (`buildYouTubeStrategy`) then YouTube Data API search + rank. No second LLM on the videos.
- **CapCut adapter:** 1× Haiku JSON (`researchCapCut`) then CapCut **template-center search URLs** (no CapCut API; `.env.example` documents this).
- **Module-level `_aiLogUserId`:** request-scoped for cost logging (not a secret; concurrency caveat on a single Node isolate — Vercel is one-request-per-instance in practice).

### Unused / dead AI surfaces

- `pages/director.tsx` is a stub (`import { Chat } from 'some-chat-library'`). **Not on the live RC.** `vercel.json` `"framework": null` serves `index.html` / `app.html`.
- `pages/_app.tsx` references `@supabase/auth-helpers-*` which are **not** in `package.json`. Dead Next scaffolding.

---

## 2) Provider coupling

**Verdict: scattered `fetch` calls. No Anthropic SDK. No provider interface.**

| File | Role |
|---|---|
| `api/chat.js` | Direct Messages API + prompt-cache beta header |
| `api/director.js` | Direct Messages API, model string literal |
| `api/research.js` | `callClaude()` helper local to this file (not shared) |
| `lib/scan-request.js` | Allowlisted model names + cache_control for scan only |
| `lib/ai-pricing.js` | USD/MTok table for sonnet-4-6, haiku-4-5, opus-4 (opus unused in routes) |
| `lib/usage-ledger.js` | Persists provider=`anthropic` |
| `lib/admin-console.js` `probeSystem()` | Presence check of `ANTHROPIC_API_KEY` (boolean only; does **not** echo the key) |
| `.env.example` | Documents `ANTHROPIC_API_KEY` |

**Not present:** OpenAI, Gemini, Groq, LangChain, Vercel AI SDK, `@anthropic-ai/sdk`.

**Handoff implication:** a provider abstraction would be a **new** `lib/ai-client.js` (or similar) consumed by the three routes — not a config flip.

---

## 3) Context size risks (Director / chat)

### Where context is assembled

`js/director-context.js` `build(opts)` concatenates, in order:

1. **CONTEXT CONTRACT** + task (`script` / `shots` / `ideas` / `trends` / `general`)
2. **CURRENT PRODUCTION** — name, status, overview (goal/summary/platform/format/audience/tone/notes), ideaSnapshot hooks, scan subject, **up to 24 shots** with scriptCoverage quotes, **full script** (`MAX_SCRIPT_CHARS = 6000`) or per-line script
3. **CURRENT PROJECT** — id, name, description, goal, type, productionCount
4. **PRODUCTION BRIEF** — JSON `synthesizeBrief()` (subject/audience/purpose/platform/format/tone/coreMessage/constraints)
5. **AVAILABLE EQUIPMENT** — gear inventory + skill/crew/locations (duplicated later in creator profile)
6. **ASSETS** — up to 16 names/notes (not image bytes)
7. **REFERENCES** — up to 8 items × 8 platforms (title/url/creator/note)
8. **CREATOR PROFILE** — niche, platforms, styles, goals, aesthetic, **gear again**, extraContext
9. **CURRENT IDEA** — title, 4 hooks, shot/edit/audio/scene
10. **PERFORMANCE HISTORY** — production metrics + up to 6 imported video records
11. **TRENDS** — up to 8 titles from `PreShootTrending.peekRelevant`
12. **HOME WORKSPACE** if no production
13. **SHARED WORKSPACE** — name, role, revision, presence, 6 activity lines, 8 comments
14. **HOOK ENGINE RULES** (`js/hook-engine.js` `buildDirectorPromptSection`)
15. **Recent scan locations** (5) + **saved idea titles** (5)
16. **DIRECTOR OS** (`js/director-os.js` `buildOSContext`) — surface, location, **CURRENT_SCRIPT another 1,800 chars**, tool manifest, session RAM “memory”

Server then: `sanitizeContext` (cap 26k, max param 40k) + `budgetContext` (never cuts `=== FULL SCRIPT` … `=== END OF SCRIPT ===`; trims before/after).

Chat path (`app.html` `sendDirector`) sends `dirPack.text` **once** (OS already inside).

**Studio path over-send (evidence):** `js/studio-ui.js` `studioDirectorContextLines()`:

```176:187:js/studio-ui.js
  function studioDirectorContextLines() {
    var ctxLines = '';
    try {
      if (global.PreShootDirectorContext && PreShootDirectorContext.build) {
        var packCtx = PreShootDirectorContext.build({ task: 'general' });
        if (packCtx && packCtx.text) ctxLines = packCtx.text;
      }
      if (global.PreShootDirectorOS && global.PreShootDirectorOS.buildOSContext) {
        ctxLines = (ctxLines ? ctxLines + '\n\n' : '') + global.PreShootDirectorOS.buildOSContext();
      }
```

That **double-appends** OS (tools + script excerpt) on explain / script AI / shot-plan.

**Triple script risk on script mutation** (`requestScriptAi`): CREATOR CONTEXT full script + OS `CURRENT_SCRIPT` + user message `EXISTING SCRIPT` block.

**Shot-plan** (`requestShotPlanAi`): same duplicated context + `max_tokens: 4000` + required `[[SHOTS:...]]` JSON. Local `js/shot-planner.js` already planned a list; AI is an overlay that can be rejected.

**`getDirectorContext` computes `studio: exportForSync()`** (`js/studio.js` ~3609) but `director-context.js` does **not** dump the whole Studio tree into the prompt — only the focused production/project. Good. Do not start sending `exportForSync()` into the model.

**Scan over-send (milder):** profile + trends + hook templates + 6-idea JSON schema every scan. System is cache-marked ephemeral (helps repeated identical system text within Anthropic’s cache window; unique images still miss cache on the image block).

**Director system prompt is never cached** and is larger than the scan system prompt (~16k vs ~2.3k region). Highest-ROI cache target.

---

## 4) Secrets exposure

### Confirmed server-only (names)

| Name | Used in |
|---|---|
| `ANTHROPIC_API_KEY` | `api/chat.js`, `api/director.js`, `api/research.js`; presence probe in `lib/admin-console.js` |
| `SUPABASE_SERVICE_KEY` | All privileged REST/Storage/Auth-admin via `lib/security.js` `serviceHeaders()` |
| `SUPABASE_URL` | Server + **also hardcoded** as public project URL in `app.html` |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Server JWT verify fallback (`supabaseAuthApiKey()`); **not** required in client because anon JWT is inlined |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `api/billing-portal.js`, `api/webhook.js` |
| `ADMIN_SECRET` | `lib/admin-session.js` / `api/admin-auth.js` (never returned) |
| `RESEND_API_KEY`, `EMAIL_FROM` | `lib/email.js` |
| `YOUTUBE_API_KEY` / `GOOGLE_YOUTUBE_API_KEY` | `api/research.js`, `lib/trends.js` |
| `JOIN_CODE_PEPPER` | `lib/workspaces.js` (falls back to **service key**, then static string `'preshoot-join-v1'`) |
| `PROMO_CODES` | Server seed for `promo_codes` |

`lib/security.js` comments: service key is “never sent to the browser.” Grep of `app.html` / `js/` / `admin.html` found **no** `ANTHROPIC`, **no** `SERVICE_KEY`, **no** `STRIPE_SECRET`, **no** `ADMIN_SECRET` values.

### Client-visible (expected / review)

- **`app.html` ~L2519–2520:** `SUPA_URL` + `SUPA_KEY` inlined. JWT payload `role` is **`anon`** (not `service_role`). This is the standard Supabase publishable key. Treat as public; **RLS must hold**. Do not rotate as if it were the service role.
- **`next.config.js` `env.CUSTOM_API_URL`:** default `https://api.preshot.com` — would be inlined **if** Next built; live RC does not use this Next config (`framework: null`).
- **Admin `probeSystem`:** returns `'Anthropic key present (live model call not performed)'` — boolean, not the secret (`lib/admin-console.js` ~388–392).

### No client-bundle AI key pattern

No `NEXT_PUBLIC_ANTHROPIC`, no `sk-ant-` in client files, no Anthropic host in CSP `connect-src`.

---

## 5) Supabase usage in code

### Tables referenced (code + SQL)

| Table | Writers (service role) | Client JWT |
|---|---|---|
| `users` | `api/check-plan.js`, entitlements, account-status, admin | RLS `users_select_own` + GRANT SELECT authenticated |
| `user_data` | `api/sync.js` (JWT user_id only; rejects shared `workspace_id`) | RLS `user_data_select_own` + Realtime subscribe (`js/studio-sync.js`) |
| `subscriptions` | webhook, promo RPC, admin | RLS `subscriptions_select_own` |
| `usage_daily` | `bump_usage_daily` RPC / legacy upsert | No client grant |
| `usage_events` | `lib/usage-ledger.js` | No client grant (`supabase_admin_console.sql` REVOKE) |
| `product_events` | `lib/product-events.js`, check-plan | Phase 6: select own |
| `promo_codes`, `promo_usage` | `api/promo.js` / `redeem_promo_code` | No client |
| `subscription_events`, `processed_stripe_events` | `api/webhook.js` | No client |
| `rate_limits` | `check_rate_limit` RPC | No client |
| `admin_sessions` | `lib/admin-session.js` | No client |
| `admin_audit_log`, `admin_email_log`, `app_settings` | admin console / trends cache | No client |
| `admin_notifications` | `lib/admin-notifications.js` | SQL file **referenced** (`supabase_admin_notifications.sql`) **not in this repo snapshot** |
| `workspaces`, `workspace_members`, `workspace_data`, `workspace_invites` | `lib/workspaces.js` | SELECT member-only; **mutations service-role only** (comment in `supabase_workspaces_phase1.sql`) |
| `workspace_document_versions` | workspaces API | member SELECT |
| `workspace_comments`, `workspace_notifications` | `lib/workspace-comments.js` | member / own SELECT |
| `content_performance` | Phase 7 | owner RLS |
| `activity_events`, `streak_rewards` | `lib/entitlements.js` upserts | **CREATE TABLE not in repo SQL** — code has fallback if missing |

### RLS assumptions (from SQL comments)

- `supabase_setup.sql`: “Client uses anon key; all privileged access goes through Vercel APIs with service role. Deny all direct client access by default.” Then **optional** own-row SELECT on `subscriptions`, `user_data`, `users`.
- Workspace: “Mutations (including optimistic revision saves) are service-role API only. Do not grant authenticated UPDATE — that would bypass `/api/workspace-sync` 409 checks.” Invites/`token_hash` not readable via client JWT.
- Phase 6 storage: policies on `storage.objects` **deny** anon/authenticated on bucket `production-assets` (`USING (bucket_id IS DISTINCT FROM 'production-assets')`). Uploads must go through `/api/upload` signed URLs.

### Admin / service-role in `api/*`

Every data API except Stripe webhook signature verification uses `SUPABASE_SERVICE_KEY` as both `apikey` and `Authorization` bearer. Service role **bypasses RLS** — authorization is application-level (`requireUser` + membership helpers).

### Storage

- **Bucket id:** `production-assets` (private, 12MB, MIME allowlist).
- **Paths:** `{userId}/{productionId}/{assetId}.{ext}` or `workspaces/{workspaceId}/{productionId}/{assetId}.{ext}`.
- **Flow:** `api/upload.js` create signed upload (120s) → client PUT → `complete` / `sign_download` (1h) / `delete`. Direct `put` for ≤900KB base64.
- **ACL:** `assertStoragePathAccess` — personal prefix must match JWT `user.id`; workspace prefix requires member (edit for write).

---

## 6) AuthZ patterns

**Hub:** `lib/security.js`

| Helper | Behavior |
|---|---|
| `requireUser` | Bearer JWT → `GET {SUPABASE_URL}/auth/v1/user` → `requireActiveUser` |
| `requireActiveUser` | `users.account_status`; `suspended` → 403; missing column → 503 `account_status_unconfigured`; other/unavailable → 503 |
| `requireScanAccess` | Pro skip quota; else onboarding credit; else `scans` daily cap |
| `requireDirectorAccess` | Pro or director trial overlay + `director_msgs` cap |
| `requireResearchAccess` | Pro or studio trial + `research_calls` cap |
| `gateRouteRateLimit` | `check_rate_limit` RPC; memory fallback **per isolate** (not global) |
| `requireAdminSession` | HttpOnly cookie vs hashed `admin_sessions` (`lib/admin-session.js`) |

**Suspend gate:** all JWT routes that call `requireUser` inherit it (chat, director, research, sync, workspaces, upload, promo, billing-portal, check-plan). Chat guests skip JWT (IP quota only). Webhook is Stripe-signature, not user JWT. Admin is shared secret + session cookie, not user JWT.

**Ownership:**

- `/api/sync` binds `user_id` from JWT, ignores client `user_id` for writes (client still sends it; server does not trust it).
- Workspaces: `assertWorkspaceMember` / `assertWorkspaceRole` on every mutating path (`api/workspaces.js`).
- Upload path prefix checks (`lib/workspaces.js` `assertStoragePathAccess`).
- Director shared workspace: mutation intent + `roleCanEdit`.

**Client-side Director 50-msg cap** (`app.html` `dir_today` localStorage) is **UX only**. Server `DIR_DAILY_MSGS` is authoritative.

---

## 7) Markdown-as-memory — verdict

### What exists today

| Mechanism | Persistence | What it stores |
|---|---|---|
| `localStorage` `scout_*` | Browser | profile, niche, gear, prefs, studio nav, hook frameworks used, trend region, first-run, etc. |
| `user_data` JSON columns | Postgres | history, library, director_history, niche, gear, prefs (incl. `director_convs`, `studio`) |
| `workspace_data.document` | Postgres JSON | shared Studio tree + revision |
| `js/director-os.js` `memory` | **Process RAM** | lastObject / lastAction / lastIntent / lastFocus / turns — **lost on reload** |
| `lib/trends.js` `memCache` | **Function RAM** | trend payloads until isolate recycle; durable copy in `app_settings` |
| Repo `UPDATE-*.md`, `README.md` | Git | engineering changelog — **not** user memory |
| `docs/generate_update_security_log.py` | Git → PDF | security log generator |

**No runtime Markdown memory store.** No `fs.writeFile` of per-user `.md`. No vector store.

### Can Vercel serverless persist local MD for user state?

**No.** Each invocation is a fresh isolate. `/tmp` is ephemeral and not shared across instances or deploys. Git-backed MD cannot be written from production functions without a commit pipeline (wrong tool, racey, leaks into the repo, no RLS). Hobby functions also have a **12-function budget** and ~10s practical timeout (`fetchWithTimeout` comments).

### Recommended persistence by use case

| Use case | Recommendation | Why |
|---|---|---|
| Creator profile, niche, gear, prefs | **DB JSON** (`user_data` — already) | Small, queryable, RLS/API already exist |
| Personal Studio tree | **DB JSON** (`user_data.prefs.studio` / `studio`) | Already synced via `/api/sync` |
| Shared Studio | **DB JSON** (`workspace_data`) + versions table | Concurrency/RLS already designed |
| Director chat transcripts | **DB JSON** inside `prefs.director_convs` (already clipped to 20) | Not MD files |
| Compact “memory summaries” for cheaper prompts | **DB JSON** new column or `prefs.director_summary` (short) | Fits 26k budget; cacheable later |
| Binary assets / refs | **Object storage** `production-assets` | Already; never base64 into LLM except scan |
| Trend cache | **`app_settings` JSON** (already) | Cross-isolate; not user-specific |
| Engineering runbooks, Atlas notes | **Repo Markdown** | Human, versioned, not per-user |
| Per-user Markdown on disk / in repo | **Do not** | Serverless + multi-instance + privacy |

**Validate external “just use MD files” advice: incorrect for PreShoot’s Vercel + Supabase architecture.**

---

## 8) Observability (tokens / cost)

**Present:**

- `lib/ai-pricing.js` — micros-accurate USD from input/output/cache tokens; models sonnet-4-6, haiku-4-5, opus-4.
- `lib/usage-ledger.js` → `usage_events` (`event_type` scan / director_request / research; **no prompts/images/keys**).
- `trackProductEventServer(..., 'ai_request', { endpoint, model, input_tokens, output_tokens, cost_usd })` on **non-stream** chat + director + research. **Stream chat/director log `ai_request` without token/cost** (tokens only in ledger after stream parse).
- `api_error` product events on upstream failures.
- Admin: `lib/admin-console.js` rollups, `ADMIN_DAILY_SPEND_WARN` / `ADMIN_MONTHLY_SPEND_WARN` / `ADMIN_USER_SPEND_WARN` (display flags, **do not auto-ban** — `.env.example`).
- `scan_timing` / `trends_timing` console logs (no user ids / no prompts).

**Gaps:**

- No OpenTelemetry / Langfuse / Anthropic usage dashboard integration in-repo.
- Failed AI calls skipped in ledger (`status !== 'success'` → `{ skipped: true }`).
- Stream token parse is regex-on-last-8k-SSE (`parseAnthropicStreamUsage`) — can under-count if usage frame is truncated.
- Guest scans: **no** `user_id` on ledger (`persistScanSuccess` only if `user`).
- Client Director localStorage counter can diverge from server quota.

---

## Cost architecture findings (think less / cache / minimize)

**Highest ROI (no provider migration):**

1. **Prompt-cache Director’s static `DIRECTOR_SYSTEM`** the same way scan does (`cache_control: ephemeral` + beta header). ~16k tokens of identical prefix on every Director call currently billed at full input rate ($3/MTok sonnet input vs $0.30/MTok cache read per `lib/ai-pricing.js`).
2. **Stop double OS context** in `studioDirectorContextLines` (DirectorContext.build already includes OS).
3. **Stop triple-sending scripts** on script-mutation / shot-plan (trust CREATOR CONTEXT script; user message = instruction only).
4. **Task-gated payloads:** `director-context.js` already skips script/shots/assets for `task === 'trends'`. Studio callers pass `task: 'general'` always — they should pass `script` / `shots`.
5. **Trim DIRECTOR_SYSTEM.** Identity + shot pipeline + ACTION grammar are necessary; duplicated “ABOUT PRESHOOT” / long philosophy blocks compete with the 26k creator budget.
6. **Keep research on Haiku.** Do not “upgrade” YouTube query planning to Sonnet.
7. **Keep scan cache.** Consider pinning system prompt so it is byte-stable (cache hits).
8. **Do not send `exportForSync()`** or raw images (except scan / explicit Director image) into prompts. Assets are names/notes only — keep it that way.
9. **Guest scans are unpaid Anthropic burn** (IP-capped). Monitor `usage_events` with `user_id` null / guest metadata if you start logging them.
10. **Hobby timeout:** `fetchWithTimeout` 5.5s default; Anthropic streams can still hit platform kill. Caching + smaller context reduces TTFB and timeout waste (retries would **double** spend — currently avoided on Director empty-SSE).

**Think-less:** Anthropic extended thinking is **not** enabled (no `thinking` param). Do not add it on scan/research. If added on Director, gate to script/shots only and budget output tokens.

---

## Security findings (Critical → Info)

### Critical

*None confirmed in this pass for key leakage of service role / Anthropic / Stripe to the browser.*

### High

1. **Service role is the data plane.** Every API uses it and **bypasses RLS**. A bug in `user_id` binding is a full-table issue. Current sync/workspaces code binds JWT id; keep that invariant. Evidence: `lib/security.js` `serviceHeaders`; `api/sync.js` `const user_id = auth.user.id`.
2. **Guest `/api/chat` spends Anthropic without an account.** Mitigated by IP `FREE_DAILY_SCANS` + route RL 30/min, but shared NATs can starve or a botnet can rotate IPs. Evidence: `api/chat.js` `requireGuestScanAccess`.

### Medium

3. **`JOIN_CODE_PEPPER` fallback to `SUPABASE_SERVICE_KEY`**, then to literal `'preshoot-join-v1'`. Pepper should be a dedicated secret; using the service key couples join-code hashes to key rotation; static fallback is guessable if env is missing in a non-prod deploy. Evidence: `lib/workspaces.js` `joinCodePepper()`.
4. **Authenticated GRANT SELECT on `user_data` / `users` / `subscriptions`.** Intentional for Realtime, but any XSS in `app.html` (large inline JS) can read the user’s own JSON (history, director convos) via the anon client. Defense is CSP + no innerHTML of model output (spot-check `esc()` usage in Studio UI; chat bubbles still need care).
5. **Research/Director error strings.** Research throws `'AI error: ' + err.slice(0, 120)` to the client (`api/research.js`). Director non-production leaks `error.message`. Prefer the scan pattern (`publicScanErrorMessage`).
6. **Rate-limit memory fallback is per-instance.** If Supabase RPC is down, quotas are not global — burst spend possible. Evidence: `lib/security.js` `rateLimitMemory`.

### Low

7. **Hardcoded anon JWT in git** (`app.html`). Normal for Supabase; still means key rotation requires a deploy. Confirm Dashboard anon key matches; never commit service_role.
8. **Dead Next helpers** (`pages/_app.tsx` `createBrowserSupabaseClient()`) would look for `NEXT_PUBLIC_SUPABASE_*` if someone enabled Next by mistake. Keep `framework: null` or delete stubs.
9. **Upload `detail: err.slice(0, 120)`** on storage failure (`api/upload.js`) may leak upstream text.
10. **`supabase_admin_notifications.sql` and `activity_events` / `streak_rewards` CREATE TABLE** are referenced in code but missing from this repo snapshot — production may have been patched in Dashboard only (drift risk).

### Info

11. **Admin Anthropic probe** does not call the model (good for cost; does not prove the key works).
12. **CSP** blocks Anthropic from the browser (good).
13. **Webhook** raw-body 256KB + `claim_stripe_event` idempotency (good).
14. **Promo codes** env-seeded with max redemptions, not unlimited (good).

---

## Storage / bucket references

| Ref | Location |
|---|---|
| Bucket `production-assets` | `api/upload.js` `BUCKET`; `supabase_setup.sql` comments; Phase 6 storage policies |
| Path `userId/productionId/assetId.ext` | `api/upload.js` create |
| Path `workspaces/{uuid}/productionId/assetId.ext` | same; editor+ |
| Signed upload 120s / download 1h | `api/upload.js` |
| Client complete/delete/sign_download | `js/studio-ui.js` |
| Admin health `GET /storage/v1/bucket` | `lib/admin-console.js` `probeSystem` |
| Realtime `user_data` | `js/studio-sync.js` filter `user_id=eq.{uid}` |
| Realtime workspace broadcast/presence | `js/workspace-realtime.js` + Phase 3A/5B SQL on `realtime.messages` |

No other buckets referenced in code.

---

## CURSOR HANDOFF stubs (files likely affected — no implementation)

Use these as starting points only. **Do not implement in this review.**

### H1 — Director prompt cache + system trim
- `api/director.js` (`DIRECTOR_SYSTEM`, Messages headers, `anthropicBody.system` as cacheable block)
- `lib/scan-request.js` (copy cache_control pattern)
- `lib/ai-pricing.js` (already prices cache hits)
- Tests: `tests/director-context-quality.test.mjs` (size assertions)

### H2 — Deduplicate Studio context
- `js/studio-ui.js` `studioDirectorContextLines`, `requestScriptAi`, `requestShotPlanAi`, `requestDirectorExplain`
- `js/director-context.js` (task param from Studio; skip OS if caller will not double-append)
- `js/director-os.js` `buildOSContext` (drop `CURRENT_SCRIPT` if full script already in contract)

### H3 — Guest-scan cost controls
- `api/chat.js` `requireGuestScanAccess`
- `lib/usage-ledger.js` (optional guest metadata without PII)
- `lib/security.js` `FREE_DAILY_SCANS`

### H4 — Dedicated join-code pepper
- `lib/workspaces.js` `joinCodePepper`
- `.env.example` `JOIN_CODE_PEPPER`
- **Do not rotate `SUPABASE_SERVICE_KEY` as a side effect** (would invalidate hashes if currently used as pepper)

### H5 — Schema drift
- Add missing SQL to repo if production already has `admin_notifications`, `activity_events`, `streak_rewards` (copy from Dashboard; do not invent columns)
- `lib/entitlements.js`, `lib/admin-notifications.js`, `api/admin-data.js`

### H6 — Provider abstraction (only if Atlas chooses multi-model)
- New `lib/ai-client.js`
- Consumers: `api/chat.js`, `api/director.js`, `api/research.js`
- Keep Hobby function count = 12 (`scripts/assert-hobby-function-budget.mjs`)

### H7 — Compact Director memory (JSON, not MD)
- `api/sync.js` prefs clip limits
- `user_data.prefs` or new jsonb column
- `js/director-os.js` (replace RAM `memory` with loaded summary)
- **Not** repo Markdown; **not** `/tmp`

---

## Live RC notes

- https://preshoot.vercel.app serves the HTML app (`vercel.json` routes `/` → `index.html`, `/app.html` → `app.html`).
- CSP and `api/` `Cache-Control: no-store` match `vercel.json`.
- This review did **not** authenticate to production, list Supabase rows, or print env values.

---

## Appendix — API inventory (12 Hobby functions)

`admin-auth.js`, `admin-data.js`, `billing-portal.js`, `chat.js`, `check-plan.js`, `director.js`, `promo.js`, `research.js`, `sync.js`, `upload.js`, `webhook.js`, `workspaces.js`.

Rewrites: `/api/track-user` → check-plan; `/api/trends` + `/api/performance` → research; `/api/workspace-sync` + `/api/workspace-invites/accept` + `/api/workspaces/*` → workspaces.
