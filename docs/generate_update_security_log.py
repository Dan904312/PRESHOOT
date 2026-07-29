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

CURRENT_VERSION = "v2.3.0"
LAST_UPDATED = "2026-07-29"
PROJECT = "PreShoot"
DOC_TITLE = "Update & Security Log"

# ── Verified entries only (do not invent) ───────────────────────────────────
# Sources: git commits in this repository + this documentation setup task.
# Pre-git product history is recorded as unavailable.

UPDATES = [
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
            "<b>v2.2.4</b> (next patch — not released)<br/>"
            "• Reserved for bug fixes, small UI adjustments, security patches, performance.<br/><br/>"
            "<b>v2.3.0</b> (next minor — not released)<br/>"
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
