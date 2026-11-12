// GET /i/<postId>.jpg   serves a post photo from Workers KV (live posts only, or pending ones to their uploader / admin)

import { visitor, isAdmin } from "../../lib/server.js";

export async function onRequestGet({ params, request, env }) {
  const m = /^([a-z2-9]{8})\.jpg$/.exec(params.file);
  if (!m) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

  const post = await env.DB.prepare("SELECT status, author_hash, image_key FROM posts WHERE id = ?").bind(m[1]).first();
  if (!post) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

  let allowed = post.status === "live";
  if (!allowed) {
    const v = await visitor(request, env);
    allowed = isAdmin(request, env) || (post.status === "pending" && post.author_hash === v.hash);
  }
  if (!allowed) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

  const body = await env.IMAGES.get(post.image_key, "stream"); // Workers KV
  if (!body) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(body, {
    headers: {
      "content-type": "image/jpeg",
      // Browsers keep live photos 5 min, the Cloudflare edge 1 hour (cache rule on /i/),
      // so most views never reach this code. A hidden photo can stay cached up to 1 hour.
      "cache-control": post.status === "live" ? "public, max-age=300, s-maxage=3600" : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
