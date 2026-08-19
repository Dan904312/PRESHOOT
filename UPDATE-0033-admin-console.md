# UPDATE-0033 — Admin Console 2.0

- **Version:** v2.19.0
- **Date:** 2026-08-18
- **Type:** Minor — professional operations console, authoritative usage/cost tracking, account suspension, targeted messaging

## Summary
Replace the decorative admin dashboard with an operations console. Scans and Director requests are recorded only after a successful server-side AI response. Suspended accounts are rejected by `requireUser` and banned in Supabase Auth. Messaging is honest when no email provider is configured.

## Operator
1. Run `supabase_admin_console.sql` in the Supabase SQL editor.
2. Redeploy.
3. Optional: set `RESEND_API_KEY` and `EMAIL_FROM` for Messaging delivery.
4. Optional spend flags: `ADMIN_DAILY_SPEND_WARN`, `ADMIN_MONTHLY_SPEND_WARN`, `ADMIN_USER_SPEND_WARN`.

Historical scans that occurred before the SQL is applied were never stored. The console states the tracking start date instead of showing fake zeros as history.

## Security
- Admin APIs still require the HttpOnly admin session. `x-admin-key` is rejected.
- `requireActiveUser()` runs inside `requireUser()` on authenticated app APIs.
- Suspend re-checks `ADMIN_SECRET`, sets `users.account_status`, bans the Auth user, and globally logs out sessions.
- Restore unbans and sets `active`. It does not grant Pro.
- Subscription restore no longer writes `plan: pro`.
- Service-role key remains server-only.

## Explicitly NOT implemented
- Extra Vercel serverless files (Hobby still 12)
- Fabricated historical usage
- Fake email send without a provider
- SIEM / marketing automation
- Auto-ban on high usage
- Image/video generation events (those products do not exist)

## Legal
Privacy Policy and Terms updated 2026-08-18 for operational telemetry, audit logs, optional transactional email, and 24-month retention intent. **Requires legal review** for an Australian business. No compliance certifications are claimed.
