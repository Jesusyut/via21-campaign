# Via 21 campaign

## Render test deployment

Deploy this repository as a Render Static Site. Build command: `node --check dist/app.js`. Publish directory: `dist`. The root `render.yaml` provides the equivalent Blueprint configuration. No dependency installation or server is needed.

Testing intentionally leaves the webhook and privacy URL unset. The quiz and validation work; submission displays an integration-pending message and does not send or store personal information. A real confirmation appears only after successful webhook delivery. Use dummy contact information when testing.

Test the primary page and `?ad=renewal`, each question, back navigation, required fields, malformed US phone numbers, privacy placeholder, and the pending-delivery message. Connect the missing settings before accepting live campaign traffic.

Buildless static page. Edit `dist/settings.js` for price, offer, furnished/pets question, calendar URL, privacy URL and lead webhook.

Lead submission deliberately fails visibly until a webhook is configured. The endpoint must accept JSON with timestamp, name, E.164 phone, email, answers, ad_source, UTMs and event_id; return a successful HTTP status only after accepting the lead. Configure CORS for this site's origin. The endpoint should write to the Google Sheet and send the leasing alert, with rate limiting and server validation. Conversions API belongs there; use event_id to deduplicate browser/server Lead events. No secrets belong in settings.js.

Supported ad parameters: offer, free (also 1-month-free), renewal, holiday, location, checklist. Unknown values retain the primary headline and are preserved in lead attribution.

Before campaign launch: confirm furnished inventory, price and concession with leasing; supply the approved privacy policy, webhook. The current campaign headline and Apply Online CTA are preserved.

## Meta tracking — installed browser code, pending server integration

Pixel ID: 2550232255445742. The exact supplied base snippet lives once in `dist/index.html`, high in head after charset. The old settings-driven loader is removed. This page has no URL-based client routing; quiz transitions do not generate additional PageViews.

`dist/lead-tracking.js` sends Lead only after a 2xx webhook response (and rejects explicit JSON errors). A shared busy/completed guard prevents repeated submissions even if the contact step is re-rendered. A lost-response retry with the same answers/contact reuses event_id. Browser Meta calls include only the requested content metadata and ad_source, never answers or contact data. No manual Advanced Matching is configured; keep Automatic Advanced Matching and automatic form-event detection disabled in Events Manager as well.

The webhook receives event_id and lead_id (identical), event_time, ad_source, ALL utm_* parameters (both flat fields and an utm object), the page URL, and fbp/fbc if available. Existing _fbc is preferred; otherwise fbclid is converted to fb.1.<page-load timestamp_ms>.<fbclid>. Store this metadata alongside the lead. Allow the Idempotency-Key header in webhook CORS.

Server code is prepared in `server/meta-capi.mjs` and `server/tour-inquiry.mjs`. It is NOT a deployed server route: this Render service is a Static Site and cannot execute server code. Connect the adapter to your actual lead backend/automation and set dist/settings.js's webhook URL. The adapter requires a durable transaction that stores the lead plus an outbox job with a unique event_id. Send the CAPI job only after saving. Retries must use the original event_id/time and must not insert another Sheet row. Do not return success on receipt alone, and do not fail a successfully saved lead merely because Meta is temporarily unavailable.

Set META_CAPI_ACCESS_TOKEN only in that backend's secret settings. Default Graph version is v26.0 (Meta's official SDK changelog uses v26.0); override with META_GRAPH_VERSION when updating. The main Meta reference returned HTTP 429 during this install, so verify the version in Events Manager before activating. The token uses a server-only Authorization header, never a frontend/query-string credential. The helper normalizes/hashes email, US phone with country code, and first/last name with SHA-256. It leaves trusted request IP/user agent/fbp/fbc unhashed. Extract visitor IP using the hosting provider's trusted proxy configuration, not an arbitrary client-supplied field. No questionnaire answers or UTM values enter custom_data.

The token, connected lead destination, approved privacy-policy URL, and a domain owned by the LI business are still outstanding. The current test host is via21-campaign-test.onrender.com; use an owned custom domain for business verification.

### Required live validation (not yet completed)

1. Open dataset 2550232255445742 in Meta Events Manager → Test events. Open https://via21-campaign-test.onrender.com from there and confirm one PageView.
2. Set META_TEST_EVENT_CODE in backend secret/config settings for Server test events. Remove it after testing.
3. With the backend and token connected, use an authorized real email and phone to submit one lead. Confirm one stored row with event_id, all UTMs, ad_source and answers; verify Browser + Server Lead deduplication.
4. Retry/double-click and reload the confirmation: no additional browser Lead or stored row. Refresh of the page may legitimately send PageView.
5. Install the official Meta Pixel Helper extension from Chrome Web Store and confirm one pixel/no warnings.
6. Save a Test events screenshot showing PageView plus the deduplicated Browser/Server Lead, and record any diagnostics.

Browser control is disabled in Work settings in this session. No Events Manager screenshot, real-contact test, Pixel Helper result, or live CAPI acceptance has been claimed. Local tests use mock network calls and dummy contacts; they never send test leads to Meta.
