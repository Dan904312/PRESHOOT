#!/usr/bin/env python3
"""
Generate PreShoot_Update_Security_Log.pdf from verified update entries.

Run from project root:
  PYTHONPATH=./.tools/reportlab_pkg python3 docs/generate_update_security_log.py
"""

from __future__ import annotations

import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
    HRFlowable,
)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_PDF = os.path.join(ROOT, "PreShoot_Update_Security_Log.pdf")

CURRENT_VERSION = "v2.7.7"
LAST_UPDATED = "2026-08-08"
PROJECT = "PreShoot"
DOC_TITLE = "Update & Security Log"

# ── Verified entries only (do not invent) ───────────────────────────────────
# Sources: git commits in this repository + this documentation setup task.
# Pre-git product history is recorded as unavailable.

UPDATES = [
    {
        "id": "UPDATE-0017",
        "version": "v2.7.7",
        "date": "2026-08-08",
        "categories": ["Bug Fix", "Backend", "AI System", "UI/UX", "Performance", "Database"],
        "title": "Studio reliability — sync authority, Director execute/verify, mobile voice/layout",
        "what_changed": (
            "Stabilized Studio without a redesign: sync is pull-merge-first with alwaysPush for "
            "profile/library saves; logout clears user local caches; Director mutations require "
            "confirm → execute → verify before Completed; mobile voice hard-fails on mic denial "
            "and avoids iOS dual-mic conflicts; Studio mobile padding/keyboard scroll fixed "
            "without moving the bottom nav; Natural-language rename patterns expanded; "
            "supabase_setup documents enabling Realtime on user_data."
        ),
        "files": [
            "js/studio-sync.js",
            "js/studio-ui.js",
            "js/director-voice.js",
            "js/director-os.js",
            "js/studio-keyboard.js",
            "api/sync.js",
            "app.html",
            "supabase_setup.sql",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Cross-device stale overwrites (push-first dirty), Director claiming Done without "
            "mutating, mobile voice soft-fail Listening, and Studio double bottom padding / "
            "keyboard scroll issues."
        ),
        "risk_level": "High",
        "risk_description": (
            "Users lose work across devices; Director appears broken; voice fails silently on "
            "mobile; Studio UI is clunky on phones."
        ),
        "fix_applied": (
            "Server-authoritative flush/reconcile, mutation verification, mobile mic/layout "
            "hardening, and safer logout cache clearing."
        ),
        "testing": (
            "node --check on modified JS; static review of rename/verify paths and flush "
            "alwaysPush; Realtime requires one-time SQL ALTER PUBLICATION on user_data."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0016",
        "version": "v2.7.6",
        "date": "2026-08-07",
        "categories": ["Security", "Backend", "API", "Database", "Dependency", "Infrastructure"],
        "title": "Phase 6 — Webhook idempotency, atomic quotas, sync limits, deps",
        "what_changed": (
            "Hardened production reliability: Stripe webhooks now enforce a 256KB body cap, "
            "verify signatures before work, and claim event IDs via processed_stripe_events / "
            "claim_stripe_event (duplicates ignored). Usage quotas use atomic bump_usage_daily "
            "RPC. /api/sync hard-rejects oversized payloads with per-field caps. package.json "
            "slimmed to pinned stripe@17.7.0 with lockfile; unused latest deps removed. "
            "Webhook errors no longer echo Stripe internals to clients."
        ),
        "files": [
            "api/webhook.js",
            "api/sync.js",
            "lib/security.js",
            "supabase_setup.sql",
            "package.json",
            "package-lock.json",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Production reliability vulnerabilities including webhook duplication, quota race "
            "conditions, oversized sync payloads, and dependency risks from floating latest packages."
        ),
        "risk_level": "High",
        "risk_description": (
            "Incorrect billing states, quota bypasses, storage abuse, and future supply-chain "
            "vulnerabilities."
        ),
        "fix_applied": (
            "Added webhook idempotency, atomic usage handling, sync validation, and dependency "
            "hardening."
        ),
        "testing": (
            "node --check webhook/sync/security; mocked duplicate webhook claim returns duplicate; "
            "sync rejects oversized payload; npm lockfile generated for stripe@17.7.0."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0015",
        "version": "v2.7.5",
        "date": "2026-08-07",
        "categories": ["Security", "Infrastructure", "Deployment"],
        "title": "Phase 5 — CSP and browser security header hardening",
        "what_changed": (
            "Hardened vercel.json Content-Security-Policy: removed unsafe-eval and unused script "
            "CDNs (esm.sh, unpkg); restricted connect-src to self + Supabase only (dropped browser "
            "Anthropic/Google API/Stripe connect); tightened img-src to trusted hosts; added "
            "object-src/frame-src none, upgrade-insecure-requests, HSTS, and COOP "
            "same-origin-allow-popups. Retained script/style unsafe-inline required by current "
            "HTML inline boot + app scripts."
        ),
        "files": [
            "vercel.json",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Weak Content Security Policy increased XSS risk (unsafe-eval, broad connect-src, "
            "unused script CDNs)."
        ),
        "risk_level": "High",
        "risk_description": (
            "Injected scripts could access user data or sessions; overly broad connect-src "
            "expanded blast radius if XSS occurred."
        ),
        "fix_applied": (
            "Hardened CSP rules and improved browser security headers while preserving required "
            "jsDelivr (GSAP/Supabase/OGL), Google Fonts, and inline script/style compatibility."
        ),
        "testing": (
            "Validated CSP string for required app hosts; confirmed no eval/new Function in repo; "
            "documented residual unsafe-inline until inline scripts are externalized."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0014",
        "version": "v2.7.4",
        "date": "2026-08-07",
        "categories": ["Security", "Authentication", "API", "Backend", "Database"],
        "title": "Phase 4 — Admin HttpOnly session cookies",
        "what_changed": (
            "Removed browser-stored admin secrets (sessionStorage ak / x-admin-key). Added "
            "/api/admin-auth login-logout-session flow that sets an HttpOnly SameSite cookie and "
            "stores only a SHA-256 token hash in admin_sessions. /api/admin-data now requires a "
            "valid unexpired server session and explicitly rejects legacy x-admin-key headers."
        ),
        "files": [
            "lib/admin-session.js",
            "api/admin-auth.js",
            "api/admin-data.js",
            "admin.html",
            "lib/security.js",
            "supabase_setup.sql",
            ".env.example",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Admin secret stored in browser sessionStorage and resent on every admin API call."
        ),
        "risk_level": "High",
        "risk_description": (
            "Admin account compromise through XSS, browser extensions, or shared devices."
        ),
        "fix_applied": (
            "Implemented secure server-side admin sessions using HttpOnly cookies with hashed "
            "tokens in Supabase; logout revokes the session server-side and clears the cookie."
        ),
        "testing": (
            "node --check admin session modules; mocked login creates cookie session; "
            "admin-data rejects x-admin-key; logout/revoke invalidates session."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0013",
        "version": "v2.7.3",
        "date": "2026-08-07",
        "categories": ["Security", "API", "Backend", "Infrastructure", "Database"],
        "title": "Phase 3 — Distributed rate limiting via Supabase",
        "what_changed": (
            "Replaced in-memory Map rate limits with shared Supabase rate_limits table and "
            "atomic check_rate_limit RPC. Routes gate by user ID when authenticated and by IP "
            "otherwise. Applied to director, chat, research, sync, promo, admin, track-user, "
            "check-plan, and billing-portal. 429 responses include Retry-After and clear retry timing."
        ),
        "files": [
            "lib/security.js",
            "api/director.js",
            "api/chat.js",
            "api/research.js",
            "api/sync.js",
            "api/promo.js",
            "api/admin-data.js",
            "api/track-user.js",
            "api/check-plan.js",
            "api/billing-portal.js",
            "supabase_setup.sql",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "In-memory rate limiting could be bypassed in serverless environments because each "
            "Vercel instance had separate counters."
        ),
        "risk_level": "High",
        "risk_description": (
            "AI/API abuse and unexpected infrastructure costs via cross-instance request spreading."
        ),
        "fix_applied": (
            "Implemented distributed server-side rate limiting with Supabase-backed counters; "
            "memory Map retained only as degraded fallback if RPC unavailable."
        ),
        "testing": (
            "node --check on security + API routes; mocked RPC verifies allow then 429 with "
            "retry_after; separate user keys do not collide; memory fallback when RPC missing."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0012",
        "version": "v2.7.2",
        "date": "2026-08-07",
        "categories": ["Security", "API", "Backend", "Database", "Authentication"],
        "title": "Phase 2 — Promo code redemption limits + expiry",
        "what_changed": (
            "Secured /api/promo against unlimited shared Pro grants. Added promo_codes catalog "
            "(max_redemptions, redemption_count, expires_at, active), unique per-user promo_usage, "
            "and atomic redeem_promo_code RPC. API validates active/expiry/limit/already-redeemed "
            "server-side before granting Pro. Env PROMO_CODES still seeds limited DB rows."
        ),
        "files": [
            "api/promo.js",
            "supabase_setup.sql",
            ".env.example",
            "app.html",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Promo codes could grant unlimited shared Pro access with no expiry, max redemptions, "
            "or per-user redemption protection."
        ),
        "risk_level": "High",
        "risk_description": (
            "Unauthorized Pro account creation and subscription abuse via leaked or shared codes."
        ),
        "fix_applied": (
            "Added redemption limits, expiry validation, and per-user redemption tracking via "
            "promo_codes + redeem_promo_code; client user_id/email no longer trusted for grant."
        ),
        "testing": (
            "node --check api/promo.js; mocked redeem paths for valid, expired, limit_reached, "
            "already_redeemed, and env-seed bootstrap; frontend shows server message on reject."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0011",
        "version": "v2.7.1",
        "date": "2026-08-07",
        "categories": ["Security", "API", "Backend", "AI System", "Database"],
        "title": "Phase 1 — Research endpoint entitlement + usage limits",
        "what_changed": (
            "Hardened /api/research so authenticated free users cannot burn Anthropic/YouTube "
            "quota. Added requireResearchAccess: server-side JWT identity, subscription plan from "
            "Supabase (never client S.plan), Pro-only gate, and daily research_calls tracking via "
            "usage_daily. Clear 403/429 errors for free and over-limit Pro users."
        ),
        "files": [
            "lib/security.js",
            "api/research.js",
            "supabase_setup.sql",
            ".env.example",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Research endpoint lacked subscription enforcement. Authenticated users could call "
            "/api/research without Pro/quota checks, enabling AI/API cost abuse."
        ),
        "risk_level": "High",
        "risk_description": (
            "Potential AI/API cost abuse: free accounts or stolen sessions could consume expensive "
            "Anthropic and optional YouTube Data API calls without entitlement limits."
        ),
        "fix_applied": (
            "Added server-side entitlement verification (getSubscription) and usage limits "
            "(research_calls / RESEARCH_DAILY_CALLS, default 30) before external research calls. "
            "SQL schema documents research_calls column + ALTER for existing deployments."
        ),
        "testing": (
            "node --check api/research.js lib/security.js; verified free path returns pro_required "
            "before adapters; Pro path increments research_calls; client plan mutation cannot "
            "bypass server checks; quota_exceeded after daily limit."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0010",
        "version": "v2.7.0",
        "date": "2026-07-30",
        "categories": ["Bug Fix", "Feature", "Backend", "UI/UX", "AI System"],
        "title": "Phase 3 — Reliable Studio sync + Production Workspace",
        "what_changed": (
            "Fixed multi-device Studio sync: empty local stores no longer stamp updatedAt=now and "
            "block/overwrite cloud projects. Added per-project/production merge by updatedAt, dirty "
            "flag + offline-safe push queue, faster debounce, visibility/online flush, focus pull, "
            "and Supabase realtime listener when available. Built Production Workspace with stage "
            "rail, Overview (summary/goal/platform/format), and placeholder Shot List / Script / "
            "References / Assets sections. Director getDirectorContext prepared for later AI."
        ),
        "files": [
            "js/studio.js",
            "js/studio-sync.js",
            "js/studio-ui.js",
            "app.html",
            "api/sync.js",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Device B login skipped cloud Studio because emptyStore() used Date.now() as "
            "updatedAt, then subsequent saves could wipe Device A projects via prefs.studio LWW."
        ),
        "risk_level": "High",
        "risk_description": (
            "Sync bugs could delete user projects across devices. Mitigated with empty-store "
            "timestamp fix, merge-by-id, dirty queue, and pull-before-push on reconnect."
        ),
        "fix_applied": (
            "mergeStudioStores + applyCloudStudio; PreShootStudioSync push/pull/flush/realtime; "
            "Production Workspace UI sections."
        ),
        "testing": (
            "node --check studio.js/studio-sync.js/studio-ui.js; Node merge unit tests for fresh "
            "device hydrate and conflicting edits; verify Home scan / Library / Studio wiring intact."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0009",
        "version": "v2.6.0",
        "date": "2026-07-30",
        "categories": ["UI/UX", "UI Design", "Feature"],
        "title": "Phase 2 — Studio UI & project management experience",
        "what_changed": (
            "Polished Studio into a mobile-first creative workspace. Redesigned project cards "
            "(progress bars, muted status pills), project dashboard, production cards with "
            "relative updated dates, stepped New Project flow (name → description → optional "
            "cover), simplified New Production flow, premium Continue Working card, polished "
            "empty states, responsive multi-column desktop grid, and Director AI placeholder "
            "buttons (non-functional). Phase 1 data model and Home/Library scanning preserved."
        ),
        "files": [
            "js/studio-ui.js",
            "app.html",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Phase 1 Studio was functional but visually basic — needed Files-like polish, "
            "clearer status UI, and stepped create flows without rebuilding architecture."
        ),
        "risk_level": "Low",
        "risk_description": (
            "UI-only Studio polish; risk limited to regressions in create/open flows. "
            "Data layer unchanged; Home scan and Library untouched."
        ),
        "fix_applied": (
            "Reworked PreShootStudioUI rendering + Studio CSS tokens; stepped wizard modal; "
            "Continue Working premium card; Director placeholders marked Soon."
        ),
        "testing": (
            "node --check studio-ui.js; browser verification of Studio nav, create project "
            "wizard, production cards, continue card, and preserved Home scan."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0008",
        "version": "v2.5.0",
        "date": "2026-07-30",
        "categories": ["Feature", "UI/UX", "Backend", "Database", "AI System"],
        "title": "Phase 1 — Studio foundation: Projects, Productions, nav, Send to Studio",
        "what_changed": (
            "Phase 1 of the Creative OS redesign. Bottom nav is now Home / Library / Studio / "
            "Menu / Profile (center Scan replaced by Studio; scanning remains on Home). Added "
            "Project + Production data models with create/rename/delete/archive/restore/"
            "duplicate/move, production statuses (Planning → Posted + Archived), Studio "
            "dashboard, blank productions, Send to Studio confirm flow with project "
            "recommendation (never auto-moves), Continue Working card on Home (never "
            "auto-redirects), and Director capability manifest stubs for future project "
            "actions. Persistence via localStorage + prefs.studio cloud sync (no required "
            "DB ALTER). Existing Home scan, Library, auth, personalization, and Director chat "
            "preserved."
        ),
        "files": [
            "js/studio.js",
            "js/studio-ui.js",
            "app.html",
            "api/sync.js",
            "supabase_setup.sql",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "PreShoot had no production workspace — only scan history/library. Redesign "
            "required a Project/Production foundation without rewriting or breaking scans."
        ),
        "risk_level": "Medium",
        "risk_description": (
            "Nav change could confuse Scan-first users; Studio sync must not wipe existing "
            "prefs/history. Mitigated by keeping Home scan intact, nesting studio in "
            "prefs.studio for seamless sync, and never auto-redirecting."
        ),
        "fix_applied": (
            "Modular PreShootStudio data layer + PreShootStudioUI; Studio tab; confirm-only "
            "Send to Studio; Continue Working prompt; Director action registry not executable yet."
        ),
        "testing": (
            "node --check on studio.js/studio-ui.js; Node data-layer CRUD/recommend/continue/"
            "director-stub tests; app.html wiring checks for nav-studio, screen-studio, "
            "modals, Send to Studio, continue-working, and preserved scan-ring/library/director."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0007",
        "version": "v2.4.0",
        "date": "2026-07-30",
        "categories": ["Feature", "AI System", "UI/UX", "API", "Privacy"],
        "title": "Creative Research System — CapCut connection + ranked YouTube/CapCut recommendations",
        "what_changed": (
            "Replaced placeholder CapCut homepage / generic YouTube keyword deep links with a "
            "modular Creative Research system. Idea sheets now open curated research panels. "
            "Server /api/research builds creative intent via Anthropic, then returns CapCut "
            "template strategies and YouTube shortlists (ranked via YouTube Data API when "
            "YOUTUBE_API_KEY is set; otherwise precision query cards). Added Profile Connected "
            "Accounts (Google + CapCut), CapCut connect/disconnect flow (honest non-OAuth "
            "preference storage because CapCut has no public third-party OAuth), sync of "
            "connected_accounts, and privacy copy updates. Prompt schema now requires precise "
            "ytSearch/capcutSearch fields."
        ),
        "files": [
            "js/creative-research.js",
            "api/research.js",
            "app.html",
            "privacy.html",
            "terms.html",
            ".env.example",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "CapCut button opened generic template center; YouTube used 2–4 word generic searches "
            "with no ranking, producing irrelevant/low-quality references."
        ),
        "risk_level": "Medium",
        "risk_description": (
            "New API surface and optional YouTube Data API usage; CapCut 'connection' must not "
            "be misrepresented as full OAuth. Mitigated with auth, rate limits, sanitized "
            "context, and clear privacy wording."
        ),
        "fix_applied": (
            "Modular platform adapters + authenticated /api/research + in-app curated cards + "
            "CapCut gate + Connected Accounts UI + optional YOUTUBE_API_KEY."
        ),
        "testing": (
            "node --check on creative-research.js and research.js; app.html wiring checks for "
            "research shell, modal, sync fields. Live QA with YOUTUBE_API_KEY recommended across "
            "coffee/auto/gym/real-estate/restaurant/travel/photo/tech/fashion/education niches."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0006",
        "version": "v2.3.1",
        "date": "2026-07-30",
        "categories": ["UI/UX", "UI Design", "Feature", "Performance"],
        "title": "Premium landing motion system and 100+ Hook Engine showcase",
        "what_changed": (
            "Rebuilt post-hero landing scroll motion into one cohesive language (blur→sharp "
            "headings, staggered cards/images, early ScrollTrigger starts, GPU transform/"
            "opacity/filter only). Added a polished #hooks showcase with mechanical "
            "odometer counter animating 0→100+, then title/supporting copy/chips. Introduced "
            "shared radius tokens (--r-*), section rhythm (--section-y, --stack-gap), and "
            "safe-area page padding (--page-x). Softened button hover/active feedback. "
            "Featured Hook Engine in nav, features grid, and footer. Cinematic hero left intact."
        ),
        "files": [
            "index.html",
            "js/landing-scroll.js",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Landing motion was uneven (some sections unanimated; repetitive fades), Hook Engine "
            "capability was not visibly marketed, and radius/spacing/safe-area were inconsistent."
        ),
        "risk_level": "Low",
        "risk_description": (
            "UX/performance risk if scroll animations caused jank or delayed content readability; "
            "mitigated with GPU-only props, early triggers, and prefers-reduced-motion fallback."
        ),
        "fix_applied": (
            "Unified motion system in landing-scroll.js; odometer reel animation for 100+; CSS "
            "design tokens for radius/spacing/safe area; reduced-motion path snaps to final state."
        ),
        "testing": (
            "node --check on landing-scroll.js; local static serve of index.html; visual review of "
            "hooks odometer and section entrances. Manual scroll QA recommended on desktop + mobile."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0005",
        "version": "v2.3.0",
        "date": "2026-07-29",
        "categories": ["AI System", "Feature", "UI/UX", "API"],
        "title": "Intelligent Hook Generation Engine across scans and Director",
        "what_changed": (
            "Added a reusable PreShootHooks engine (js/hook-engine.js) with 100+ curiosity "
            "frameworks used as variable templates (not hardcoded finished lines). Scan prompts "
            "now require Primary Hook + 3 alternatives + hookWhy + framework id, with session "
            "rotation so six ideas prefer different openings. Idea sheet lets users swap hooks. "
            "Director receives selected hook + alternatives and must structure scripts around "
            "the opening promise. Server Director system prompt includes Hook Engine rules."
        ),
        "files": [
            "js/hook-engine.js",
            "app.html",
            "api/director.js",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
        ],
        "issue_found": (
            "Generated hooks were serviceable but generic and similar to commodity AI tools, "
            "reducing stop-scroll performance and brand differentiation."
        ),
        "risk_level": "Medium",
        "risk_description": (
            "Product quality / conversion risk: weak openings reduce retention and perceived "
            "value of scans and Director outputs."
        ),
        "fix_applied": (
            "Centralized framework library + prompt contracts + client normalization/rotation + "
            "UI swap + Director context/system-prompt integration. Quality filter encoded in "
            "prompt instructions (specificity, deliverability, human tone)."
        ),
        "testing": (
            "node --check on hook-engine.js and director.js; buildPrompt runtime check for "
            "altHooks + hook block. Full multi-niche live AI QA recommended on coffee shop, "
            "real estate, gym, automotive, travel, photography, education, startup, fashion, "
            "restaurant, local services."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0004",
        "version": "v2.2.4",
        "date": "2026-07-29",
        "categories": [
            "UI/UX",
            "UI Design",
            "Feature",
            "Bug Fix",
            "Privacy",
            "Documentation",
        ],
        "title": "Landing page conversion, trust, and clarity improvements",
        "what_changed": (
            "Improved landing first impression by showing brand + value before the cinematic "
            "headline animation (faster intro, no empty loading feel). Added a before/after "
            "product proof section (scan input → title/hook/shotlist output). Added trust "
            "section with product walkthrough and founder story. Fixed format count copy to "
            "match the app (8 formats including Custom). Clarified Free vs Pro pricing so "
            "Director AI is Pro-only and free users get limited scans + core ideas + sync when "
            "signed in. Added accurate privacy reassurance near the scan workflow. Softened "
            "unsupported demo statistics and clarified the Director demo is scripted."
        ),
        "files": [
            "index.html",
            "js/cinematic-hero.js",
            "docs/generate_update_security_log.py",
            "PreShoot_Update_Security_Log.pdf",
        ],
        "issue_found": (
            "Tester feedback: hero felt like a loading delay; insufficient output proof; "
            "format number vs listed formats mismatch; pricing/Director messaging ambiguity; "
            "missing privacy reassurance for image uploads; weak external trust signals."
        ),
        "risk_level": "Medium",
        "risk_description": (
            "Trust and conversion risk: contradictions and empty first frames reduce "
            "credibility for creators, businesses, and reviewers. Privacy overclaims would "
            "create compliance risk — claims were limited to verified behaviour."
        ),
        "fix_applied": (
            "Preserved cinematic animation while adding first-frame value and shortening "
            "intro timing. Added proof/trust sections in existing premium visual language. "
            "Aligned numbers and pricing with app.html product reality. Privacy copy references "
            "AI provider processing and user deletion capability per privacy policy."
        ),
        "testing": (
            "Source verification of formats (8 incl. Other/Custom), Director Pro gate, and "
            "privacy statements against privacy.html. Responsive CSS breakpoints added for "
            "proof/trust grids. Manual browser QA recommended on mobile Safari and desktop Chrome."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0001",
        "version": "v2.2.3",
        "date": "2026-07-28",
        "categories": ["Documentation", "Infrastructure"],
        "title": "Established permanent Update & Security Log system",
        "what_changed": (
            "Created the official PreShoot engineering documentation baseline at v2.2.3. "
            "Added PreShoot_Update_Security_Log.pdf as the permanent source of truth for all "
            "product, UI, backend, and security changes. Added CHANGE_LOG_RULES.md defining "
            "mandatory logging before any change is considered complete. Added a PDF generator "
            "script so future entries can be appended and the log regenerated consistently."
        ),
        "files": [
            "PreShoot_Update_Security_Log.pdf",
            "CHANGE_LOG_RULES.md",
            "docs/generate_update_security_log.py",
            ".gitignore",
        ],
        "issue_found": (
            "Project lacked a permanent, structured change and security history. Prior product "
            "iterations were not consistently versioned in git (only two commits present at log "
            "creation). Discovered during engineering process review."
        ),
        "risk_level": "Informational",
        "risk_description": (
            "Without structured logging, regressions, security fixes, and design decisions are "
            "hard to audit. Impact is operational and compliance-oriented rather than an "
            "immediate runtime vulnerability."
        ),
        "fix_applied": (
            "Introduced semantic versioning baseline v2.2.3, sequential UPDATE IDs, mandatory "
            "entry fields, dedicated Security History and UI/Design History sections, and "
            "release timeline. Documented regeneration workflow in CHANGE_LOG_RULES.md."
        ),
        "testing": (
            "Generated PDF successfully; verified cover page, update entries, security section, "
            "UI/design section, and release history render. Confirmed no application runtime "
            "code was modified for this documentation-only task."
        ),
        "git": None,
    },
    {
        "id": "UPDATE-0002",
        "version": "v2.2.3",
        "date": "2026-07-27",
        "categories": [
            "UI/UX",
            "UI Design",
            "Feature",
            "Bug Fix",
            "AI System",
            "API",
        ],
        "title": "Director, library, theme, and onboarding UI polish",
        "what_changed": (
            "Verified from git commit cbe925b. Restored application interactivity after a "
            "JavaScript syntax break that prevented onboarding/init from running. Connected "
            "generated ideas to Director AI for shotlist creation (including dedicated "
            "Director API endpoint with server-side system prompt). Improved library/scan "
            "image persistence. Added accent colour picking (colour wheel / creative palette). "
            "Added supporting client modules: orb visual, icon system expansions, kinetic grid, "
            "and onboarding scripts. Added package.json dependency declaration including ogl."
        ),
        "files": [
            "api/director.js",
            "app.html",
            "js/color-picker.js",
            "js/icons.js",
            "js/kinetic-grid.js",
            "js/onboard.js",
            "js/orb.js",
            "package.json",
        ],
        "issue_found": (
            "Users experienced broken interactivity (onboarding stuck) due to a JS syntax error; "
            "Director/library/theme workflows needed polish. Confirmed via commit message and "
            "file set in repository history."
        ),
        "risk_level": "High",
        "risk_description": (
            "Us-impact risk: a syntax error could prevent the app script from initializing, "
            "blocking core flows (scan, navigation, onboarding). Feature gaps limited Director "
            "handoff and library image retention."
        ),
        "fix_applied": (
            "Fixed the syntax break restoring init/onboarding; shipped Director API + idea "
            "handoff; persisted scan images in library flows; added accent colour customization "
            "and related UI modules."
        ),
        "testing": (
            "Documented as completed in commit scope (Director, library, theme, onboarding). "
            "Detailed device-by-device test matrix was not recorded in git — treat extended "
            "device results as not separately archived."
        ),
        "git": "cbe925b",
    },
    {
        "id": "UPDATE-0003",
        "version": "v2.2.3",
        "date": "2026-07-28",
        "categories": [
            "Security",
            "Privacy",
            "Authentication",
            "API",
            "Backend",
            "Database",
            "Infrastructure",
            "Bug Fix",
        ],
        "title": "Harden APIs with JWT auth, quotas, RLS, and XSS fixes",
        "what_changed": (
            "Verified from git commit 93c831e. Closed unauthenticated Anthropic proxy and IDOR "
            "surfaces on sync/promo/check-plan/track-user/billing-portal by requiring verified "
            "Supabase JWT and binding actions to the authenticated user. Added shared "
            "lib/security.js (CORS allowlist, plan checks, daily usage quotas, rate limiting, "
            "input sanitization). Constrained chat/director request bodies. Enabled deny-by-default "
            "RLS and documented users/user_data/usage_daily in supabase_setup.sql. Added security "
            "headers via vercel.json, .gitignore, .env.example. Hardened admin-data (timing-safe "
            "admin key compare, search sanitization) and admin.html escaping. Client app.html "
            "sends Authorization bearer tokens, requires sign-in for scans/promo/upgrade, stops "
            "granting Pro from ?upgraded=true when logged out, binds Stripe Payment Links with "
            "client_reference_id, and applies XSS-safe rendering for AI/idea content."
        ),
        "files": [
            ".env.example",
            ".gitignore",
            "admin.html",
            "api/admin-data.js",
            "api/billing-portal.js",
            "api/chat.js",
            "api/check-plan.js",
            "api/director.js",
            "api/promo.js",
            "api/sync.js",
            "api/track-user.js",
            "api/webhook.js",
            "app.html",
            "lib/security.js",
            "supabase_setup.sql",
            "vercel.json",
        ],
        "issue_found": (
            "Security audit of the codebase identified Critical issues: open /api/chat and "
            "/api/director Anthropic proxies; /api/sync and related routes trusting client "
            "user_id (IDOR); promo grant without auth; RLS disabled on billing tables while "
            "anon client key present; client-only plan/quota trust including ?upgraded=true. "
            "Also XSS via unescaped innerHTML for AI/user content; CORS *; missing security headers."
        ),
        "risk_level": "Critical",
        "risk_description": (
            "Unauthenticated callers could consume Anthropic quota / exfiltrate capability via "
            "open proxies; attackers could read/write another user's synced data or grant Pro "
            "via promo/sync/track-user IDOR patterns; billing tables without RLS risk data "
            "exposure if anon policies were misconfigured; XSS could execute in victims' "
            "browsers via crafted AI or profile content."
        ),
        "fix_applied": (
            "JWT-gated APIs; server-side plan/quota enforcement; RLS + schema SQL; CORS "
            "allowlist; XSS escaping; auth-required client flows; Stripe client_reference_id "
            "binding; webhook refuses unbound checkout when possible; admin key timing-safe compare."
        ),
        "testing": (
            "API modules syntax-checked with node --check. Client auth helpers and apiFetch "
            "wiring verified in source. Full production penetration retest and Supabase SQL "
            "apply must be confirmed in the deployed environment after running supabase_setup.sql "
            "and setting SUPABASE_ANON_KEY on Vercel."
        ),
        "git": "93c831e",
    },
]

SECURITY_HISTORY = [
    {
        "date": "2026-08-07",
        "title": "Reliability security cleanup (UPDATE-0016)",
        "detail": (
            "Phase 6 hardening: Stripe webhook size limits + idempotent event claims; atomic "
            "usage_daily increments; sync payload hard limits; pinned stripe dependency + lockfile."
        ),
    },
    {
        "date": "2026-08-07",
        "title": "CSP / header hardening (UPDATE-0015)",
        "detail": (
            "Phase 5 hardening: removed unsafe-eval and unused CDNs; narrowed connect-src and "
            "img-src; added object/frame denial, HSTS, and COOP. Inline script/style still required."
        ),
    },
    {
        "date": "2026-08-07",
        "title": "Admin session cookies (UPDATE-0014)",
        "detail": (
            "Phase 4 hardening: removed sessionStorage admin secret; HttpOnly cookie sessions with "
            "hashed admin_sessions rows; legacy x-admin-key rejected."
        ),
    },
    {
        "date": "2026-08-07",
        "title": "Distributed rate limiting (UPDATE-0013)",
        "detail": (
            "Phase 3 hardening: shared Supabase rate_limits + check_rate_limit RPC across serverless "
            "instances; user-keyed limits when authenticated, IP-keyed otherwise."
        ),
    },
    {
        "date": "2026-08-07",
        "title": "Promo redemption controls (UPDATE-0012)",
        "detail": (
            "Phase 2 hardening: promo_codes with max/expiry/active; unique per-user redemptions; "
            "atomic redeem_promo_code RPC; /api/promo no longer grants unlimited Pro from env list alone."
        ),
    },
    {
        "date": "2026-08-07",
        "title": "Research cost protection (UPDATE-0011)",
        "detail": (
            "Phase 1 hardening: /api/research now requires Pro from server subscription state and "
            "enforces daily research_calls usage before Anthropic/YouTube adapters run. Client "
            "plan/localStorage values are ignored."
        ),
    },
    {
        "date": "2026-07-30",
        "title": "Studio multi-device sync integrity (UPDATE-0010)",
        "detail": (
            "Fixed cloud Studio wipe risk on secondary devices (empty local updatedAt race). "
            "Added merge-by-id conflict handling and offline dirty queue before push."
        ),
    },
    {
        "date": "2026-07-30",
        "title": "Creative research privacy boundaries (UPDATE-0007)",
        "detail": (
            "Documented CapCut connection as preference/display-name storage (no CapCut OAuth API), "
            "optional YouTube Data API metadata for ranking only, and that photos are not uploaded "
            "to YouTube/CapCut. Research API requires JWT + rate limits + sanitized context."
        ),
    },
    {
        "date": "2026-07-29",
        "title": "Landing privacy reassurance (UPDATE-0004)",
        "detail": (
            "Added user-facing privacy strip on the landing page limited to verified behaviour: "
            "images used for idea generation via AI provider, deletable from library, with link "
            "to privacy policy. No new unsupported retention claims."
        ),
    },
    {
        "date": "2026-07-28",
        "title": "Full security remediation (UPDATE-0003 / commit 93c831e)",
        "detail": (
            "Addressed Critical/High findings: JWT on AI and data APIs; IDOR closure; RLS "
            "baseline SQL; XSS hardening; security headers; stop client entitlement trust for "
            "upgrade URL param; Stripe reference binding."
        ),
    },
    {
        "date": "2026-07-28",
        "title": "Security documentation baseline (UPDATE-0001)",
        "detail": (
            "Created permanent Update & Security Log and mandatory CHANGE_LOG_RULES.md so "
            "future vulnerabilities and fixes are tracked with UPDATE IDs."
        ),
    },
]

UI_DESIGN_HISTORY = [
    {
        "date": "2026-08-08",
        "title": "Studio mobile layout stability (UPDATE-0017)",
        "detail": (
            "Removed double bottom padding in Studio shell; kept Director command bar in-flow "
            "(no keyboard-driven chrome moves); 16px inputs to prevent iOS zoom; keyboard scroll "
            "accounts for bottom nav while preserving frozen --app-height overlay model."
        ),
    },
    {
        "date": "2026-07-30",
        "title": "Production Workspace shell (UPDATE-0010)",
        "detail": (
            "Production dashboard with stage rail, linked idea/scan, and Overview / Shot List / "
            "Script / References / Assets sections (placeholders where noted)."
        ),
    },
    {
        "date": "2026-07-30",
        "title": "Studio workspace polish (UPDATE-0009)",
        "detail": (
            "Files-like Studio home with progress bars and muted status pills; project dashboard; "
            "production cards with updated dates; stepped project wizard; premium Continue Working "
            "card; responsive 1/2/3-column grids."
        ),
    },
    {
        "date": "2026-07-30",
        "title": "Studio nav + production workspace shell (UPDATE-0008)",
        "detail": (
            "Bottom nav center Scan replaced with Studio tab; Studio dashboard project cards with "
            "status chips/progress; Continue Working card on Home; Send to Studio confirm sheet. "
            "Home scan ring and Director card preserved."
        ),
    },
    {
        "date": "2026-07-30",
        "title": "Creative Research cards + Connected Accounts (UPDATE-0007)",
        "detail": (
            "Idea sheet research panel with curated YouTube/CapCut cards; Profile Connected "
            "Accounts section (Google + CapCut) and CapCut connect bottom sheet."
        ),
    },
    {
        "date": "2026-07-30",
        "title": "Premium landing motion + Hook showcase (UPDATE-0006)",
        "detail": (
            "Unified post-hero scroll choreography (word/blur reveals, staggered cards, cinematic "
            "image entrances), mechanical 100+ odometer showcase, shared radius/spacing/safe-area "
            "tokens, and refined button micro-interactions. Hero cinematic system unchanged."
        ),
    },
    {
        "date": "2026-07-29",
        "title": "Landing conversion & proof sections (UPDATE-0004)",
        "detail": (
            "Added before/after product proof, trust walkthrough, founder credibility block, "
            "and hero first-frame brand/value lockup while preserving the cinematic GSAP hero."
        ),
    },
    {
        "date": "2026-07-27",
        "title": "Director / theme / onboarding UI polish (UPDATE-0002 / commit cbe925b)",
        "detail": (
            "Verified UI-related delivery in commit cbe925b: Director integration UX, accent "
            "colour picking, orb/icon/onboarding/kinetic-grid client modules, library image "
            "persistence behaviour. Earlier colourful vs monochrome redesign details are not "
            "separately recorded in git — Historical change — details unavailable for pre-commit visuals."
        ),
    },
]

RELEASES = [
    {
        "version": "v2.7.7",
        "date": "2026-08-08",
        "label": "Studio reliability & Director AI stabilization",
        "changes": [
            "Pull-merge-first sync + logout cache clear; Director execute/verify (UPDATE-0017)",
            "Mobile voice hard-fail + Studio keyboard/padding stability",
        ],
    },
    {
        "version": "v2.7.6",
        "date": "2026-08-07",
        "label": "Security Phase 6 — Reliability cleanup",
        "changes": [
            "Webhook idempotency + body limits; atomic quotas; sync payload caps (UPDATE-0016)",
            "Pinned stripe@17.7.0 and removed unused floating dependencies",
        ],
    },
    {
        "version": "v2.7.5",
        "date": "2026-08-07",
        "label": "Security Phase 5 — CSP / browser headers",
        "changes": [
            "Removed unsafe-eval; tightened connect-src and img-src (UPDATE-0015)",
            "Added HSTS, COOP, object-src/frame-src none",
        ],
    },
    {
        "version": "v2.7.4",
        "date": "2026-08-07",
        "label": "Security Phase 4 — Admin session hardening",
        "changes": [
            "HttpOnly admin session cookies + admin_sessions table (UPDATE-0014)",
            "Removed browser-stored ADMIN_SECRET / x-admin-key auth path",
        ],
    },
    {
        "version": "v2.7.3",
        "date": "2026-08-07",
        "label": "Security Phase 3 — Distributed rate limiting",
        "changes": [
            "Supabase-backed rate_limits across Vercel instances (UPDATE-0013)",
            "User-based + IP-based gating with Retry-After 429 responses",
        ],
    },
    {
        "version": "v2.7.2",
        "date": "2026-08-07",
        "label": "Security Phase 2 — Promo redemption hardening",
        "changes": [
            "promo_codes limits/expiry + per-user redemption tracking (UPDATE-0012)",
            "Atomic redeem_promo_code RPC before Pro grant",
        ],
    },
    {
        "version": "v2.7.1",
        "date": "2026-08-07",
        "label": "Security Phase 1 — Research cost protection",
        "changes": [
            "Server-side Pro + daily research_calls limits on /api/research (UPDATE-0011)",
            "Client plan/localStorage cannot bypass research entitlement",
        ],
    },
    {
        "version": "v2.7.0",
        "date": "2026-07-30",
        "label": "Studio sync + Production Workspace (Phase 3)",
        "changes": [
            "Reliable multi-device Studio sync (UPDATE-0010)",
            "Offline dirty queue + realtime/focus refresh",
            "Production Workspace sections + stage progress",
        ],
    },
    {
        "version": "v2.6.0",
        "date": "2026-07-30",
        "label": "Studio UI polish (Phase 2)",
        "changes": [
            "Polished Studio project/production cards (UPDATE-0009)",
            "Stepped New Project flow + premium Continue Working",
            "Responsive Studio grids + Director placeholders",
        ],
    },
    {
        "version": "v2.5.0",
        "date": "2026-07-30",
        "label": "Studio foundation (Phase 1)",
        "changes": [
            "Projects & Productions architecture (UPDATE-0008)",
            "Nav: Home / Library / Studio / Menu / Profile",
            "Send to Studio + Continue Working (confirm-only)",
        ],
    },
    {
        "version": "v2.4.0",
        "date": "2026-07-30",
        "label": "Creative Research System",
        "changes": [
            "CapCut + YouTube research redesign (UPDATE-0007)",
            "Connected Accounts (Google + CapCut)",
            "Optional YouTube Data API ranked shortlists",
        ],
    },
    {
        "version": "v2.3.1",
        "date": "2026-07-30",
        "label": "Landing motion & Hook Engine showcase",
        "changes": [
            "Premium post-hero scroll motion system (UPDATE-0006)",
            "100+ proven hooks odometer showcase + marketing surfaces",
            "Rounded design tokens, spacing rhythm, safe-area padding",
        ],
    },
    {
        "version": "v2.3.0",
        "date": "2026-07-29",
        "label": "Hook Engine major capability",
        "changes": [
            "Intelligent Hook Generation Engine (UPDATE-0005)",
            "Primary + 3 alt hooks, rotation, Director lock-in",
        ],
    },
    {
        "version": "v2.2.4",
        "date": "2026-07-29",
        "label": "Landing trust & conversion patch",
        "changes": [
            "Hero first-frame clarity (UPDATE-0004)",
            "Before/after product proof + trust/founder sections",
            "Pricing/format/privacy copy accuracy fixes",
        ],
    },
    {
        "version": "v2.2.3",
        "date": "2026-07-28",
        "label": "Official documentation baseline / current release",
        "changes": [
            "Established permanent Update & Security Log system (UPDATE-0001)",
            "Includes verified UI/Director/library/theme/onboarding work from 2026-07-27 (UPDATE-0002)",
            "Includes verified API JWT/RLS/XSS security hardening from 2026-07-28 (UPDATE-0003)",
            "Began structured semantic version management at v2.2.3",
        ],
    },
]

HISTORICAL_NOTE = (
    "Pre-baseline product history (concept through multiple redesigns prior to tracked git "
    "commits cbe925b and 93c831e): Historical change — details unavailable. "
    "Only two git commits existed in this repository when the log was created. "
    "Do not invent earlier UPDATE entries."
)


def build_styles():
    base = getSampleStyleSheet()
    styles = {
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=28,
            leading=34,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#111111"),
            spaceAfter=8,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=14,
            leading=20,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#333333"),
            spaceAfter=6,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=colors.HexColor("#111111"),
            spaceBefore=4,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=16,
            textColor=colors.HexColor("#111111"),
            spaceBefore=8,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            alignment=TA_JUSTIFY,
            textColor=colors.HexColor("#222222"),
            spaceAfter=4,
        ),
        "label": ParagraphStyle(
            "label",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#111111"),
            spaceBefore=4,
            spaceAfter=1,
        ),
        "meta": ParagraphStyle(
            "meta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#333333"),
            spaceAfter=2,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=colors.HexColor("#555555"),
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=colors.HexColor("#666666"),
            alignment=TA_CENTER,
        ),
    }
    return styles


def p(styles, key, text):
    return Paragraph(text.replace("\n", "<br/>"), styles[key])


def hr():
    return HRFlowable(
        width="100%", thickness=0.6, color=colors.HexColor("#CCCCCC"), spaceBefore=4, spaceAfter=8
    )


def add_header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#DDDDDD"))
    canvas.setLineWidth(0.4)
    canvas.line(18 * mm, A4[1] - 12 * mm, A4[0] - 18 * mm, A4[1] - 12 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawString(18 * mm, A4[1] - 10 * mm, f"{PROJECT} — {DOC_TITLE}")
    canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 10 * mm, CURRENT_VERSION)
    canvas.line(18 * mm, 12 * mm, A4[0] - 18 * mm, 12 * mm)
    canvas.drawCentredString(A4[0] / 2, 8 * mm, f"Page {doc.page}  ·  Confidential engineering record")
    canvas.restoreState()


def entry_block(styles, u):
    bits = []
    bits.append(p(styles, "h2", f"{u['id']} — {u['title']}"))
    meta = (
        f"<b>Version:</b> {u['version']} &nbsp;&nbsp; "
        f"<b>Date:</b> {u['date']} &nbsp;&nbsp; "
        f"<b>Risk:</b> {u['risk_level']}"
    )
    if u.get("git"):
        meta += f" &nbsp;&nbsp; <b>Git:</b> {u['git']}"
    bits.append(p(styles, "meta", meta))
    bits.append(p(styles, "meta", f"<b>Category:</b> {', '.join(u['categories'])}"))
    bits.append(hr())

    fields = [
        ("Change Title", u["title"]),
        ("What Changed", u["what_changed"]),
        ("Files Changed", "<br/>".join(f"• {f}" for f in u["files"])),
        ("Issue Found", u["issue_found"]),
        ("Risk Level", u["risk_level"]),
        ("Risk Description", u["risk_description"]),
        ("Fix Applied", u["fix_applied"]),
        ("Testing Performed", u["testing"]),
    ]
    for label, val in fields:
        bits.append(p(styles, "label", label))
        bits.append(p(styles, "body", val))
    bits.append(Spacer(1, 8))
    return KeepTogether(bits)


def build():
    styles = build_styles()
    doc = SimpleDocTemplate(
        OUT_PDF,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"{PROJECT} {DOC_TITLE}",
        author="PreShoot Engineering",
    )
    story = []

    # Cover
    story.append(Spacer(1, 40 * mm))
    story.append(p(styles, "cover_title", PROJECT))
    story.append(p(styles, "cover_sub", DOC_TITLE))
    story.append(Spacer(1, 8 * mm))
    story.append(hr())
    story.append(Spacer(1, 6 * mm))

    cover_rows = [
        ["Document type", "Permanent engineering update & security history"],
        ["Current version", CURRENT_VERSION],
        ["Last updated", LAST_UPDATED],
        ["Update IDs in scope", f"{UPDATES[0]['id']} → {UPDATES[-1]['id']}"],
        ["Classification", "Internal engineering record"],
        ["Rule", "Every codebase change must be logged before completion"],
    ]
    t = Table([[Paragraph(f"<b>{a}</b>", styles["meta"]), Paragraph(b, styles["meta"])] for a, b in cover_rows], colWidths=[45 * mm, 120 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F4F4F4")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 12 * mm))
    story.append(
        p(
            styles,
            "body",
            "This document is the permanent source of truth for PreShoot product development "
            "history: code, UI, features, bugs, security, privacy, performance, backend, "
            "database, API, configuration, and dependency changes.",
        )
    )
    story.append(
        p(
            styles,
            "small",
            "Integrity policy: historical entries are recorded only when verified (git commits "
            "or confirmed engineering review). Unverified prior work is marked "
            "“Historical change — details unavailable”.",
        )
    )
    story.append(PageBreak())

    # Contents-ish intro
    story.append(p(styles, "h1", "1. Document control"))
    story.append(
        p(
            styles,
            "body",
            f"Baseline version <b>{CURRENT_VERSION}</b> establishes official documentation after "
            "multiple major product iterations that were not consistently version-tracked. "
            "Future changes increment Major.Minor.Patch per CHANGE_LOG_RULES.md.",
        )
    )
    story.append(p(styles, "label", "Historical note (pre-baseline)"))
    story.append(p(styles, "body", HISTORICAL_NOTE))
    story.append(Spacer(1, 4 * mm))

    story.append(p(styles, "h1", "2. Update history"))
    story.append(
        p(
            styles,
            "body",
            "Entries are listed newest-first by Update ID sequence for reading convenience "
            "within the baseline release. Each entry uses the mandatory engineering template.",
        )
    )
    story.append(Spacer(1, 2 * mm))

    # Newest first for reading: reverse by id order visually — keep numeric order ascending as created
    for u in UPDATES:
        story.append(entry_block(styles, u))
        story.append(hr())

    story.append(PageBreak())
    story.append(p(styles, "h1", "3. Security history"))
    story.append(
        p(
            styles,
            "body",
            "Dedicated record of vulnerability discoveries, authentication/permission changes, "
            "privacy improvements, and data-protection work.",
        )
    )
    for s in SECURITY_HISTORY:
        story.append(p(styles, "label", f"{s['date']} — {s['title']}"))
        story.append(p(styles, "body", s["detail"]))

    story.append(Spacer(1, 6 * mm))
    story.append(p(styles, "h1", "4. UI / Design history"))
    story.append(
        p(
            styles,
            "body",
            "Visual evolution: colour systems, typography, layout, components, animation, icons, "
            "responsive behaviour — only when verified.",
        )
    )
    for s in UI_DESIGN_HISTORY:
        story.append(p(styles, "label", f"{s['date']} — {s['title']}"))
        story.append(p(styles, "body", s["detail"]))

    story.append(Spacer(1, 6 * mm))
    story.append(p(styles, "h1", "5. Release history"))
    for r in RELEASES:
        story.append(p(styles, "h2", f"{r['version']} — {r['label']}"))
        story.append(p(styles, "meta", f"<b>Date:</b> {r['date']}"))
        story.append(p(styles, "label", "Changes"))
        story.append(p(styles, "body", "<br/>".join(f"• {c}" for c in r["changes"])))

    story.append(Spacer(1, 8 * mm))
    story.append(p(styles, "h1", "6. Future releases (template)"))
    story.append(
        p(
            styles,
            "body",
            "<b>v2.4.1</b> (next patch — not released)<br/>"
            "• Reserved for bug fixes, small UI adjustments, security patches, performance.<br/><br/>"
            "<b>v2.5.0</b> (next minor — not released)<br/>"
            "• Reserved for significant features, major UI redesigns, or new AI capabilities.",
        )
    )

    story.append(Spacer(1, 8 * mm))
    story.append(p(styles, "h1", "7. Mandatory process reminder"))
    story.append(
        p(
            styles,
            "body",
            "Before completing any future code change: update this PDF with a new UPDATE ID; "
            "record date, version, category, what changed, files changed, issue found, risk "
            "level, fix applied, and testing performed. See CHANGE_LOG_RULES.md. "
            "A change is not complete until documented.",
        )
    )

    story.append(Spacer(1, 10 * mm))
    story.append(hr())
    story.append(
        p(
            styles,
            "small",
            f"Generated {date.today().isoformat()} · {PROJECT} Engineering · "
            f"Current version {CURRENT_VERSION} · Last updated {LAST_UPDATED}",
        )
    )

    doc.build(story, onFirstPage=add_header_footer, onLaterPages=add_header_footer)
    print(f"Wrote {OUT_PDF}")


if __name__ == "__main__":
    build()
