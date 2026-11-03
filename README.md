# Via 21 campaign

## Render test deployment

Deploy this repository as a Render Static Site. Build command: `node --check dist/app.js`. Publish directory: `dist`. The root `render.yaml` provides the equivalent Blueprint configuration. No dependency installation or server is needed.

Testing intentionally leaves the webhook, privacy URL and Meta Pixel unset. The quiz and validation work; submission displays an integration-pending message and does not send or store personal information. A real confirmation appears only after successful webhook delivery. Use dummy contact information when testing.

Test the primary page and `?ad=renewal`, each question, back navigation, required fields, malformed US phone numbers, privacy placeholder, and the pending-delivery message. Connect the missing settings before accepting live campaign traffic.

Buildless static page. Edit `dist/settings.js` for price, offer, furnished/pets question, calendar URL, privacy URL, optional Meta Pixel ID and lead webhook.

Lead submission deliberately fails visibly until a webhook is configured. The endpoint must accept JSON with timestamp, name, E.164 phone, email, answers, ad_source, UTMs and event_id; return a successful HTTP status only after accepting the lead. Configure CORS for this site's origin. The endpoint should write to the Google Sheet and send the leasing alert, with rate limiting and server validation. Conversions API belongs there; use event_id to deduplicate browser/server Lead events. No secrets belong in settings.js.

Supported ad parameters: free (also 1-month-free), renewal, holiday, location, checklist. Unknown values retain the primary headline and are preserved in lead attribution.

Before campaign launch: confirm furnished inventory, price and concession with leasing; supply the approved privacy policy, webhook, and optional Pixel ID. The exact primary headline from the brief is preserved, with intentional line breaks for legibility on phones.
