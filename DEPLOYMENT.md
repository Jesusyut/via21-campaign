# Via 21 lead pipeline

The site database is the source of truth. No Zapier. Production uses PostgreSQL via DATABASE_URL and refuses to use ephemeral SQLite. Local automated tests use Node's built-in SQLite to exercise storage, API, and job behavior. The JSON lead document stores all required fields, timestamped notes, stage history, handoff history and every UTM. Secrets are never stored in it.

## Hosting
The existing static landing page cannot execute a server. The new Node web service serves the unchanged landing page plus /admin and /api/leads. Its /settings.js points forms at its own API. The old static site's form remains disconnected until the web service is healthy; then set its webhook setting to the new web service's absolute /api/leads URL.

Build: npm install --omit=dev --ignore-scripts
Start: npm start
Node: 24
Health endpoint: /healthz

Required environment variables:
- DATABASE_URL: Render Postgres internal connection URL, same Oregon region/workspace.
- PUBLIC_ORIGIN: exact web service origin without trailing slash.
- ADMIN_PASSWORD: a random password of at least 16 characters; server refuses weaker setup.
- ADMIN_USERNAME: caesar (default).
- ALLOWED_FORM_ORIGINS: comma-separated old static origin/custom domains.
- FREE_TEST_MODE: true during the free preview.
- ALERT_EMAIL: Caesar's private backup recipient (configured only in Render).

Free web hosting sleeps and does not guarantee instant alerts, 10-minute reminders, or an 8 AM digest. Jobs persist and run when it wakes. Upgrade to an always-on service for reliable scheduling. Free Postgres expires; the created test instance expires December 3, 2026. Do not accept real campaign traffic before upgrading/backing up.

## Optional integrations, enabled via server environment only
Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Create the bot with BotFather, open the bot and send /start from Caesar's Telegram account. With the token configured, run node server/telegram-chat.mjs to list candidate private chat IDs; confirm Caesar's chat and set TELEGRAM_CHAT_ID. Never choose an unconfirmed group/recipient.
Email: RESEND_API_KEY, EMAIL_FROM (verified sender), ALERT_EMAIL. Email is sent independently as backup even if Telegram fails.
CAPI: META_CAPI_ACCESS_TOKEN, META_GRAPH_VERSION (v26.0), optional META_TEST_EVENT_CODE for test events only.
Office handoff: OFFICE_EMAIL. No handoff timestamp is recorded until a recipient is configured.
Privacy: PRIVACY_URL. Prior CAPI and privacy live-test requirements still apply.
Google Sheet backup (optional, off by default): SHEET_BACKUP_URL and SHEET_BACKUP_SECRET. The sample Apps Script is in backup/google-apps-script.gs. Use Script Properties for SHEET_ID and BACKUP_SECRET and deploy as a web app. The server posts a lead after storage; the script upserts by id. Backup failure never changes the saved lead or API success.

## Reliable delivery model
Each accepted lead and its CAPI/Telegram/email/Sheet/reminder jobs are committed in one transaction. An event_id unique key prevents duplicate leads or duplicate jobs on submit retries; mismatched reused IDs are rejected. Workers lease jobs in the database, retry failures, and recover expired leases on restart. CAPI event_id matches the lead UUID and browser eventID. No answers enter Meta custom_data. Direct alert jobs run concurrently so a slow Meta call cannot block Telegram.

Notifications/reminders go only to configured Caesar destinations. There is no automated SMS to leads. Call/Text links merely open Caesar's phone client. The digest uses America/Phoenix at 8 AM local (15:00 UTC year-round), with one per-day job per channel. Tour scheduling includes a Phoenix date/time field.

External delivery is at least once on ambiguous network failures; Telegram has no idempotency key, so a lost acknowledgement can exceptionally duplicate a ping. Resend and CAPI use stable idempotency/event IDs. A successful reminder job is never sent again. Free-host sleep can delay jobs; it does not drop records.

## Admin and privacy
/admin and /admin/leads/:id serve the login shell; all lead APIs and CSV export require an opaque HttpOnly session cookie. Device sessions persist across browser restarts for 30 days and renew at most once daily during use; sign out revokes them immediately. Temporary connection failures retry without discarding the saved login; cookies are Secure in production and SameSite=Strict. Mutations require a CSRF token. Login and public submissions are rate-limited in the database. The public form has a hidden honeypot. Admin responses use no-store, noindex, nofollow and an isolated CSP; tokens/DB credentials never reach frontend settings. User-rendered fields are escaped. CSV values are formula-neutralized. /robots.txt disallows admin and APIs.

Mark sent to office records the draft-open timestamp once and an audit entry per action, then opens Caesar's mail client with the referral text. Actual email sending/delivery is outside the site's control; the panel states this. Notes and stage logs are timestamped. first_contacted_at is set once when leaving New, including Lost as specified.

## Validation and outstanding checks
Run node --test tests/*.test.mjs. Tests cover atomic storage, retries, rollback, timestamps, Lost validation, reminders, failures, digest timezone, stats, CSV safety, authentication, CSRF, handoff, pixel uniqueness, success-only browser events, and CAPI normalization.

A real board screenshot and Telegram screenshot must come from the running app/bot. Browser automation is currently disabled in Work settings. Telegram, email delivery, CAPI acceptance and optional Sheet rows need configured credentials and live verification. Tests use reserved example.com contacts and fake providers and do not contact leads.
