// Shared front-end helpers.

export const $ = (sel, root = document) => root.querySelector(sel);

export async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const data = await res.json().catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı." }));
  if (!res.ok && data.ok !== false) data.ok = false;
  return data;
}

export function postJSON(path, body) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

// ---------- nickname ----------
// Nicknames are no longer remembered: the fields start empty with a placeholder.
// setNick() also clears any nickname saved by older versions of the site.
export function getNick() { return ""; }
export function setNick() {
  try { localStorage.removeItem("yk_nick"); } catch {}
}

// ---------- Turnstile ----------
// Each form gets its own invisible-unless-needed widget. getToken() waits for a token.
export function turnstile(container) {
  let token = null, id = null, waiters = [];
  const sitekey = document.querySelector('meta[name="turnstile-sitekey"]').content;
  const render = () => {
    if (!window.turnstile) return setTimeout(render, 200);
    id = window.turnstile.render(container, {
      sitekey,
      appearance: "interaction-only",
      callback: (t) => { token = t; waiters.forEach((w) => w(t)); waiters = []; },
      "expired-callback": () => { token = null; },
    });
  };
  render();
  return {
    getToken() {
      if (token) return Promise.resolve(token);
      return new Promise((r) => { waiters.push(r); setTimeout(() => r(null), 15000); });
    },
    reset() { token = null; if (window.turnstile && id !== null) window.turnstile.reset(id); },
  };
}

// ---------- photo: resize, re-encode (drops EXIF/GPS) ----------
export function prepareImage(file, maxEdge = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(src);
      c.toBlob((blob) => blob ? resolve({ blob, width: w, height: h, url: URL.createObjectURL(blob) }) : reject(new Error("encode")), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("load")); };
    img.src = src;
  });
}

// ---------- misc ----------
export function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "az önce";
  const m = Math.round(s / 60); if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60); if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24); if (d < 30) return `${d} gün önce`;
  return new Date(ms).toLocaleDateString("tr-TR");
}

let toastTimer;
export function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
