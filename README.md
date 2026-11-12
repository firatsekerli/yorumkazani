# yorumkazani.com · Kazana at, teyzeler yorumlasın

Upload a photo, five Turkish characters comment on it, share the result as a 1080x1920 story card.
A project of asparajans.

## How it works

- `public/` static site (HTML/CSS/JS, no build step). Resizes the photo to max 1024px in the browser and draws the story card in the browser.
- `functions/api/throw.js` Cloudflare Pages Function. Checks Turnstile, checks the daily free limit in D1, sends the photo to Claude (Haiku 5.5), returns the comments. The photo is never stored.
- `lib/prompt.js` characters, categories and the system prompt. Tune the humor here.
- `schema.sql` D1 table for the daily counter (IP stored only as a salted hash).

Refused photos (children in focus, nudity, ID cards, etc.) and AI errors do not use up a free throw.

## Deploy on Cloudflare (one time)

1. **D1 database**: Cloudflare dashboard > Storage & Databases > D1 > Create, name `yorumkazani`. Open its Console and run the contents of `schema.sql`.
2. **Turnstile**: Cloudflare dashboard > Turnstile > Add widget for `yorumkazani.com`, mode "Managed". Copy the **site key** into `public/index.html` (`<meta name="turnstile-sitekey">`) and keep the **secret key** for step 4.
3. **Pages project**: Workers & Pages > Create > Pages > Connect to Git > `firatsekerli/yorumkazani`. Framework preset: None. Build command: empty. Build output directory: `public`.
4. **Settings > Variables and Secrets** (Production), add:
   - `ANTHROPIC_API_KEY` (secret) from console.anthropic.com
   - `TURNSTILE_SECRET` (secret) from step 2
   - `IP_SALT` (secret) any long random string
   - `FREE_PER_DAY` = `3` (optional)
   - `CLAUDE_MODEL` = `claude-haiku-5-5` (optional)
5. **Settings > Bindings**: add D1 binding, variable name `DB`, database `yorumkazani`.
6. **Custom domains**: add `yorumkazani.com` (and `www`). The domain's nameservers must point to Cloudflare, or add the CNAME Cloudflare shows.
7. Redeploy once so the bindings and secrets apply.

## Local testing

```bash
npm install
cp .dev.vars.example .dev.vars   # add your Anthropic key
npm run db:local
npm run dev                      # http://localhost:8788
npm test                         # offline test of the API logic
```

The site key in `index.html` is Cloudflare's always-pass test key; it pairs with the test secret in `.dev.vars.example`. Replace it with the real key before going live.

## Cost

Haiku 5.5: $0.10 per million input tokens, $0.50 per million output tokens (prompts under 100k tokens).
One throw is about 2.5k input tokens (1024px photo plus prompt) and up to 900 output tokens, so roughly $0.0003 to $0.0007.

## Next steps

- Paid throw packs (iyzico or PayTR)
- Login (magic link) so credits follow the user
- More characters and seasonal ones (Ramazan, bayram, düğün sezonu)
- Business version: "Menünü, logonu, ilanını teyzelere sor"
