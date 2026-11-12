// POST /api/throw  ->  "Kazana at"
// Receives a resized photo, checks Turnstile and the daily free limit,
// asks Claude for five character comments, returns JSON.
// The photo is never stored: it lives only in this request.

import { SYSTEM_PROMPT, CATEGORIES, CHARACTERS } from "../../lib/prompt.js";

const MODEL = "claude-haiku-5-5";
const DEFAULT_FREE_PER_DAY = 3;
const MAX_BASE64_CHARS = 2_800_000; // ~2 MB image; the browser resizes to 1024px first
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", message: "İstek okunamadı." }, 400);
  }

  const { image, mediaType, category, token } = body || {};
  if (typeof image !== "string" || !image || image.length > MAX_BASE64_CHARS) {
    return json({ error: "bad_image", message: "Fotoğraf çok büyük ya da okunamadı." }, 400);
  }
  if (!ALLOWED_TYPES.includes(mediaType)) {
    return json({ error: "bad_image", message: "Sadece JPG, PNG veya WEBP." }, 400);
  }
  const cat = CATEGORIES[category] ? category : "diger";

  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

  // 1) Bot check
  const human = await verifyTurnstile(env, token, ip);
  if (!human) {
    return json({ error: "turnstile", message: "Robot olmadığını doğrulayamadık, sayfayı yenileyip tekrar dene." }, 403);
  }

  // 2) Daily free limit (Istanbul day, IP stored only as a salted hash)
  const limit = Number(env.FREE_PER_DAY) || DEFAULT_FREE_PER_DAY;
  const day = istanbulDay();
  const ipHash = await sha256(`${env.IP_SALT || ""}:${ip}`);
  const used = await getUsage(env, ipHash, day);
  if (used >= limit) {
    return json(
      { error: "limit", message: "Bugünlük kazan soğudu. Yarın yine gel, teyzeler bekliyor!", remaining: 0 },
      429
    );
  }

  // 3) Ask the cauldron
  let result;
  try {
    result = await askClaude(env, image, mediaType, cat);
  } catch (err) {
    console.error("claude_error", err && err.message);
    return json({ error: "ai", message: "Kazan şu an fokurdamıyor, birazdan tekrar dene." }, 502);
  }

  if (!result.uygun) {
    // Refusals do not use up a free throw.
    return json({ ok: false, message: result.neden || "Bu fotoğrafı kazana atamıyoruz.", remaining: limit - used });
  }

  await addUsage(env, ipHash, day);

  return json({
    ok: true,
    title: result.baslik || "",
    comments: result.yorumlar,
    remaining: Math.max(0, limit - used - 1),
  });
}

// ---------- Claude ----------

async function askClaude(env, image, mediaType, cat) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || MODEL,
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: `Kullanıcı bunu kazana attı. Kategori: ${CATEGORIES[cat]}. Beş karakter yorumlasın.` },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseResult(text);
}

export function parseResult(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON in reply");
  const obj = JSON.parse(text.slice(start, end + 1));

  if (obj.uygun === false) return { uygun: false, neden: String(obj.neden || "") };

  const byId = new Map((obj.yorumlar || []).map((y) => [y.id, String(y.metin || "").trim()]));
  const yorumlar = CHARACTERS.map((c) => ({ id: c.id, name: c.name, role: c.role, text: byId.get(c.id) || "" })).filter(
    (y) => y.text
  );
  if (yorumlar.length < 3) throw new Error("too few comments");
  return { uygun: true, baslik: String(obj.baslik || "").trim(), yorumlar };
}

// ---------- Turnstile ----------

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return false;
  if (!token) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

// ---------- Usage (D1) ----------

async function getUsage(env, ipHash, day) {
  const row = await env.DB.prepare("SELECT count FROM usage WHERE ip_hash = ? AND day = ?").bind(ipHash, day).first();
  return row ? Number(row.count) : 0;
}

async function addUsage(env, ipHash, day) {
  await env.DB.prepare(
    "INSERT INTO usage (ip_hash, day, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash, day) DO UPDATE SET count = count + 1"
  )
    .bind(ipHash, day)
    .run();
}

// ---------- helpers ----------

function istanbulDay() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
