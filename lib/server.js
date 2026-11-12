// Shared helpers for the Pages Functions.

export const CATEGORIES = {
  kombin: "Kombin",
  ev: "Ev",
  yemek: "Yemek",
  mesaj: "Mesaj",
  tabela: "Tabela",
  dugun: "Düğün",
  diger: "Diğer",
};

export const LIMITS = {
  postsPerDay: 5,
  commentsPerDay: 80,
  votesPerDay: 500,
  reportsPerDay: 30,
  hideAfterReports: 3,
  maxImageBytes: 1_600_000,
  nickMax: 24,
  questionMax: 120,
  commentMax: 280,
};

// ---------- responses ----------

export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

export function fail(message, status = 400, code = "error") {
  return json({ ok: false, error: code, message }, status);
}

// ---------- anonymous visitor ----------

const COOKIE = "yk_vid";

export async function visitor(request, env) {
  const cookies = request.headers.get("cookie") || "";
  const m = cookies.match(/(?:^|;\s*)yk_vid=([a-f0-9-]{36})/);
  let vid = m ? m[1] : null;
  let setCookie = null;
  if (!vid) {
    vid = crypto.randomUUID();
    setCookie = `${COOKIE}=${vid}; Path=/; Max-Age=63072000; HttpOnly; Secure; SameSite=Lax`;
  }
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  return {
    hash: await sha256(`${env.IP_SALT || ""}:v:${vid}`),
    ipHash: await sha256(`${env.IP_SALT || ""}:ip:${ip}`),
    ip,
    setCookie,
  };
}

export function withCookie(res, v) {
  if (v.setCookie) res.headers.append("set-cookie", v.setCookie);
  return res;
}

// ---------- Turnstile ----------

export async function human(env, token, ip) {
  if (env.DEV_SKIP_TURNSTILE === "1") return true; // local development only
  if (!env.TURNSTILE_SECRET || !token) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// ---------- daily rate limits ----------

export function istanbulDay() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Returns true if allowed (and counts the action), false if over the limit.
// Checks both the visitor and the IP, so clearing cookies does not reset the limit.
export async function takeRate(env, kind, v, limit) {
  const day = istanbulDay();
  const keys = [`${kind}:v:${v.hash}`, `${kind}:ip:${v.ipHash}`];
  const ipLimit = limit * 3; // shared IPs (offices, mobile carriers) get more room
  for (const [i, k] of keys.entries()) {
    const row = await env.DB.prepare("SELECT count FROM rate WHERE bucket = ? AND day = ?").bind(k, day).first();
    if (row && row.count >= (i === 0 ? limit : ipLimit)) return false;
  }
  // Also drop counters older than 7 days (the privacy page promises this).
  const cutoff = new Date(Date.now() + 3 * 3600 * 1000 - 7 * 86400 * 1000).toISOString().slice(0, 10);
  await env.DB.batch([
    ...keys.map((k) =>
      env.DB.prepare(
        "INSERT INTO rate (bucket, day, count) VALUES (?, ?, 1) ON CONFLICT(bucket, day) DO UPDATE SET count = count + 1"
      ).bind(k, day)
    ),
    env.DB.prepare("DELETE FROM rate WHERE day < ?").bind(cutoff),
  ]);
  return true;
}

// ---------- text ----------

export function clean(str, max) {
  return String(str || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Words that block a comment, nickname or question.
// EXACT: whole word only (short words that are parts of normal words).
// PREFIX: any word starting with it.
// Extend these lists as you see real abuse.
const EXACT = new Set(["amk", "aq", "mk", "oç", "oc", "göt", "götün", "götünü", "sik", "sikim", "siki", "piç", "ibne", "gavat", "kel"]);
const PREFIX = [
  "amına", "amina", "amcık", "amcik", "orospu", "siktir", "sikik", "sikerim", "sikiş", "yarrak", "yarak", "pezevenk",
  "kahpe", "şerefsiz", "serefsiz", "puşt", "pust", "yavşak", "yavsak", "dangalak",
  // body shaming: the site jokes about things, never about bodies
  "şişko", "sisko", "şişman", "sisman", "obez", "çirkin", "cirkin", "domuz", "inek gibi",
];

export function blocked(text) {
  const t = text.toLocaleLowerCase("tr-TR");
  const words = t.split(/[^a-zçğıöşü0-9]+/i).filter(Boolean);
  if (words.some((w) => EXACT.has(w))) return true;
  if (words.some((w) => PREFIX.some((p) => !p.includes(" ") && w.startsWith(p)))) return true;
  if (PREFIX.some((p) => p.includes(" ") && t.includes(p))) return true;
  if (/(https?:\/\/|www\.|\.com\b|\.net\b|t\.me\/)/i.test(text)) return true; // no links (spam)
  return false;
}

// ---------- ids / hashing ----------

export function newId(len = 8) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- admin ----------

export function isAdmin(request, env) {
  const h = request.headers.get("authorization") || "";
  return Boolean(env.ADMIN_TOKEN) && env.ADMIN_TOKEN.length >= 16 && h === `Bearer ${env.ADMIN_TOKEN}`;
}

// ---------- photo safety check (optional) ----------
// Only runs when ANTHROPIC_API_KEY is set. It never writes comments; it only answers
// "can this photo go live?" Without a key, new photos wait for approval on /admin.

const MOD_PROMPT = `You are the safety filter for a Turkish humor site where people upload a photo and strangers comment on it.
Decide if the photo may be published. REJECT if any of these is true:
- a child or someone who looks under 18 is a main subject
- nudity, underwear or sexual content
- violence, blood, weapons pointed at people, self-harm, drugs
- an ID card, credit card, bank screen, license plate in focus, or a readable phone number or address
- a screenshot that shows another person's name, photo or phone number (private messages are fine only if names and numbers are hidden)
- hate symbols, political propaganda, or religious mockery
- the image is unreadable, blank, or clearly spam/advertising
Otherwise ALLOW. Adults in everyday photos (outfits, homes, food, signs) are allowed.
Answer only JSON: {"allow": true|false, "reason_tr": "short polite Turkish sentence for the user if rejected"}`;

export async function checkPhoto(env, base64) {
  if (!env.ANTHROPIC_API_KEY) return { decision: "pending" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || "claude-haiku-5-5",
        max_tokens: 1024,
        system: MOD_PROMPT,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } }, { type: "text", text: "Check this photo. Reply with the JSON only." }] }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const verdict = parseVerdict(text);
    if (!verdict) {
      console.error("moderation_unparsed", data.stop_reason, JSON.stringify((data.content || []).map((b) => b.type)), text.slice(0, 300));
      return { decision: "pending" };
    }
    return verdict.allow ? { decision: "live" } : { decision: "reject", reason: verdict.reason || "Bu fotoğraf kurallarımıza uymuyor." };
  } catch (e) {
    console.error("moderation_error", e && e.message);
    return { decision: "pending" }; // on any error, a human decides
  }
}

// Reads {"allow": ..., "reason_tr": ...} even if the model wraps it in text or code fences.
export function parseVerdict(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try {
      const o = JSON.parse(text.slice(s, e + 1));
      if (typeof o.allow === "boolean") return { allow: o.allow, reason: o.reason_tr ? String(o.reason_tr) : "" };
    } catch {}
  }
  const m = /"?allow"?\s*[:=]\s*(true|false)/i.exec(text);
  if (m) return { allow: m[1].toLowerCase() === "true", reason: "" };
  return null;
}

export function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function publicPost(p) {
  return {
    id: p.id,
    createdAt: p.created_at,
    nick: p.nick,
    category: p.category,
    categoryLabel: CATEGORIES[p.category] || "Diğer",
    question: p.question,
    image: `/i/${p.id}.jpg`,
    width: p.width,
    height: p.height,
    commentCount: p.comment_count,
    status: p.status,
  };
}
