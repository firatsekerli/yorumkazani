// POST /api/report  { type: "post"|"comment", id, reason }
// After LIMITS.hideAfterReports different people report something, it is hidden until reviewed on /admin.

import { LIMITS, json, fail, visitor, withCookie, takeRate, clean } from "../../lib/server.js";

export async function onRequestPost({ request, env }) {
  const v = await visitor(request, env);
  const done = (res) => withCookie(res, v);

  let data;
  try { data = await request.json(); } catch { return done(fail("İstek okunamadı.")); }
  const type = data.type === "post" ? "post" : data.type === "comment" ? "comment" : null;
  if (!type || typeof data.id !== "string") return done(fail("Geçersiz bildirim."));
  const table = type === "post" ? "posts" : "comments";

  const row = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(data.id).first();
  if (!row) return done(fail("Bulunamadı.", 404, "not_found"));
  if (!(await takeRate(env, "report", v, LIMITS.reportsPerDay))) return done(fail("Bugün çok fazla bildirim yaptın.", 429, "limit"));

  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO reports (target_type, target_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(type, row.id, v.hash, clean(data.reason, 60), Date.now()).run();

  if (ins.meta && ins.meta.changes) {
    await env.DB.prepare(
      `UPDATE ${table} SET report_count = report_count + 1,
         status = CASE WHEN report_count + 1 >= ? AND status = 'live' THEN 'hidden' ELSE status END
       WHERE id = ?`
    ).bind(LIMITS.hideAfterReports, row.id).run();
  }
  return done(json({ ok: true }));
}
