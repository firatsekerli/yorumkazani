// GET  /api/posts?sort=new|hot&before=<cursor>&limit=<1-24>   list live posts
// POST /api/posts  (multipart: image, category, question, nick, token)   upload a photo

import {
  CATEGORIES, LIMITS, json, fail, visitor, withCookie, human, takeRate, clean, blocked, newId, checkPhoto, toBase64, publicPost, listPosts, purgeStale,
} from "../../../lib/server.js";

const PAGE = 24;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") === "hot" ? "hot" : "new";
  const before = Number(url.searchParams.get("before")) || Date.now() + 1;
  const limit = Math.min(PAGE, Math.max(1, Number(url.searchParams.get("limit")) || PAGE));

  const { posts, next } = await listPosts(env, { sort, before, limit });
  return json({ ok: true, posts, next });
}

export async function onRequestPost({ request, env, waitUntil }) {
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
  await env.IMAGES.put(`p/${id}.jpg`, buf); // Workers KV
  await env.DB.prepare(
    `INSERT INTO posts (id, created_at, author_hash, nick, category, question, image_key, width, height, status, last_activity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, now, v.hash, nick, category, question, `p/${id}.jpg`, width, height, status, now).run();

  waitUntil(purgeStale(env).catch(() => {}));
  return done(json({ ok: true, id, status }));
}
