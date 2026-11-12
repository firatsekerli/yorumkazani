import { $, el, timeAgo, toast } from "/common.js";

let token = "";
try { token = sessionStorage.getItem("yk_admin") || ""; } catch {}

const call = (method, body) =>
  fetch("/api/admin", {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

async function load() {
  const data = await call("GET");
  if (!data.ok) {
    $("#login").hidden = false; $("#panel").hidden = true;
    if (token) { $("#loginError").textContent = "Anahtar yanlış."; $("#loginError").hidden = false; }
    return;
  }
  $("#login").hidden = true; $("#panel").hidden = false;
  const s = data.stats;
  $("#stats").replaceChildren(
    stat("Yayındaki fotoğraf", s.live_posts), stat("Yayındaki yorum", s.live_comments),
    stat("Son 24 saat fotoğraf", s.posts_24h), stat("Son 24 saat yorum", s.comments_24h));

  $("#posts").replaceChildren(...(data.posts.length ? data.posts.map(postItem) : [el("p", { class: "hint" }, "İncelenecek fotoğraf yok.")]));
  $("#comments").replaceChildren(...(data.comments.length ? data.comments.map(commentItem) : [el("p", { class: "hint" }, "İncelenecek yorum yok.")]));
}

const stat = (label, n) => el("div", { class: "stat" }, el("b", {}, String(n)), label);
const LABEL = { pending: "Onay bekliyor", hidden: "Gizlendi (bildirim)", live: "Yayında" };

function postItem(p) {
  return el("div", { class: "admin-item" },
    adminImg(p.id),
    el("div", {},
      el("div", { class: "meta" }, el("span", { class: "pill" }, LABEL[p.status] || p.status), el("span", {}, `${p.reportCount} bildirim`), el("span", {}, timeAgo(p.createdAt))),
      el("p", { style: "margin:6px 0 0;font-weight:800" }, p.question || "(soru yok)"),
      el("div", { class: "meta" }, p.nick, " · ", el("a", { href: `/p/${p.id}`, target: "_blank" }, "sayfayı aç")),
      actions("post", p.id)));
}

// Images of hidden/pending posts need the admin header, so load them as blobs.
function adminImg(id) {
  const img = el("img", { alt: "" });
  fetch(`/i/${id}.jpg`, { headers: { authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => { if (b) { img.src = URL.createObjectURL(b); img.style.cursor = "zoom-in"; img.onclick = () => window.open(img.src); } });
  return img;
}

function commentItem(c) {
  return el("div", { class: "admin-item c" },
    el("div", {},
      el("div", { class: "meta" }, el("span", { class: "pill" }, LABEL[c.status] || c.status), el("span", {}, `${c.reportCount} bildirim`), el("span", {}, timeAgo(c.createdAt))),
      el("p", { style: "margin:6px 0 0;font-weight:800" }, `${c.nick}: ${c.body}`),
      el("div", { class: "meta" }, "Fotoğraf: ", el("a", { href: `/p/${c.postId}`, target: "_blank" }, c.postQuestion || c.postId)),
      actions("comment", c.id)));
}

function actions(type, id) {
  const btn = (label, action, cls) => el("button", { class: `btn ${cls}`, onclick: async () => {
    if (action === "delete" && !confirmDelete()) return;
    const r = await call("POST", { type, id, action });
    toast(r.ok ? "Tamam" : r.message || "Hata"); load();
  } }, label);
  return el("div", { class: "row" }, btn("Onayla", "approve", "btn-red"), btn("Gizle", "hide", "btn-ghost"), btn("Sil", "delete", "btn-ghost"));
}

// Simple two-click confirm without a browser dialog.
let armed = 0;
function confirmDelete() {
  if (Date.now() - armed < 3000) { armed = 0; return true; }
  armed = Date.now(); toast("Silmek için tekrar bas"); return false;
}

$("#login").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $("#token").value.trim();
  try { sessionStorage.setItem("yk_admin", token); } catch {}
  load();
});
$("#logout").addEventListener("click", () => { token = ""; try { sessionStorage.removeItem("yk_admin"); } catch {} load(); });

load();
