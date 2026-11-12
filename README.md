# yorumkazani.com · Fotoğrafını at, millet yorumlasın

People upload a photo (outfit, home, food, a message screenshot, a funny shop sign), strangers comment, everyone votes, and the best comment "wins" (yorum kazanır). A project of asparajans.

## What's in it

- **Feed** (`/`): "Yeni" and "Kaynayanlar" (most recently active), each card shows the current winning comment.
- **Post page** (`/p/<id>`): photo, comments sorted by votes, 👑 winner badge, up/down votes, report buttons, share button that makes a 1080x1920 story card. Shared links show the photo as the preview on WhatsApp, X, etc.
- **Storage**: photos in Workers KV (`IMAGES`), data in D1 (`DB`). Both bindings are set in `wrangler.toml`.
- **Upload**: photo is resized and re-encoded in the browser (removes EXIF/GPS location), category, optional question, nickname.
- **No accounts**: an anonymous cookie id (stored only as a salted hash) is used for votes, limits and "my post".
- **Admin** (`/admin.html`): pending/hidden/reported photos and comments with Approve / Hide / Delete, plus basic stats.

## Safety built in

- Cloudflare Turnstile on uploads and comments (bot protection).
- Daily limits per visitor and per IP: 5 uploads, 80 comments, 500 votes, 30 reports.
- Word filter (`lib/server.js`, `EXACT` and `PREFIX` lists): blocks swearing, body-shaming words and links. Extend it as real abuse shows up.
- 3 reports from different people hide a photo or comment until you review it.
- Photo check before publishing, controlled by `MODERATION`:
  - `ai`: Claude Haiku checks each photo (children, nudity, IDs, plates, phone numbers...). Rejects with a polite message; on any error the photo waits for you. Needs `ANTHROPIC_API_KEY`.
  - `manual`: every photo waits for your approval on `/admin.html`.
  - `off`: photos go live immediately (not recommended).
  - Default when unset: `ai` if an API key exists, otherwise `manual`.

## Deploy on Cloudflare (one time)

1. **D1**: Storage & Databases > D1 > Create `yorumkazani`. Open Console, paste and run `schema.sql`.
2. **KV**: Workers KV > Create namespace `yorumkazani-images` (images are served through `/i/`). Put its id in `wrangler.toml`.
3. **Turnstile**: Turnstile > Add widget for `yorumkazani.com`, mode Managed. Put the **site key** in `public/index.html` and `public/post.html` (`<meta name="turnstile-sitekey">`, currently Cloudflare's test key). Keep the **secret key** for step 5.
4. **Pages**: Workers & Pages > Create > Pages > Connect to Git > `firatsekerli/yorumkazani`. Framework: None. Build command: empty. Output directory: `public`.
5. **Settings > Variables and Secrets** (Production):
   - `TURNSTILE_SECRET` (secret)
   - `IP_SALT` (secret, any long random string)
   - `ADMIN_TOKEN` (secret, at least 16 random characters, your /admin password)
   - `ANTHROPIC_API_KEY` (secret, optional, for the AI photo check)
   - `MODERATION` (optional, see above)
6. **Bindings** come from `wrangler.toml` (D1 `DB`, KV `IMAGES`), nothing to set in the dashboard.
7. **Custom domains**: add `yorumkazani.com` and `www.yorumkazani.com`.
8. Redeploy once so bindings and secrets apply.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev                                  # http://localhost:8788
PHOTO=some.jpg node test/e2e-api.mjs         # full API test against the dev server (use a fresh local DB)
```

## Costs

Cloudflare Pages, D1, KV and Turnstile all have free tiers (KV free: 1 GB, 1,000 writes/day) that should cover the start. With the AI photo check on, each upload is one small Claude Haiku call (one image, about 100 output tokens).

## Ideas for later

- Weekly "Haftanın Kazananı" hall of fame and share card
- Login (magic link) for profiles and reputation
- Push the daily best to Instagram/TikTok as story cards
- Ads (AdSense) on feed and post pages once traffic exists
