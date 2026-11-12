import { $, api, postJSON, el, getNick, setNick, turnstile, timeAgo, toast } from "/common.js";

const id = location.pathname.split("/").filter(Boolean)[1];
const params = new URLSearchParams(location.search);
let post = null, comments = [], ts = null;

async function load() {
  const data = await api(`/api/posts/${encodeURIComponent(id)}`);
  if (!data.ok) { $("#notFound").hidden = false; return; }
  post = data.post; comments = data.comments;
  render();
}

function render() {
  $("#post").hidden = false;
  $("#photo").src = post.image;
  $("#photo").alt = post.question || `${post.nick} kazana attı`;
  if (post.width && post.height) { $("#photo").width = post.width; $("#photo").height = post.height; }
  $("#question").textContent = post.question || `${post.nick} kazana attı`;
  $("#meta").replaceChildren(
    el("span", { class: "pill" }, post.categoryLabel), el("span", {}, post.nick), el("span", {}, "·"),
    el("span", {}, timeAgo(post.createdAt)));

  if (post.status === "pending") {
    note("Fotoğrafın onay bekliyor. Onaylanınca herkes görecek; şimdilik sadece sen görüyorsun.");
    return;
  }
  if (params.has("yeni")) note("Kazana attın! Linki arkadaşlarına gönder, yorumlar gelsin.");

  $("#commentsSection").hidden = false;
  $("#cnick").value = getNick();
  if (!ts) ts = turnstile("#commentTs");
  renderComments();
}

function note(msg) { $("#note").textContent = msg; $("#note").hidden = false; }

function renderComments() {
  const ul = $("#comments");
  ul.replaceChildren(...comments.map((c, i) => commentEl(c, i === 0 && c.score > 0)));
  $("#noComments").hidden = comments.length > 0;
}

function commentEl(c, winner) {
  const up = el("button", { class: "up", "aria-label": "Komik", "aria-pressed": String(c.myVote === 1), disabled: c.mine || null }, "▲");
  const down = el("button", { class: "down", "aria-label": "Değil", "aria-pressed": String(c.myVote === -1), disabled: c.mine || null }, "▼");
  const score = el("span", { class: "score" }, String(c.score));
  up.addEventListener("click", () => vote(c, c.myVote === 1 ? 0 : 1));
  down.addEventListener("click", () => vote(c, c.myVote === -1 ? 0 : -1));

  return el("li", { class: "comment" + (winner ? " winner" : "") },
    winner ? el("span", { class: "winner-badge" }, "👑 Kazanan yorum") : null,
    el("div", {},
      el("div", { class: "who" }, c.nick, el("small", {}, timeAgo(c.createdAt))),
      el("p", {}, c.body)),
    el("div", { class: "vote" }, up, score, down),
    el("div", { class: "tools" },
      c.mine ? null : el("button", { class: "link-btn", onclick: () => report("comment", c.id) }, "Bildir")));
}

async function vote(c, value) {
  const data = await postJSON(`/api/comments/${c.id}/vote`, { value });
  if (!data.ok) { toast(data.message || "Oy verilemedi."); return; }
  c.score = data.score; c.myVote = data.myVote;
  comments.sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  renderComments();
}

async function report(type, targetId) {
  const data = await postJSON("/api/report", { type, id: targetId });
  toast(data.ok ? "Bildirdin, teşekkürler. İnceleyeceğiz." : data.message || "Bildirilemedi.");
}

$("#reportPost").addEventListener("click", () => report("post", id));

// ---------- compose ----------
const body = $("#body");
body.addEventListener("input", () => {
  $("#counter").textContent = `${body.value.length}/280`;
  $("#sendBtn").disabled = body.value.trim().length < 2;
});

$("#compose").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#sendBtn");
  btn.disabled = true;
  $("#commentError").hidden = true;
  const nick = $("#cnick").value.trim();
  setNick(nick);
  const token = await ts.getToken();
  const data = await postJSON(`/api/posts/${id}/comments`, { body: body.value, nick, token: token || "" });
  ts.reset();
  if (!data.ok) {
    $("#commentError").textContent = data.message || "Yorum gönderilemedi.";
    $("#commentError").hidden = false;
    btn.disabled = false;
    return;
  }
  comments.push(data.comment);
  renderComments();
  body.value = ""; $("#counter").textContent = "0/280";
  toast("Yorumun kazanda!");
});

// ---------- share ----------
$("#copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.origin + "/p/" + id); toast("Link kopyalandı"); }
  catch { toast(location.origin + "/p/" + id); }
});

$("#shareBtn").addEventListener("click", async () => {
  const url = location.origin + "/p/" + id;
  const text = post.question ? `${post.question} Yorumla, en iyi yorum kazansın:` : "Kazana attım, yorumla:";
  let file = null;
  try { file = new File([await drawCard()], "yorumkazani.png", { type: "image/png" }); } catch {}
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: `${text} ${url}` }); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  if (navigator.share) { try { await navigator.share({ text, url }); return; } catch (err) { if (err.name === "AbortError") return; } }
  if (file) {
    const a = el("a", { href: URL.createObjectURL(file), download: "yorumkazani.png" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Hikaye görseli indirildi");
  }
});

// 1080x1920 story card: photo, question, the current winning comment, logo.
async function drawCard() {
  const F = "Bangers, Impact, sans-serif", B = "Nunito, Arial, sans-serif";
  await Promise.all([`400 80px Bangers`, `900 40px Nunito`, `800 44px Nunito`].map((f) => document.fonts.load(f, "ŞĞİÜÖÇ"))).catch(() => {});
  const W = 1080, H = 1920, P = 70;
  const c = el("canvas", { width: W, height: H });
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f3f1"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#f13e3a"; ctx.fillRect(0, 0, W, 16);

  // question
  ctx.textAlign = "center"; ctx.fillStyle = "#2a2a2c";
  ctx.font = `400 84px ${F}`;
  const q = (post.question || "Kazana attım!").toLocaleUpperCase("tr-TR");
  const qLines = wrap(ctx, q, W - P * 2).slice(0, 3);
  let y = 150;
  qLines.forEach((l) => { ctx.fillText(l, W / 2, y); y += 88; });
  y += 10;

  // winning comment box height first, so the photo can take the rest
  const win = comments[0] && comments[0].score > 0 ? comments[0] : null;
  ctx.font = `800 46px ${B}`;
  const wLines = win ? wrap(ctx, win.body, W - P * 2 - 80).slice(0, 4) : [];
  const boxH = win ? 150 + wLines.length * 58 : 170;
  const footer = 270;
  const photoMax = H - y - boxH - footer - 60;

  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = post.image; });
  const s = Math.min((W - P * 2) / img.width, photoMax / img.height);
  const pw = img.width * s, ph = img.height * s, px = (W - pw) / 2;
  y += Math.max(0, (photoMax - ph) / 2); // center the block when the photo is wide
  ctx.save(); round(ctx, px, y, pw, ph, 36); ctx.clip(); ctx.drawImage(img, px, y, pw, ph); ctx.restore();
  y += ph + 40;

  // comment box
  ctx.fillStyle = "#fff"; round(ctx, P, y, W - P * 2, boxH, 32); ctx.fill();
  ctx.textAlign = "left";
  if (win) {
    ctx.fillStyle = "#f5b82e"; round(ctx, P + 30, y - 26, 360, 56, 28); ctx.fill();
    ctx.fillStyle = "#3d2a00"; ctx.font = `900 32px ${B}`; ctx.fillText("👑 Kazanan yorum", P + 52, y + 13);
    ctx.fillStyle = "#f13e3a"; ctx.font = `900 36px ${B}`; ctx.fillText(win.nick, P + 40, y + 85);
    ctx.fillStyle = "#2a2a2c"; ctx.font = `800 46px ${B}`;
    wLines.forEach((l, i) => ctx.fillText(l, P + 40, y + 148 + i * 58));
  } else {
    ctx.fillStyle = "#2a2a2c"; ctx.font = `900 48px ${B}`; ctx.textAlign = "center";
    ctx.fillText("Sence ne demeli?", W / 2, y + 80);
    ctx.fillStyle = "#86868b"; ctx.font = `800 36px ${B}`;
    ctx.fillText("En çok oy alan yorum kazanır", W / 2, y + 130);
  }

  // footer: logo + url
  ctx.textAlign = "center";
  try {
    const logo = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = "/brand/logo-480.png"; });
    const lw = 260, lh = logo.height * (lw / logo.width);
    ctx.drawImage(logo, (W - lw) / 2, H - footer + 6, lw, lh);
  } catch {}
  ctx.fillStyle = "#404042"; ctx.font = `900 40px ${B}`;
  ctx.fillText("yorumkazani.com", W / 2, H - 28);

  return new Promise((r) => c.toBlob(r, "image/png"));
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function round(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

load();
