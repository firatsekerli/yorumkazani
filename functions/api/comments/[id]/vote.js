// POST /api/comments/:id/vote  { value: 1 | -1 | 0 }   0 removes the vote

import { LIMITS, json, fail, visitor, withCookie, takeRate } from "../../../../lib/server.js";

export async function onRequestPost({ params, request, env }) {
  const v = await visitor(request, env);
  const done = (res) => withCookie(res, v);

  let data;
  try { data = await request.json(); } catch { return done(fail("İstek okunamadı.")); }
  const value = [1, -1, 0].includes(data.value) ? data.value : null;
  if (value === null) return done(fail("Geçersiz oy."));

  const c = await env.DB.prepare("SELECT id, author_hash, status FROM comments WHERE id = ?").bind(params.id).first();
  if (!c || c.status !== "live") return done(fail("Yorum bulunamadı.", 404, "not_found"));
  if (c.author_hash === v.hash) return done(fail("Kendi yorumuna oy veremezsin.", 400, "own"));
  if (!(await takeRate(env, "vote", v, LIMITS.votesPerDay))) return done(fail("Bugünlük oy hakkın doldu.", 429, "limit"));

  const prev = await env.DB.prepare("SELECT value FROM votes WHERE comment_id = ? AND voter_hash = ?").bind(c.id, v.hash).first();
  const delta = value - (prev ? prev.value : 0);
  const stmts = [];
  if (value === 0) stmts.push(env.DB.prepare("DELETE FROM votes WHERE comment_id = ? AND voter_hash = ?").bind(c.id, v.hash));
  else stmts.push(env.DB.prepare(
    "INSERT INTO votes (comment_id, voter_hash, value) VALUES (?, ?, ?) ON CONFLICT(comment_id, voter_hash) DO UPDATE SET value = excluded.value"
  ).bind(c.id, v.hash, value));
  if (delta) stmts.push(env.DB.prepare("UPDATE comments SET score = score + ? WHERE id = ?").bind(delta, c.id));
  await env.DB.batch(stmts);

  const row = await env.DB.prepare("SELECT score FROM comments WHERE id = ?").bind(c.id).first();
  return done(json({ ok: true, score: row.score, myVote: value }));
}
