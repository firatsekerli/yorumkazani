// GET /p/:id   the post page. Serves public/post.html with the right title and
// social preview tags filled in, so a shared link shows the photo on WhatsApp / X / Instagram.

export async function onRequestGet({ params, request, env }) {
  const page = await env.ASSETS.fetch(new URL("/post.html", request.url));
  let html = await page.text();

  const post = /^[a-z2-9]{8}$/.test(params.id)
    ? await env.DB.prepare("SELECT id, question, nick, status, comment_count, width, height, created_at FROM posts WHERE id = ?").bind(params.id).first()
    : null;

  if (post && post.status === "live") {
    const origin = new URL(request.url).origin;
    const title = post.question ? `${post.question} | Yorum Kazanı` : `${post.nick} kazana attı | Yorum Kazanı`;
    const desc = `${post.comment_count} yorum. Sen de yorumla, en çok oy alan yorum kazansın!`;
    const tags = `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${origin}/i/${post.id}.jpg">
  <meta property="og:url" content="${origin}/p/${post.id}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${origin}/p/${post.id}">`;
    html = html.replace(/<title>[^<]*<\/title>/, tags);

    // Render the photo card on the server so the page doesn't jump while the script loads.
    const label = post.question || `${post.nick} kazana attı`;
    const size = post.width && post.height ? ` width="${post.width}" height="${post.height}"` : "";
    html = html
      .replace('<article class="post-card" id="post" hidden>', '<article class="post-card" id="post">')
      .replace('<img id="photo" alt="">', `<img id="photo" src="/i/${post.id}.jpg" alt="${esc(label)}"${size} fetchpriority="high">`)
      .replace('<h1 class="post-q" id="question"></h1>', `<h1 class="post-q" id="question">${esc(label)}</h1>`)
      .replace('<div class="meta" id="meta"></div>', `<div class="meta" id="meta"><span>${esc(post.nick)}</span></div>`)
      .replace('<section id="commentsSection" hidden>', '<section id="commentsSection">');

    if (new URL(request.url).searchParams.has("yeni")) {
      html = html.replace('<p class="ok-note" id="note" hidden></p>', '<p class="ok-note" id="note">Kazana attın! Linki arkadaşlarına gönder, yorumlar gelsin.</p>');
    }

    const next = await env.DB.prepare(
      "SELECT id FROM posts WHERE status = 'live' AND created_at < ? ORDER BY created_at DESC LIMIT 1"
    ).bind(post.created_at).first();
    if (next) {
      html = html.replace('<a class="back-link next-link" id="nextTop" href="/" hidden>', `<a class="back-link next-link" id="nextTop" href="/p/${next.id}">`);
    }
  } else {
    html = html.replace("<head>", '<head>\n  <meta name="robots" content="noindex">');
  }

  return new Response(html, {
    status: post ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
