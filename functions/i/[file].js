// GET /i/<postId>.jpg   serves a post photo from R2 (live posts only, or pending ones to their uploader / admin)

import { visitor, isAdmin } from "../../lib/server.js";

export async function onRequestGet({ params, request, env }) {
  const m = /^([a-z2-9]{8})\.jpg$/.exec(params.file);
  if (!m) return new Response("Not found", { status: 404 });

  const post = await env.DB.prepare("SELECT status, author_hash, image_key FROM posts WHERE id = ?").bind(m[1]).first();
  if (!post) return new Response("Not found", { status: 404 });

  let allowed = post.status === "live";
  if (!allowed) {
    const v = await visitor(request, env);
    allowed = isAdmin(request, env) || (post.status === "pending" && post.author_hash === v.hash);
  }
  if (!allowed) return new Response("Not found", { status: 404 });

  const obj = await env.IMAGES.get(post.image_key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": "image/jpeg",
      // Short cache so a hidden photo disappears quickly.
      "cache-control": post.status === "live" ? "public, max-age=300" : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
