import { createGoogleUploader } from "../server/google-ads-outcome-watcher.js";

// Hourly drain entry point. It is deliberately opt-in: production can deploy
// this worker and keep GOOGLE_ADS_UPLOAD_ENABLED=false until review approves it.
export async function drainGoogleAdsOutbox({ database, uploader, now = new Date().toISOString(), limit = 50, maxAttempts = 5 } = {}) {
  if (!database?.prepare || !uploader?.upload) return { ok: false, reason: "uploader_unavailable", processed: 0 };
  const rows = (await database.prepare(`SELECT * FROM google_ads_outcome_outbox WHERE upload_state = 'pending' AND attempt_count < ? ORDER BY created_at ASC LIMIT ?`).bind(maxAttempts, limit).all())?.results || [];
  const results = [];
  for (const row of rows) {
    const outcome = await uploader.upload(row);
    const nextAttempt = Number(row.attempt_count || 0) + (outcome.status === "retryable" ? 1 : 0);
    const state = outcome.status === "submitted" ? "submitted" : outcome.status === "retryable" && nextAttempt < maxAttempts ? "retryable" : outcome.status;
    await database.prepare(`UPDATE google_ads_outcome_outbox SET upload_state = ?, attempt_count = ?, diagnostic_code = ?, updated_at = ? WHERE outcome_id = ?`).bind(state, nextAttempt, outcome.diagnostic_code || null, now, row.outcome_id).run();
    results.push({ outcome_id: row.outcome_id, status: state, diagnostic_code: outcome.diagnostic_code || null });
  }
  return { ok: true, processed: results.length, results };
}

export function createDisabledGoogleAdsDrain(env = {}) {
  const enabled = String(env.GOOGLE_ADS_UPLOAD_ENABLED || "false").toLowerCase() === "true";
  const uploader = createGoogleUploader({ enabled, transport: null });
  return (args = {}) => drainGoogleAdsOutbox({ ...args, uploader });
}

export default { async scheduled(_event, env) { return createDisabledGoogleAdsDrain(env)({ database: env.ANGI_ROUTER_DB }); } };
