// GET  /api/admin            moderation queue (pending / hidden / reported)
// POST /api/admin  { type, id, action: "approve"|"hide"|"delete" }
// Requires header  Authorization: Bearer <ADMIN_TOKEN>

import { json, fail, isAdmin, publicPost } from "../../lib/server.js";

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return fail("Yetkisiz.", 401, "unauthorized");

  const { results: posts } = await env.DB.prepare(
    `SELECT * FROM posts WHERE status IN ('pending','hidden') OR report_count > 0
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'hidden' THEN 1 ELSE 2 END, created_at DESC LIMIT 100`
  ).all();
  const { results: comments } = await env.DB.prepare(
    `SELECT c.*, p.question AS post_question FROM comments c LEFT JOIN posts p ON p.id = c.post_id
     WHERE c.status = 'hidden' OR c.report_count > 0
     ORDER BY CASE c.status WHEN 'hidden' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`
  ).all();
  const stats = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM posts WHERE status='live') AS live_posts,
            (SELECT COUNT(*) FROM comments WHERE status='live') AS live_comments,
            (SELECT COUNT(*) FROM posts WHERE created_at > ?) AS posts_24h,
            (SELECT COUNT(*) FROM comments WHERE created_at > ?) AS comments_24h`
  ).bind(Date.now() - 864e5, Date.now() - 864e5).first();

  return json({
    ok: true,
    stats,
    posts: posts.map((p) => ({ ...publicPost(p), reportCount: p.report_count })),
    comments: comments.map((c) => ({
      id: c.id, postId: c.post_id, postQuestion: c.post_question, nick: c.nick, body: c.body,
      status: c.status, score: c.score, reportCount: c.report_count, createdAt: c.created_at,
    })),
  });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return fail("Yetkisiz.", 401, "unauthorized");
  let d;
  try { d = await request.json(); } catch { return fail("İstek okunamadı."); }
  const { type, id, action } = d || {};
  if (!["post", "comment"].includes(type) || typeof id !== "string") return fail("Geçersiz.");

  if (type === "post") {
    if (action === "approve") await env.DB.prepare("UPDATE posts SET status='live', report_count=0 WHERE id=?").bind(id).run();
    else if (action === "hide") await env.DB.prepare("UPDATE posts SET status='hidden' WHERE id=?").bind(id).run();
    else if (action === "delete") {
      const p = await env.DB.prepare("SELECT image_key FROM posts WHERE id=?").bind(id).first();
      if (p) await env.IMAGES.delete(p.image_key);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM votes WHERE comment_id IN (SELECT id FROM comments WHERE post_id=?)").bind(id),
        env.DB.prepare("DELETE FROM reports WHERE target_type='comment' AND target_id IN (SELECT id FROM comments WHERE post_id=?)").bind(id),
        env.DB.prepare("DELETE FROM comments WHERE post_id=?").bind(id),
        env.DB.prepare("DELETE FROM reports WHERE target_type='post' AND target_id=?").bind(id),
        env.DB.prepare("DELETE FROM posts WHERE id=?").bind(id),
      ]);
    } else return fail("Geçersiz işlem.");
  } else {
    if (action === "approve") await env.DB.prepare("UPDATE comments SET status='live', report_count=0 WHERE id=?").bind(id).run();
    else if (action === "hide") await env.DB.prepare("UPDATE comments SET status='hidden' WHERE id=?").bind(id).run();
    else if (action === "delete") {
      const c = await env.DB.prepare("SELECT post_id, status FROM comments WHERE id=?").bind(id).first();
      if (c) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM votes WHERE comment_id=?").bind(id),
          env.DB.prepare("DELETE FROM reports WHERE target_type='comment' AND target_id=?").bind(id),
          env.DB.prepare("DELETE FROM comments WHERE id=?").bind(id),
          env.DB.prepare("UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id=?").bind(c.post_id),
        ]);
      }
    } else return fail("Geçersiz işlem.");
  }
  return json({ ok: true });
}
