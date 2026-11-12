// GET /   the homepage, with the first photos already in the HTML.
// Rendering them on the server means the page arrives in its final shape: no
// "Son atılanlar" flashing in and out, and no jump when the photos appear.

import { listPosts } from "../lib/server.js";

const FIRST = 12;

export async function onRequestGet({ request, env }) {
  const page = await env.ASSETS.fetch(new URL("/", request.url));
  let html = await page.text();

  let posts = [], next = null;
  try { ({ posts, next } = await listPosts(env, { limit: FIRST })); } catch {}

  if (posts.length) {
    html = html
      .replace('<section class="feed" id="son" hidden>', '<section class="feed" id="son">')
      .replace('<div class="grid" id="feed"></div>', `<div class="grid" id="feed" data-ssr="1">${posts.map(card).join("")}</div>`);
    if (next) html = html.replace('<button class="btn btn-ghost more" id="more" hidden>', `<button class="btn btn-ghost more" id="more" data-next="${next}">`);
  }

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

// Same markup as card() in public/home.js.
function card(p) {
  const q = p.question ? `<p class="card-q">${esc(p.question)}</p>` : "";
  const size = p.width && p.height ? ` width="${p.width}" height="${p.height}"` : "";
  const top = p.top
    ? `<div class="top-comment">${p.top.score > 0 ? '<span class="crown" title="Kazanan yorum">👑</span>' : ""}<b>${esc(p.top.nick)}: </b>${esc(p.top.body)}</div>`
    : '<div class="top-comment empty-top">İlk yorumu sen yaz!</div>';
  return `<a class="card" href="/p/${p.id}"><img src="${p.image}" alt="${esc(p.question || "Kazana atılan fotoğraf")}" loading="lazy"${size}>` +
    `<div class="card-body">${q}<div class="meta"><span>${esc(p.nick)}</span><span>·</span><span>${timeAgo(p.createdAt)}</span>` +
    `<span>·</span><span>${p.commentCount} yorum</span></div>${top}</div></a>`;
}

function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "az önce";
  const m = Math.round(s / 60); if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60); if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24); if (d < 30) return `${d} gün önce`;
  return new Date(ms).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
