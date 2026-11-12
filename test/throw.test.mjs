// Offline test of /api/throw with a fake D1, fake Turnstile and fake Claude.
// Run: node test/throw.test.mjs
import assert from "node:assert/strict";
import { onRequestPost, parseResult } from "../functions/api/throw.js";

function fakeDB() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            async first() { const r = rows.get(a.join("|")); return r ? { count: r } : null; },
            async run() { const k = a.join("|"); rows.set(k, (rows.get(k) || 0) + 1); },
          };
        },
      };
    },
  };
}

let claudeReply = "";
let turnstileOK = true;
globalThis.fetch = async (url) => {
  if (String(url).includes("turnstile")) return new Response(JSON.stringify({ success: turnstileOK }));
  if (String(url).includes("anthropic")) {
    return new Response(JSON.stringify({ content: [{ type: "text", text: claudeReply }] }));
  }
  throw new Error("unexpected fetch " + url);
};

const good = JSON.stringify({
  uygun: true, neden: "", baslik: "Mor ceket olayı",
  yorumlar: [
    { id: "nermin", metin: "Kızım bu ceketle üşütürsün." },
    { id: "recep", metin: "Abi bak sana bir şey diyeyim, mor cesaret ister." },
    { id: "sukran", metin: "Çok güzel olmuş tabii, siz gençler bilirsiniz." },
    { id: "kaan", metin: "Bu look'u Q4'te align edelim." },
    { id: "sozluk", metin: "mor ceket. cesaretin renk hali. (bkz: neden)" },
  ],
});

const env = { DB: fakeDB(), TURNSTILE_SECRET: "x", ANTHROPIC_API_KEY: "k", IP_SALT: "s", FREE_PER_DAY: "2" };
const req = (body) =>
  new Request("https://x/api/throw", {
    method: "POST",
    headers: { "CF-Connecting-IP": "1.2.3.4", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const valid = { image: "AAAA", mediaType: "image/jpeg", category: "kombin", token: "t" };

// 1. happy path
claudeReply = "Here you go:\n" + good;
let r = await onRequestPost({ request: req(valid), env });
let d = await r.json();
assert.equal(r.status, 200); assert.equal(d.ok, true); assert.equal(d.comments.length, 5);
assert.equal(d.comments[0].name, "Nermin Teyze"); assert.equal(d.remaining, 1);

// 2. refusal does not consume a throw
claudeReply = JSON.stringify({ uygun: false, neden: "Bu fotoğrafta çocuk var, atamıyoruz." });
r = await onRequestPost({ request: req(valid), env });
d = await r.json();
assert.equal(d.ok, false); assert.match(d.message, /çocuk/); assert.equal(d.remaining, 1);

// 3. second real throw, then limit
claudeReply = good;
r = await onRequestPost({ request: req(valid), env }); d = await r.json();
assert.equal(d.ok, true); assert.equal(d.remaining, 0);
r = await onRequestPost({ request: req(valid), env }); d = await r.json();
assert.equal(r.status, 429); assert.equal(d.error, "limit");

// 4. turnstile failure
turnstileOK = false;
r = await onRequestPost({ request: req(valid), env: { ...env, DB: fakeDB() } });
assert.equal(r.status, 403);
turnstileOK = true;

// 5. bad inputs
r = await onRequestPost({ request: req({ ...valid, mediaType: "image/gif" }), env });
assert.equal(r.status, 400);
r = await onRequestPost({ request: req({ ...valid, image: "" }), env });
assert.equal(r.status, 400);

// 6. broken AI output -> 502, no usage counted
claudeReply = "sorry, no json";
const env2 = { ...env, DB: fakeDB() };
r = await onRequestPost({ request: req(valid), env: env2 });
assert.equal(r.status, 502); assert.equal(env2.DB.rows.size, 0);

// 7. parser keeps character order and drops unknown ids
const p = parseResult(JSON.stringify({ uygun: true, yorumlar: [
  { id: "sozluk", metin: "a" }, { id: "x", metin: "b" }, { id: "nermin", metin: "c" }, { id: "kaan", metin: "d" } ] }));
assert.deepEqual(p.yorumlar.map((y) => y.id), ["nermin", "kaan", "sozluk"]);

console.log("all tests passed");
