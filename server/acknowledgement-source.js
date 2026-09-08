import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';

// This module records provenance only. It has no messaging API or token access.
export function normalizeAcknowledgementPhone(value) {
  if (typeof value !== 'string' || !value.trim() || /[^\d+().\s-]/.test(value)) return null;
  const text = value.trim();
  if ((text.match(/\+/g) || []).length > 1 || (text.includes('+') && !text.startsWith('+'))) return null;
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+') && (digits.length !== 11 || !digits.startsWith('1'))) return null;
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

export async function sourceHash(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalJobberId(value, type) {
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded = atob(value), canonical = btoa(decoded);
    if (canonical.replace(/=+$/, '') !== value.replace(/=+$/, '')
      || !new RegExp(`^gid://Jobber/${type}/[1-9][0-9]*$`).test(decoded)) return null;
    return canonical;
  } catch { return null; }
}

export async function readWebsiteAcknowledgementSource(env, accountId, requestId) {
  if (!env.ANGI_ROUTER_DB?.prepare) throw new Error('acknowledgement_database_unavailable');
  return env.ANGI_ROUTER_DB.prepare(`SELECT account_id, request_id, market_key, client_id,
    source_kind, source_lead_id, source_created_at, phone_sha256, recorded_at
    FROM acknowledgement_sources WHERE account_id = ? AND request_id = ?`)
    .bind(accountId, requestId).first();
}

export async function recordWebsiteAcknowledgementSource(env, lead, jobber, now = Date.now) {
  if (env.ACKNOWLEDGEMENT_SOURCE_ENABLED !== 'true') return { ok: true, recorded: false, reason: 'disabled' };
  const route = getJobberOAuthRoute(lead?.market_key, 'website');
  const requestId = canonicalJobberId(jobber?.request_id, 'Request');
  const clientId = canonicalJobberId(jobber?.client_id, 'Client');
  const sourceTime = Date.parse(lead?.submitted_at);
  if (!route || route.marketKey !== lead.market_key || jobber?.market_key !== lead.market_key
    || !requestId || !clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lead?.submission_id || '')
    || !Number.isFinite(sourceTime) || sourceTime > now() + 300_000) {
    throw new Error('acknowledgement_receipt_invalid');
  }
  if (!env.ANGI_ROUTER_DB?.prepare) throw new Error('acknowledgement_database_unavailable');
  const phone = normalizeAcknowledgementPhone(lead.phone);
  const row = {
    account_id: route.expectedAccountId, request_id: requestId, market_key: route.marketKey,
    client_id: clientId, source_kind: 'website', source_lead_id: `website:${lead.submission_id.toLowerCase()}`,
    source_created_at: new Date(sourceTime).toISOString(), phone_sha256: phone ? await sourceHash(phone) : null,
    recorded_at: new Date(now()).toISOString(),
  };
  const result = await env.ANGI_ROUTER_DB.prepare(`INSERT OR IGNORE INTO acknowledgement_sources
    (account_id, request_id, market_key, client_id, source_kind, source_lead_id, source_created_at, phone_sha256, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...Object.values(row)).run();
  if (result?.success === false) throw new Error('acknowledgement_receipt_write_failed');
  const stored = await readWebsiteAcknowledgementSource(env, row.account_id, row.request_id);
  // OR IGNORE permits a harmless repeat, but never hides a conflicting identity.
  if (!stored || Object.keys(row).some(key => key !== 'recorded_at' && stored[key] !== row[key])) {
    throw new Error('acknowledgement_receipt_conflict');
  }
  return { ok: true, recorded: true };
}

export const ACKNOWLEDGEMENT_RECEIPT_WAIT_MS = 2000;

export async function recordWebsiteAcknowledgementSourceSafely(env, lead, jobber, logger = console, waitUntil) {
  let expired = false;
  let timer;
  const report = (reason) => {
    // Never let logging or raw provider/customer details affect an accepted lead.
    try { logger.error('Website acknowledgement proof unavailable; eligibility still requires verified proof.', { reason }); } catch {}
  };
  const failure = (reason) => ({ ok: false, recorded: false, reason });
  const operation = Promise.resolve()
    .then(() => recordWebsiteAcknowledgementSource(env, lead, jobber))
    .catch(() => {
      report(expired ? 'acknowledgement_receipt_late_failure' : 'acknowledgement_receipt_unavailable');
      return failure('acknowledgement_receipt_unavailable');
    });
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      report('acknowledgement_receipt_timeout');
      // The timer does not cancel D1. Retain and observe the original operation,
      // without retrying or promising completion beyond the runtime lifetime.
      try {
        if (typeof waitUntil === 'function') waitUntil(operation);
        else report('acknowledgement_receipt_lifetime_unavailable');
      } catch { report('acknowledgement_receipt_lifetime_unavailable'); }
      resolve(failure('acknowledgement_receipt_timeout'));
    }, ACKNOWLEDGEMENT_RECEIPT_WAIT_MS);
  });
  try { return await Promise.race([operation, deadline]); }
  finally { clearTimeout(timer); }
}
