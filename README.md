# Via 21 campaign and lead pipeline

The Node service serves the landing page, database-backed form endpoint, and password-protected /admin pipeline. PostgreSQL is the source of truth. No Zapier or automated lead SMS.

See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting, credentials, jobs, optional Sheet backup, security, and live verification. Public landing copy and pixel setup are preserved; a nonvisible honeypot is added.

Start: npm start (Node 24, DATABASE_URL, PUBLIC_ORIGIN and ADMIN_PASSWORD required).
Tests: node --test tests/*.test.mjs (15 passing local tests; no real external notifications during tests).

The existing Render Static Site remains a frontend-only test deployment until the backend is connected. The new web service serves /admin and /api/leads on its own origin. Its runtime settings point the form at /api/leads. The free database expires December 3, 2026. Free service sleep can delay alerts and scheduled jobs; upgrade before real campaign traffic.

Server CAPI, Telegram, backup email and optional Sheet delivery use a transactional outbox. Missing tokens leave delivery jobs pending without losing the saved lead. No secrets or Caesar's private notification address are stored in this repository.
