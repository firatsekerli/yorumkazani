// Yorum Kazanı front end: pick photo -> resize -> throw -> show comments -> story card.

const COLORS = { nermin: "#e2653c", recep: "#e8a93a", sukran: "#a45bb5", kaan: "#3b7dd8", sozluk: "#4c4c4c" };
const INITIALS = { nermin: "N", recep: "R", sukran: "Ş", kaan: "K", sozluk: "S" };
const BOIL_LINES = [
  "Kazan kaynıyor...",
  "Nermin Teyze gözlüğünü takıyor...",
  "Recep Abi taksiyi kenara çekti...",
  "Şükran Hanım dudak büküyor...",
  "Kaan toplantıdan çıktı...",
  "Sözlük yazarı entry yazıyor...",
];

const $ = (id) => document.getElementById(id);
const state = { image: null, mediaType: "image/jpeg", previewUrl: null, category: "kombin", token: null, widget: null, last: null };

// ---------- photo ----------

$("file").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  hideError();
  try {
    const { base64, url } = await resize(f, 1024);
    state.image = base64;
    state.mediaType = "image/jpeg";
    state.previewUrl = url;
    $("preview").src = url;
    $("preview").hidden = false;
    $("dropEmpty").hidden = true;
    updateButton();
  } catch {
    showError("Bu fotoğrafı açamadık. Başka bir tane dener misin?");
  }
});

function resize(file, maxEdge) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(src);
      const url = c.toDataURL("image/jpeg", 0.85);
      resolve({ base64: url.split(",")[1], url });
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("load")); };
    img.src = src;
  });
}

// ---------- category ----------

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  state.category = b.dataset.cat;
});

// ---------- turnstile ----------

function renderTurnstile() {
  if (!window.turnstile) return setTimeout(renderTurnstile, 200);
  const sitekey = document.querySelector('meta[name="turnstile-sitekey"]').content;
  state.widget = window.turnstile.render("#turnstile", {
    sitekey,
    appearance: "interaction-only",
    callback: (t) => { state.token = t; updateButton(); },
    "expired-callback": () => { state.token = null; updateButton(); },
    "error-callback": () => { state.token = null; updateButton(); },
  });
}
renderTurnstile();

function resetTurnstile() {
  state.token = null;
  if (window.turnstile && state.widget !== null) window.turnstile.reset(state.widget);
  updateButton();
}

function updateButton() {
  $("throwBtn").disabled = !(state.image && state.token);
}

// ---------- throw ----------

$("throwBtn").addEventListener("click", throwIt);

async function throwIt() {
  hideError();
  $("step-upload").hidden = true;
  $("result").hidden = true;
  $("boiling").hidden = false;
  let i = 0;
  const ticker = setInterval(() => { $("boilText").textContent = BOIL_LINES[++i % BOIL_LINES.length]; }, 1400);

  try {
    const res = await fetch("/api/throw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: state.image, mediaType: state.mediaType, category: state.category, token: state.token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      $("step-upload").hidden = false;
      showError(data.message || "Bir şeyler ters gitti, tekrar dene.");
      return;
    }
    state.last = data;
    showResult(data);
  } catch {
    $("step-upload").hidden = false;
    showError("Bağlantı koptu, tekrar dene.");
  } finally {
    clearInterval(ticker);
    $("boiling").hidden = true;
    resetTurnstile();
  }
}

function showResult(data) {
  $("resultTitle").textContent = data.title || "Kazandan çıkanlar";
  const ul = $("comments");
  ul.innerHTML = "";
  data.comments.forEach((c, idx) => {
    const li = document.createElement("li");
    li.className = "comment";
    li.style.animationDelay = `${idx * 0.25}s`;
    const av = document.createElement("div");
    av.className = "avatar";
    av.style.background = COLORS[c.id] || "#555";
    av.textContent = INITIALS[c.id] || "?";
    const b = document.createElement("div");
    b.className = "bubble";
    const name = document.createElement("b");
    name.textContent = c.name;
    const role = document.createElement("small");
    role.textContent = c.role;
    const p = document.createElement("p");
    p.textContent = c.text;
    b.append(name, role, p);
    li.append(av, b);
    ul.append(li);
  });
  $("remaining").textContent =
    data.remaining > 0 ? `Bugün ${data.remaining} ücretsiz atışın kaldı.` : "Bugünlük ücretsiz atışların bitti. Yarın yine gel!";
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("againBtn").addEventListener("click", () => {
  $("result").hidden = true;
  $("step-upload").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- story card (1080x1920, drawn in the browser) ----------

$("shareBtn").addEventListener("click", async () => {
  if (!state.last) return;
  const blob = await drawCard(state.last, state.previewUrl);
  const file = new File([blob], "yorumkazani.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Yorum Kazanı", text: "Kazana attım, bak ne dediler 😂 yorumkazani.com" }); return; }
    catch (err) { if (err && err.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "yorumkazani.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

async function drawCard(data, photoUrl) {
  // Canvas only uses a web font once that exact weight is loaded.
  await Promise.all(["900 64px Nunito, Arial, sans-serif", "800 30px Nunito, Arial, sans-serif", "600 36px Nunito, Arial, sans-serif"].map((f) => document.fonts.load(f, "ŞğıüöçİKazan"))).catch(() => {});
  const W = 1080, H = 1920, P = 70;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // Lay out the bubbles first, then give the photo whatever height is left.
  const textW = W - P * 2 - 130;
  ctx.font = "600 36px Nunito, Arial, sans-serif";
  const blocks = data.comments.map((cm) => {
    const lines = wrap(ctx, cm.text, textW - 40);
    const shown = lines.slice(0, 4);
    if (lines.length > 4) shown[3] = shown[3].replace(/\s*\S*$/, "…");
    return { cm, shown, bh: 70 + shown.length * 46 };
  });
  const bubblesH = blocks.reduce((s, b) => s + b.bh + 24, 0);
  const photoMaxH = Math.max(0, Math.min(560, H - 270 - 40 - bubblesH - 150));

  const g = ctx.createRadialGradient(W / 2, 0, 100, W / 2, 0, H);
  g.addColorStop(0, "#3d2a1d"); g.addColorStop(0.7, "#2b1d14");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#fff7ea";
  ctx.textAlign = "center";
  ctx.font = "900 64px Nunito, Arial, sans-serif";
  ctx.fillText("Kazana attım,", W / 2, 140);
  ctx.fillStyle = "#7bd389";
  ctx.fillText("bakın ne dediler", W / 2, 215);

  let y = 270;
  if (photoUrl && photoMaxH >= 200) {
    const img = await loadImg(photoUrl);
    const maxW = W - P * 2, maxH = photoMaxH;
    const s = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * s, h = img.height * s, x = (W - w) / 2;
    ctx.save();
    roundRect(ctx, x, y, w, h, 32); ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
    y += h + 40;
  }

  ctx.textAlign = "left";
  for (const { cm, shown, bh } of blocks) {
    if (y + bh > H - 140) break;

    ctx.fillStyle = COLORS[cm.id] || "#555";
    ctx.beginPath(); ctx.arc(P + 45, y + 45, 45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "900 40px Nunito, Arial, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(INITIALS[cm.id] || "?", P + 45, y + 59);

    ctx.textAlign = "left";
    ctx.fillStyle = "#fff7ea";
    roundRect(ctx, P + 110, y, textW + 20, bh, 28); ctx.fill();
    ctx.fillStyle = "#2b1d14"; ctx.font = "800 30px Nunito, Arial, sans-serif";
    ctx.fillText(cm.name, P + 135, y + 45);
    ctx.font = "600 36px Nunito, Arial, sans-serif";
    shown.forEach((ln, i) => ctx.fillText(ln, P + 135, y + 95 + i * 46));
    y += bh + 24;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#7bd389"; ctx.font = "900 52px Nunito, Arial, sans-serif";
  ctx.fillText("yorumkazani.com", W / 2, H - 70);

  return new Promise((r) => c.toBlob(r, "image/png"));
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// ---------- errors ----------

function showError(msg) { $("error").textContent = msg; $("error").hidden = false; }
function hideError() { $("error").hidden = true; }
