// TEMPORARY: runs the photo safety check on an image without saving anything,
// so the moderation prompt can be tested on the live setup. Expires on its own
// and allows at most 30 checks in total. Remove after testing.

import { json, fail, checkPhoto, toBase64, istanbulDay } from "../../lib/server.js";

const EXPIRES = Date.parse("2026-11-13T00:30:00Z");
const MAX = 30;

export async function onRequestPost({ request, env }) {
  if (Date.now() > EXPIRES) return fail("Bulunamadı.", 404, "not_found");
  const day = istanbulDay();
  const row = await env.DB.prepare("SELECT count FROM rate WHERE bucket = 'modtest' AND day = ?").bind(day).first();
  if (row && row.count >= MAX) return fail("Limit.", 429, "limit");
  await env.DB.prepare("INSERT INTO rate (bucket, day, count) VALUES ('modtest', ?, 1) ON CONFLICT(bucket, day) DO UPDATE SET count = count + 1").bind(day).run();

  const buf = await request.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 3));
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff || buf.byteLength > 1_600_000) return fail("JPEG değil.");
  const r = await checkPhoto(env, toBase64(buf));
  return json({ ok: true, model: env.CLAUDE_MODEL, ...r });
}
