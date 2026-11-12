import { $, el, timeAgo, toast } from "/common.js";

let token = "";
try { token = sessionStorage.getItem("yk_admin") || ""; } catch {}
let tab = "queue";
const blobCache = new Map();

const call = (method, body) =>
  fetch("/api/admin", {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json()).catch(() => ({ ok: false }));

async function load() {
  const data = await call("GET");
  if (!data.ok) {
    $("#login").hidden = false; $("#panel").hidden = true; $("#logout").hidden = true; $("#refresh").hidden = true;
    if (token) { $("#loginError").textContent = "Anahtar yanlış."; $("#loginError").hidden = false; }
    return;
  }
  $("#login").hidden = true; $("#panel").hidden = false; $("#logout").hidden = false; $("#refresh").hidden = false;

  const s = data.stats;
  const queueCount = data.posts.length + data.comments.length;
  $("#stats").replaceChildren(
    stat(queueCount, "İncelenecek", queueCount > 0),
    stat(s.live_posts, "Yayındaki fotoğraf"),
    stat(s.live_comments, "Yayındaki yorum"),
    stat(`${s.posts_24h} / ${s.comments_24h}`, "Son 24 saat foto / yorum"));

  setCount("c-queue", queueCount, queueCount > 0);
  setCount("c-live", data.livePosts.length);
  setCount("c-comments", data.liveComments.length);

  fill("#queuePosts", data.posts.map(postRow), "İncelenecek fotoğraf yok. 🎉");
  fill("#queueComments", data.comments.map(commentRow), "İncelenecek yorum yok.");
  fill("#livePosts", data.livePosts.map(postTile), "Henüz yayında fotoğraf yok.");
  fill("#liveComments", data.liveComments.map(commentRow), "Henüz yorum yok.");
  showTab(tab);
}

function stat(n, label, hot) { return el("div", { class: "stat-card" + (hot ? " hot" : "") }, el("b", {}, String(n)), el("span", {}, label)); }
function setCount(id, n, alert) { const c = $("#" + id); c.textContent = n; c.classList.toggle("alert", Boolean(alert)); }
function fill(sel, items, emptyText) { $(sel).replaceChildren(...(items.length ? items : [el("div", { class: "empty-note" }, emptyText)])); }

const STATUS = { pending: "Onay bekliyor", hidden: "Gizlendi", live: "Yayında" };
const tag = (status) => el("span", { class: `tag ${status}` }, STATUS[status] || status);

function postRow(p) {
  return el("div", { class: "row-card" },
    thumb(p.id, "thumb"),
    el("div", {},
      el("div", {}, tag(p.status), p.reportCount ? el("span", { class: "tag reports" }, `${p.reportCount} bildirim`) : null),
      el("h3", {}, p.question || "(soru yok)"),
      p.modNote ? el("div", { class: "mod-note" }, p.modNote) : null,
      el("div", { class: "sub" }, `${p.nick} · ${timeAgo(p.createdAt)} · ${p.commentCount} yorum · `, el("a", { href: `/p/${p.id}`, target: "_blank" }, "sayfayı aç"))),
    el("div", { class: "actions-col" }, ...postButtons(p)));
}

function postTile(p) {
  return el("div", { class: "tile" },
    thumb(p.id),
    el("div", { class: "tile-body" },
      el("h3", {}, p.question || "(soru yok)"),
      el("div", { class: "sub" }, `${p.nick} · ${timeAgo(p.createdAt)} · ${p.commentCount} yorum`),
      el("div", { class: "tile-actions" },
        el("a", { class: "btn btn-ghost", href: `/p/${p.id}`, target: "_blank" }, "Aç"),
        actionBtn("Gizle", "post", p.id, "hide", "btn-ghost"),
        deleteBtn("post", p.id))));
}

function postButtons(p) {
  const out = [];
  if (p.status !== "live" || p.reportCount) out.push(actionBtn("Onayla", "post", p.id, "approve", "btn-red"));
  if (p.status !== "hidden") out.push(actionBtn("Gizle", "post", p.id, "hide", "btn-ghost"));
  out.push(deleteBtn("post", p.id));
  return out;
}

function commentRow(c) {
  const btns = [];
  if (c.status !== "live" || c.reportCount) btns.push(actionBtn("Onayla", "comment", c.id, "approve", "btn-red"));
  if (c.status !== "hidden") btns.push(actionBtn("Gizle", "comment", c.id, "hide", "btn-ghost"));
  btns.push(deleteBtn("comment", c.id));
  return el("div", { class: "row-card c" },
    el("div", {},
      el("div", {}, tag(c.status), c.reportCount ? el("span", { class: "tag reports" }, `${c.reportCount} bildirim`) : null,
        el("span", { class: "sub" }, `${c.score >= 0 ? "+" : ""}${c.score} oy`)),
      el("p", { class: "body" }, `“${c.body}”`),
      el("div", { class: "sub" }, `${c.nick} · ${timeAgo(c.createdAt)} · `, el("a", { href: `/p/${c.postId}`, target: "_blank" }, c.postQuestion || "fotoğrafa git"))),
    el("div", { class: "actions-col" }, ...btns));
}

function actionBtn(label, type, id, action, cls) {
  return el("button", { class: `btn ${cls}`, onclick: () => act(type, id, action) }, label);
}

// Two-step delete: "Sil" swaps the action buttons for a small "Silinsin mi?" confirm row.
function deleteBtn(type, id) {
  const b = el("button", { class: "btn btn-danger" }, "Sil");
  b.addEventListener("click", () => {
    const box = b.closest(".tile-actions, .actions-col");
    const original = [...box.childNodes];
    const restore = () => { clearTimeout(timer); box.classList.remove("confirming"); box.replaceChildren(...original); };
    box.classList.add("confirming");
    box.replaceChildren(
      el("span", { class: "confirm-q" }, "Silinsin mi?"),
      el("div", { class: "confirm-btns" },
        el("button", { class: "btn btn-ghost", onclick: restore }, "Vazgeç"),
        el("button", { class: "btn btn-danger armed", onclick: () => { clearTimeout(timer); act(type, id, "delete"); } }, "Evet, sil")));
    const timer = setTimeout(restore, 6000);
  });
  return b;
}

async function act(type, id, action) {
  const r = await call("POST", { type, id, action });
  toast(r.ok ? ({ approve: "Onaylandı", hide: "Gizlendi", delete: "Silindi" })[action] : r.message || "Hata");
  load();
}

// Hidden/pending photos need the admin header, so load images as blobs.
function thumb(id, cls) {
  const img = el("img", { alt: "", class: cls || "", loading: "lazy" });
  const set = (url) => { img.src = url; img.onclick = () => openLightbox(url); };
  if (blobCache.has(id)) set(blobCache.get(id));
  else fetch(`/i/${id}.jpg`, { headers: { authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => { if (b) { const u = URL.createObjectURL(b); blobCache.set(id, u); set(u); } });
  return img;
}

function openLightbox(url) { const lb = $("#lightbox"); lb.querySelector("img").src = url; lb.hidden = false; }
$("#lightbox").addEventListener("click", () => { $("#lightbox").hidden = true; });

function showTab(name) {
  tab = name;
  document.querySelectorAll(".admin-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  ["queue", "live", "comments"].forEach((n) => { $("#tab-" + n).hidden = n !== name; });
}
$("#tabs").addEventListener("click", (e) => { const t = e.target.closest(".admin-tab"); if (t) showTab(t.dataset.tab); });

$("#login").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $("#token").value.trim();
  try { sessionStorage.setItem("yk_admin", token); } catch {}
  load();
});
$("#logout").addEventListener("click", () => { token = ""; try { sessionStorage.removeItem("yk_admin"); } catch {} load(); });
$("#refresh").addEventListener("click", () => { load(); toast("Yenilendi"); });

load();
