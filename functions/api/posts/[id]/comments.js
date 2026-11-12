// POST /api/posts/:id/comments  { nick, body, token }

import { LIMITS, json, fail, visitor, withCookie, human, takeRate, clean, blocked, newId } from "../../../../lib/server.js";

export async function onRequestPost({ params, request, env }) {
  const v = await visitor(request, env);
  const done = (res) => withCookie(res, v);

  let data;
  try { data = await request.json(); } catch { return done(fail("İstek okunamadı.")); }

  const body = clean(data.body, LIMITS.commentMax);
  const nick = clean(data.nick, LIMITS.nickMax) || "Anonim";
  if (body.length < 2) return done(fail("Yorum çok kısa."));
  if (blocked(body) || blocked(nick)) {
    return done(fail("Yorumunda uygun olmayan bir ifade ya da link var. Burada şeylere gülüyoruz, insanlara değil.", 400, "blocked"));
  }

  const post = await env.DB.prepare("SELECT id, status FROM posts WHERE id = ?").bind(params.id).first();
  if (!post || post.status !== "live") return done(fail("Bu kazan bulunamadı.", 404, "not_found"));

  if (!(await human(env, data.token, v.ip))) return done(fail("Robot olmadığını doğrulayamadık, tekrar dene.", 403, "turnstile"));
  if (!(await takeRate(env, "comment", v, LIMITS.commentsPerDay))) return done(fail("Bugünlük yorum hakkın doldu.", 429, "limit"));

  const id = newId(10);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO comments (id, post_id, created_at, author_hash, nick, body) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, post.id, now, v.hash, nick, body),
    env.DB.prepare("UPDATE posts SET comment_count = comment_count + 1, last_activity = ? WHERE id = ?").bind(now, post.id),
  ]);

  return done(json({ ok: true, comment: { id, nick, body, score: 0, createdAt: now, mine: true, myVote: 0 } }));
}
