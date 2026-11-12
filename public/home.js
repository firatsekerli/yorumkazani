import { $, api, getNick, setNick, turnstile, prepareImage } from "/common.js";

let photo = null;
const ts = turnstile("#uploadTs");
$("#nick").value = getNick();

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
