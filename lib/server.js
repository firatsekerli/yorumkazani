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
Look carefully at the whole image, including small text, backgrounds and screens.

Answer "reject" if any of these is clearly true:
- a child or someone who looks under 18 is a main subject or clearly recognisable
- nudity, underwear, lingerie or sexual content
- violence, blood, real weapons, self-harm, drugs
- an ID card, passport, credit card, bank or payment screen
- a readable licence plate, phone number, home address, e-mail or social media handle
- a screenshot (chat, social media, e-mail) that shows another person's name, profile photo or number
- hate symbols, slurs, political propaganda, or mockery of a religion or ethnic group
- the image is blank, unreadable, or clearly spam / advertising
- the photo mainly mocks a specific person's body, looks or disability

Answer "unsure" (a human will review it) if you cannot tell, for example:
- age is hard to judge, or a small or blurry plate / number / name might be readable
- swimwear or a very revealing outfit, a toy that might be a real weapon
- text or symbols you cannot fully read or understand, including Turkish slang

Answer "allow" for ordinary everyday photos of adults, outfits, homes, rooms, food, pets, objects, signs and situations.

Reply with JSON only: {"verdict": "allow" | "reject" | "unsure", "reason_tr": "short polite Turkish sentence for the user if not allowed", "why": "few English words"}`;

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
    if (verdict.verdict === "allow") return { decision: "live", why: verdict.why };
    if (verdict.verdict === "unsure") return { decision: "pending", why: verdict.why };
    return { decision: "reject", reason: verdict.reason || "Bu fotoğraf kurallarımıza uymuyor.", why: verdict.why };
  } catch (e) {
    console.error("moderation_error", e && e.message);
    return { decision: "pending" }; // on any error, a human decides
  }
}

// Reads {"verdict": ..., "reason_tr": ...} even if the model wraps it in text or code fences.
// Also accepts the older {"allow": true|false} shape.
export function parseVerdict(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try {
      const o = JSON.parse(text.slice(s, e + 1));
      const reason = o.reason_tr ? String(o.reason_tr) : "";
      const why = o.why ? String(o.why).slice(0, 120) : "";
      const v = String(o.verdict || "").toLowerCase();
      if (["allow", "reject", "unsure"].includes(v)) return { verdict: v, reason, why };
      if (typeof o.allow === "boolean") return { verdict: o.allow ? "allow" : "reject", reason, why };
    } catch {}
  }
  const m = /"?verdict"?\s*[:=]\s*"?(allow|reject|unsure)/i.exec(text);
  if (m) return { verdict: m[1].toLowerCase(), reason: "", why: "" };
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

// Live posts for the feed, newest first (or most active), each with its top comment.
export async function listPosts(env, { sort = "new", before = Date.now() + 1, limit = 12 } = {}) {
  const col = sort === "hot" ? "last_activity" : "created_at";
  const { results } = await env.DB.prepare(
    `SELECT * FROM posts WHERE status = 'live' AND ${col} < ? ORDER BY ${col} DESC LIMIT ?`
  ).bind(before, limit).all();

  const ids = results.map((p) => p.id);
  const tops = {};
  if (ids.length) {
    const marks = ids.map(() => "?").join(",");
    const { results: cs } = await env.DB.prepare(
      `SELECT post_id, nick, body, score FROM comments c
       WHERE status = 'live' AND post_id IN (${marks})
         AND id = (SELECT id FROM comments c2 WHERE c2.post_id = c.post_id AND c2.status = 'live'
                   ORDER BY score DESC, created_at ASC LIMIT 1)`
    ).bind(...ids).all();
    for (const c of cs) tops[c.post_id] = { nick: c.nick, body: c.body, score: c.score };
  }

  const posts = results.map((p) => ({ ...publicPost(p), top: tops[p.id] || null }));
  const next = results.length === limit ? results[results.length - 1][col] : null;
  return { posts, next };
}

// Removes a post, its photo and everything attached to it.
export async function deletePost(env, id) {
  const p = await env.DB.prepare("SELECT image_key FROM posts WHERE id=?").bind(id).first();
  if (p) await env.IMAGES.delete(p.image_key);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM votes WHERE comment_id IN (SELECT id FROM comments WHERE post_id=?)").bind(id),
    env.DB.prepare("DELETE FROM reports WHERE target_type='comment' AND target_id IN (SELECT id FROM comments WHERE post_id=?)").bind(id),
    env.DB.prepare("DELETE FROM comments WHERE post_id=?").bind(id),
    env.DB.prepare("DELETE FROM reports WHERE target_type='post' AND target_id=?").bind(id),
    env.DB.prepare("DELETE FROM posts WHERE id=?").bind(id),
  ]);
}

// Photos that were hidden or never approved are deleted after 30 days
// (last_activity is set to the moment a post is hidden). The rules page promises this.
export const STALE_DAYS = 30;
export async function purgeStale(env) {
  const cutoff = Date.now() - STALE_DAYS * 86400 * 1000;
  const { results } = await env.DB.prepare(
    "SELECT id FROM posts WHERE status IN ('hidden','pending') AND last_activity < ? LIMIT 20"
  ).bind(cutoff).all();
  for (const r of results) await deletePost(env, r.id);
  return results.length;
}
