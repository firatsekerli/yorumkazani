// GET  /api/posts?sort=new|hot&before=<cursor>   list live posts
// POST /api/posts  (multipart: image, category, question, nick, token)   upload a photo

import {
  CATEGORIES, LIMITS, json, fail, visitor, withCookie, human, takeRate, clean, blocked, newId, checkPhoto, toBase64, publicPost,
} from "../../../lib/server.js";

const PAGE = 24;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") === "hot" ? "hot" : "new";
  const before = Number(url.searchParams.get("before")) || Date.now() + 1;
  const col = sort === "hot" ? "last_activity" : "created_at";

  const { results } = await env.DB.prepare(
    `SELECT * FROM posts WHERE status = 'live' AND ${col} < ? ORDER BY ${col} DESC LIMIT ?`
  ).bind(before, PAGE).all();

  // top comment preview for each card
  const ids = results.map((p) => p.id);
  const tops = {};
  if (ids.length) {
    const marks = ids.map(() => "?").join(",");
    const { results: cs } = await env.DB.prepare(
      `SELECT post_id, nick, body, score FROM comments c
       WHERE status = 'live' AND post_id IN (${marks})
         AND id = (SELECT id FROM comments c2 WHERE c2.post_id = c.post_id AND c2.status = 'live'
                   ORDER BY score DESC, created_at ASC LIMIT 1)`
    ).bind(...ids).all();
    for (const c of cs) tops[c.post_id] = { nick: c.nick, body: c.body, score: c.score };
  }

  const posts = results.map((p) => ({ ...publicPost(p), top: tops[p.id] || null }));
  const next = results.length === PAGE ? results[results.length - 1][col] : null;
  return json({ ok: true, posts, next });
}

export async function onRequestPost({ request, env }) {
  const v = await visitor(request, env);
  const done = (res) => withCookie(res, v);

  let form;
  try {
    form = await request.formData();
  } catch {
    return done(fail("Form okunamadı."));
  }

  const file = form.get("image");
  const category = CATEGORIES[form.get("category")] ? form.get("category") : "diger";
  const question = clean(form.get("question"), LIMITS.questionMax);
  const nick = clean(form.get("nick"), LIMITS.nickMax) || "Anonim";
  const width = Math.min(4000, Number(form.get("width")) || 0);
  const height = Math.min(4000, Number(form.get("height")) || 0);

  if (!file || typeof file === "string") return done(fail("Fotoğraf seçmedin."));
  if (file.type !== "image/jpeg") return done(fail("Fotoğraf okunamadı, başka bir tane dene."));
  if (file.size > LIMITS.maxImageBytes) return done(fail("Fotoğraf çok büyük."));
  if (blocked(question) || blocked(nick)) return done(fail("Soruda ya da takma adda uygun olmayan bir ifade var.", 400, "blocked"));

  if (!(await human(env, form.get("token"), v.ip))) {
    return done(fail("Robot olmadığını doğrulayamadık, sayfayı yenileyip tekrar dene.", 403, "turnstile"));
  }
  if (!(await takeRate(env, "post", v, Number(env.POSTS_PER_DAY) || LIMITS.postsPerDay))) {
    return done(fail("Bugünlük kazana atma hakkın doldu. Yarın yine gel!", 429, "limit"));
  }

  const buf = await file.arrayBuffer();
  // JPEG magic bytes check (the browser re-encodes, so anything else is suspicious)
  const head = new Uint8Array(buf.slice(0, 3));
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return done(fail("Fotoğraf okunamadı."));

  const mode = env.MODERATION || (env.ANTHROPIC_API_KEY ? "ai" : "manual");
  let status = "live";
  if (mode === "manual") status = "pending";
  if (mode === "ai") {
    const check = await checkPhoto(env, toBase64(buf));
    if (check.decision === "reject") return done(fail(check.reason, 422, "rejected"));
    status = check.decision; // live or pending
  }

  const id = newId();
  const now = Date.now();
  await env.IMAGES.put(`p/${id}.jpg`, buf, { httpMetadata: { contentType: "image/jpeg" } });
  await env.DB.prepare(
    `INSERT INTO posts (id, created_at, author_hash, nick, category, question, image_key, width, height, status, last_activity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, now, v.hash, nick, category, question, `p/${id}.jpg`, width, height, status, now).run();

  return done(json({ ok: true, id, status }));
}
