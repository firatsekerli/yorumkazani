import { $, api, el, getNick, setNick, turnstile, prepareImage, timeAgo } from "/common.js";

let photo = null;
const ts = turnstile("#uploadTs");
// The nickname field starts empty; the placeholder shows "Anonim".

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
  fd.append("category", "diger");
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

// ---------- feed: latest photos, 12 at a time ----------
let next = null;
async function loadFeed() {
  const q = new URLSearchParams({ limit: "12" });
  if (next) q.set("before", next);
  const data = await api(`/api/posts?${q}`);
  if (!data.ok) return;
  data.posts.forEach((p) => $("#feed").append(card(p)));
  next = data.next;
  $("#more").hidden = !next;
  $("#son").hidden = $("#feed").children.length === 0;
}

function card(p) {
  return el("a", { class: "card", href: `/p/${p.id}` },
    el("img", { src: p.image, alt: p.question || "Kazana atılan fotoğraf", loading: "lazy", width: p.width || null, height: p.height || null }),
    el("div", { class: "card-body" },
      p.question ? el("p", { class: "card-q" }, p.question) : null,
      el("div", { class: "meta" }, el("span", {}, p.nick), el("span", {}, "·"), el("span", {}, timeAgo(p.createdAt)),
        el("span", {}, "·"), el("span", {}, `${p.commentCount} yorum`)),
      p.top ? el("div", { class: "top-comment" },
        p.top.score > 0 ? el("span", { class: "crown", title: "Kazanan yorum" }, "👑") : null,
        el("b", {}, p.top.nick + ": "), p.top.body)
        : el("div", { class: "top-comment empty-top" }, "İlk yorumu sen yaz!")));
}

$("#more").addEventListener("click", loadFeed);
// The server already rendered the first photos; only fetch here if it didn't.
if ($("#feed").dataset.ssr) next = Number($("#more").dataset.next) || null;
else loadFeed();
