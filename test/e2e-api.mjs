// End-to-end API test against `npm run dev` (local D1 + R2, MODERATION=off, DEV_SKIP_TURNSTILE=1).
// Run: node test/e2e-api.mjs [baseUrl]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8788";
const ADMIN = (readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/ADMIN_TOKEN=(.+)/) || [])[1];
const photo = readFileSync(process.env.PHOTO);

function client(ip) {
  let cookie = "";
  return async (path, opts = {}) => {
    const res = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), cookie, "CF-Connecting-IP": ip } });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, data: ct.includes("json") ? await res.json() : await res.arrayBuffer() };
  };
}
const ali = client("10.0.0.1"), ayse = client("10.0.0.2"), mehmet = client("10.0.0.3");
const J = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function upload(c, q, extra = {}) {
  const fd = new FormData();
  fd.append("image", new Blob([extra.bytes || photo], { type: extra.type || "image/jpeg" }), "p.jpg");
  fd.append("width", "900"); fd.append("height", "1200"); fd.append("category", "kombin");
  fd.append("question", q); fd.append("nick", extra.nick || "Ali"); fd.append("token", "x");
  return c("/api/posts", { method: "POST", body: fd });
}

// upload
let r = await upload(ali, "Bu kombinle düğüne gidilir mi?");
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, "live");
const pid = r.data.id;

// bad uploads
r = await upload(ali, "x", { bytes: Buffer.from("GIF89a....") }); assert.equal(r.status, 400);
r = await upload(ali, "x", { type: "image/png" }); assert.equal(r.status, 400);
r = await upload(ali, "Ne kadar şişko olmuşum", {}); assert.equal(r.data.error, "blocked");

// image served
r = await ayse(`/i/${pid}.jpg`); assert.equal(r.status, 200); assert.equal(r.data.byteLength, photo.length);

// feed
r = await ayse("/api/posts"); assert.equal(r.data.posts[0].id, pid);

// comments
r = await ayse(`/api/posts/${pid}/comments`, J({ body: "Düğüne değil, nikah memuru olarak gidilir.", nick: "Ayşe", token: "x" }));
assert.equal(r.status, 200); const c1 = r.data.comment.id;
r = await mehmet(`/api/posts/${pid}/comments`, J({ body: "Mor ceket = patlıcan közü.", nick: "Mehmet", token: "x" }));
const c2 = r.data.comment.id;
r = await mehmet(`/api/posts/${pid}/comments`, J({ body: "amk çok kötü", token: "x" })); assert.equal(r.data.error, "blocked");
r = await mehmet(`/api/posts/${pid}/comments`, J({ body: "bak www.site.com", token: "x" })); assert.equal(r.data.error, "blocked");
r = await mehmet(`/api/posts/${pid}/comments`, J({ body: "Kazanı götür buradan", token: "x" })); assert.equal(r.status, 200, "götür must not be blocked");

// votes: own vote refused, others counted, toggling works
r = await ayse(`/api/comments/${c1}/vote`, J({ value: 1 })); assert.equal(r.data.error, "own");
r = await ali(`/api/comments/${c2}/vote`, J({ value: 1 })); assert.equal(r.data.score, 1);
r = await ayse(`/api/comments/${c2}/vote`, J({ value: 1 })); assert.equal(r.data.score, 2);
r = await ayse(`/api/comments/${c2}/vote`, J({ value: -1 })); assert.equal(r.data.score, 0);
r = await ayse(`/api/comments/${c2}/vote`, J({ value: 1 })); assert.equal(r.data.score, 2);
r = await ali(`/api/comments/${c1}/vote`, J({ value: -1 })); assert.equal(r.data.score, -1);

r = await ali(`/api/posts/${pid}`);
assert.equal(r.data.comments[0].id, c2, "best comment first"); assert.equal(r.data.comments[0].myVote, 1);
assert.equal(r.data.post.commentCount, 3); assert.equal(r.data.post.mine, true);

// reports: same person twice counts once; 3 different people hide it
for (const c of [ali, ali, ayse]) await c("/api/report", J({ type: "comment", id: c1 }));
r = await ali(`/api/posts/${pid}`); assert.ok(r.data.comments.some((c) => c.id === c1), "2 reports: still visible");
await mehmet("/api/report", J({ type: "comment", id: c1 }));
r = await ali(`/api/posts/${pid}`); assert.ok(!r.data.comments.some((c) => c.id === c1), "3 reports: hidden");

// admin
r = await ali("/api/admin"); assert.equal(r.status, 401);
const admin = (m, b) => ali("/api/admin", { method: m, headers: { authorization: `Bearer ${ADMIN}`, ...(b ? { "content-type": "application/json" } : {}) }, body: b ? JSON.stringify(b) : undefined });
r = await admin("GET"); assert.equal(r.data.comments[0].id, c1); assert.equal(r.data.comments[0].status, "hidden");
r = await admin("POST", { type: "comment", id: c1, action: "approve" });
r = await ali(`/api/posts/${pid}`); assert.ok(r.data.comments.some((c) => c.id === c1), "approved again");

// hidden post: image and page gone for others, admin still sees image
await admin("POST", { type: "post", id: pid, action: "hide" });
r = await ayse(`/i/${pid}.jpg`); assert.equal(r.status, 404);
r = await ayse(`/api/posts/${pid}`); assert.equal(r.status, 404);
r = await ayse(`/i/${pid}.jpg`, { headers: { authorization: `Bearer ${ADMIN}` } }); assert.equal(r.status, 200);
await admin("POST", { type: "post", id: pid, action: "approve" });

// post page has share tags
const html = await (await fetch(`${BASE}/p/${pid}`)).text();
assert.ok(html.includes(`og:image" content="${BASE}/i/${pid}.jpg`)); assert.ok(html.includes("Bu kombinle düğüne gidilir mi?"));
assert.equal((await fetch(`${BASE}/p/zzzzzzzz`)).status, 404);

// daily upload limit (5 per visitor)
for (let i = 0; i < 4; i++) { r = await upload(mehmet, `Deneme ${i}`); assert.equal(r.status, 200); }
r = await upload(mehmet, "Deneme 5"); assert.equal(r.status, 200);
r = await upload(mehmet, "Deneme 6"); assert.equal(r.status, 429);

// delete removes everything
r = await admin("POST", { type: "post", id: pid, action: "delete" }); assert.equal(r.data.ok, true);
r = await admin("GET", null);
r = await ayse(`/i/${pid}.jpg`, { headers: { authorization: `Bearer ${ADMIN}` } }); assert.equal(r.status, 404);

console.log("all e2e API tests passed");
