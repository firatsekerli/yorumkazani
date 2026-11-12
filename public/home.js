import { $, api, el, getNick, setNick, turnstile, prepareImage, timeAgo } from "/common.js";

// ---------- feed ----------
const feed = $("#feed");
let sort = "new", next = null, loading = false;

async function load(reset) {
  if (loading) return;
  loading = true;
  if (reset) { feed.innerHTML = ""; next = null; }
  const q = new URLSearchParams({ sort });
  if (next) q.set("before", next);
  const data = await api(`/api/posts?${q}`);
  loading = false;
  if (!data.ok) return;
  data.posts.forEach((p) => feed.append(card(p)));
  next = data.next;
  $("#more").hidden = !next;
  $("#empty").hidden = feed.children.length > 0;
}

function card(p) {
  return el("a", { class: "card", href: `/p/${p.id}` },
    el("img", { src: p.image, alt: p.question || `${p.nick} kazana attı`, loading: "lazy", width: p.width || null, height: p.height || null }),
    el("div", { class: "card-body" },
      p.question ? el("p", { class: "card-q" }, p.question) : null,
      el("div", { class: "meta" },
        el("span", { class: "pill" }, p.categoryLabel),
        el("span", {}, p.nick),
        el("span", {}, "·"),
        el("span", {}, timeAgo(p.createdAt)),
        el("span", {}, "·"),
        el("span", {}, `${p.commentCount} yorum`)),
      p.top ? el("div", { class: "top-comment" },
        p.top.score > 0 ? el("span", { class: "crown" }, "👑 Şimdilik kazanan") : null,
        el("b", {}, p.top.nick + ": "), p.top.body) : null));
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-pressed", String(x === t)));
  sort = t.dataset.sort;
  load(true);
}));
$("#more").addEventListener("click", () => load(false));
load(true);

// ---------- upload ----------
const sheet = $("#sheet");
let ts = null, photo = null, category = "kombin";

function openSheet() {
  sheet.hidden = false;
  document.body.style.overflow = "hidden";
  $("#nick").value = getNick();
  if (!ts) ts = turnstile("#uploadTs");
}
function closeSheet() { sheet.hidden = true; document.body.style.overflow = ""; }

document.querySelectorAll("[data-open-upload]").forEach((b) => b.addEventListener("click", openSheet));
$("#sheetClose").addEventListener("click", closeSheet);
sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
if (new URLSearchParams(location.search).has("yukle")) openSheet();

$("#file").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  $("#uploadError").hidden = true;
  try {
    photo = await prepareImage(f);
    $("#preview").src = photo.url;
    $("#preview").hidden = false;
    $("#dropEmpty").hidden = true;
    $("#uploadBtn").disabled = false;
  } catch {
    showErr("Bu fotoğrafı açamadık. Başka bir tane dener misin?");
  }
});

$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  document.querySelectorAll("#chips .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  category = b.dataset.cat;
});

$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!photo) return;
  const btn = $("#uploadBtn");
  btn.disabled = true; btn.textContent = "Kazan kaynıyor...";
  $("#uploadError").hidden = true;

  const token = await ts.getToken();
  const nick = $("#nick").value.trim();
  setNick(nick);
  const fd = new FormData();
  fd.append("image", photo.blob, "photo.jpg");
  fd.append("width", photo.width);
  fd.append("height", photo.height);
  fd.append("category", category);
  fd.append("question", $("#question").value.trim());
  fd.append("nick", nick);
  fd.append("token", token || "");

  const data = await api("/api/posts", { method: "POST", body: fd });
  ts.reset();
  if (data.ok) {
    location.href = `/p/${data.id}${data.status === "pending" ? "?bekliyor=1" : "?yeni=1"}`;
    return;
  }
  btn.disabled = false; btn.textContent = "Kazana at!";
  showErr(data.message || "Bir şeyler ters gitti, tekrar dene.");
});

function showErr(msg) { const e = $("#uploadError"); e.textContent = msg; e.hidden = false; }
