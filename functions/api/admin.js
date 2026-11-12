// GET  /api/admin            moderation queue (pending / hidden / reported)
// POST /api/admin  { type, id, action: "approve"|"hide"|"delete" }
// Requires header  Authorization: Bearer <ADMIN_TOKEN>

import { json, fail, isAdmin, publicPost, deletePost, purgeStale } from "../../lib/server.js";

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return fail("Yetkisiz.", 401, "unauthorized");
  await purgeStale(env);

  const { results: posts } = await env.DB.prepare(
    `SELECT * FROM posts WHERE status IN ('pending','hidden') OR report_count > 0
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'hidden' THEN 1 ELSE 2 END, created_at DESC LIMIT 100`
  ).all();
  const { results: comments } = await env.DB.prepare(
    `SELECT c.*, p.question AS post_question FROM comments c LEFT JOIN posts p ON p.id = c.post_id
     WHERE c.status = 'hidden' OR c.report_count > 0
     ORDER BY CASE c.status WHEN 'hidden' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`
  ).all();
  const { results: livePosts } = await env.DB.prepare(
    `SELECT * FROM posts WHERE status = 'live' ORDER BY created_at DESC LIMIT 60`
  ).all();
  const { results: liveComments } = await env.DB.prepare(
    `SELECT c.*, p.question AS post_question FROM comments c LEFT JOIN posts p ON p.id = c.post_id
     WHERE c.status = 'live' ORDER BY c.created_at DESC LIMIT 100`
  ).all();
  const stats = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM posts WHERE status='live') AS live_posts,
            (SELECT COUNT(*) FROM comments WHERE status='live') AS live_comments,
            (SELECT COUNT(*) FROM posts WHERE created_at > ?) AS posts_24h,
            (SELECT COUNT(*) FROM comments WHERE created_at > ?) AS comments_24h`
  ).bind(Date.now() - 864e5, Date.now() - 864e5).first();

  const mapPost = (p) => ({ ...publicPost(p), reportCount: p.report_count });
  const mapComment = (c) => ({
    id: c.id, postId: c.post_id, postQuestion: c.post_question, nick: c.nick, body: c.body,
    status: c.status, score: c.score, reportCount: c.report_count, createdAt: c.created_at,
  });
  return json({
    ok: true,
    stats,
    posts: posts.map(mapPost),            // pending / hidden / reported
    comments: comments.map(mapComment),   // hidden / reported
    livePosts: livePosts.map(mapPost),
    liveComments: liveComments.map(mapComment),
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
    else if (action === "hide") await env.DB.prepare("UPDATE posts SET status='hidden', last_activity=? WHERE id=?").bind(Date.now(), id).run();
    else if (action === "delete") {
      await deletePost(env, id);
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
