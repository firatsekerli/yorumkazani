// GET /api/posts/:id   one post with its comments (best first) and the visitor's own votes

import { json, fail, visitor, withCookie, publicPost } from "../../../lib/server.js";

export async function onRequestGet({ params, request, env }) {
  const v = await visitor(request, env);
  const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(params.id).first();
  // The uploader can see their own pending post; everyone else only sees live posts.
  if (!post || (post.status !== "live" && !(post.status === "pending" && post.author_hash === v.hash))) {
    return withCookie(fail("Bu kazan bulunamadı.", 404, "not_found"), v);
  }

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.nick, c.body, c.score, c.created_at, c.author_hash = ? AS mine, vt.value AS my_vote
     FROM comments c LEFT JOIN votes vt ON vt.comment_id = c.id AND vt.voter_hash = ?
     WHERE c.post_id = ? AND c.status = 'live'
     ORDER BY c.score DESC, c.created_at ASC LIMIT 300`
  ).bind(v.hash, v.hash, post.id).all();

  const comments = results.map((c) => ({
    id: c.id, nick: c.nick, body: c.body, score: c.score, createdAt: c.created_at, mine: Boolean(c.mine), myVote: c.my_vote || 0,
  }));

  return withCookie(json({ ok: true, post: { ...publicPost(post), mine: post.author_hash === v.hash }, comments }), v);
}
