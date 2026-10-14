import { canonicalJobberId, readWebsiteAcknowledgementSource, sourceHash } from './acknowledgement-source.js';
import { nativeAngiProof, quoIntakeProof, requestPhone } from './jobber-acknowledgement-resolver.js';

const MARKET = { ut: 'utah', mo_stl: 'stl', mo_kc: 'kc' };
const WEBSITE_SOURCES = new Set(['Good Attic Website Leads', 'Good Attic Google Leads']);
const PROOF_GRACE_MS = 5 * 60_000;
const WEBSITE_LEAD_ID = /^website:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UTAH_ACCOUNT_ID = btoa('gid://Jobber/Account/2498432');
const ANGI_ROUTER_KEY = /^131399442:[0-9]{5,24}$/;
const ANGI_ROUTER_REQUEST_STATES = new Set([
  'request_created', 'note_creating', 'completed', 'failed_retryable', 'needs_review',
]);

function result(state, kind, reason, retryable = false, sourceLeadId = null, sourceCreatedAt = null) {
  return { state, kind, reason, retryable, sourceLeadId, sourceCreatedAt };
}

function isRecent(createdAt, now) {
  const age = now - Date.parse(createdAt);
  return Number.isFinite(age) && age >= -30_000 && age < PROOF_GRACE_MS;
}

function websiteProof(receipt, route, record) {
  const sourceTime = Date.parse(receipt.source_created_at);
  const createdTime = Date.parse(record.createdAt);
  if (receipt.account_id !== route.expectedAccountId || receipt.market_key !== route.marketKey
    || canonicalJobberId(receipt.request_id, 'Request') !== canonicalJobberId(record.id, 'Request')
    || canonicalJobberId(receipt.client_id, 'Client') !== canonicalJobberId(record.client.id, 'Client')
    || receipt.source_kind !== 'website' || !WEBSITE_LEAD_ID.test(receipt.source_lead_id || '')
    || !(receipt.phone_sha256 === null || SHA256.test(receipt.phone_sha256 || ''))
    || !Number.isFinite(sourceTime) || !Number.isFinite(createdTime)
    || sourceTime > createdTime + 30_000 || createdTime - sourceTime > 3_600_000) {
    return result('held', null, 'website_receipt_identity_conflict');
  }
  // A later Jobber phone edit does not change who submitted the website form.
  // Customer welcome texts keep their separate exact-phone suitability check.
  return result('verified', 'website', 'website_receipt_verified', false,
    receipt.source_lead_id, new Date(sourceTime).toISOString());
}

async function utahAngiRouterProof(env, route, record) {
  if (route.marketKey !== 'ut') return null;
  if (route.expectedAccountId !== UTAH_ACCOUNT_ID) return result('held', null, 'angi_router_account_conflict');
  const response = await env.ANGI_ROUTER_DB.prepare(`SELECT idempotency_key, status, client_id,
    request_id, created_at FROM angi_utah_jobber_deliveries WHERE request_id = ? LIMIT 2`)
    .bind(canonicalJobberId(record.id, 'Request')).all();
  if (response?.success === false || !Array.isArray(response?.results)) throw new Error('angi_router_proof_unavailable');
  if (!response.results.length) return null;
  if (response.results.length !== 1) return result('held', null, 'angi_router_delivery_ambiguous');
  const row = response.results[0], sourceTime = Date.parse(row.created_at), requestTime = Date.parse(record.createdAt);
  if (!ANGI_ROUTER_KEY.test(row.idempotency_key || '') || !ANGI_ROUTER_REQUEST_STATES.has(row.status)
    || canonicalJobberId(row.request_id, 'Request') !== canonicalJobberId(record.id, 'Request')
    || canonicalJobberId(row.client_id, 'Client') !== canonicalJobberId(record.client.id, 'Client')
    || !Number.isFinite(sourceTime) || sourceTime > requestTime + 30_000
    || requestTime - sourceTime > 3_600_000) return result('held', null, 'angi_router_delivery_identity_conflict');
  return result('verified', 'angi', 'angi_router_delivery_verified', false,
    `angi-router:${await sourceHash(row.idempotency_key)}`, new Date(sourceTime).toISOString());
}

/** Source verification for internal group lead alerts; it never authorizes a customer SMS. */
export async function resolveLeadAlertSource(env, route, record, now = Date.now()) {
  if (!env.ANGI_ROUTER_DB?.prepare || !MARKET[route?.marketKey]
    || !canonicalJobberId(record?.id, 'Request') || !canonicalJobberId(record?.client?.id, 'Client')
    || !Number.isFinite(Date.parse(record?.createdAt))) throw new Error('lead_alert_source_context_invalid');

  const receipt = await readWebsiteAcknowledgementSource(env, route.expectedAccountId,
    canonicalJobberId(record.id, 'Request'));
  const router = await utahAngiRouterProof(env, route, record);
  // Quo uses the shared Jobber app, so its display source may say Website.
  // The immutable Quo operation wins over labels; conflicting proofs stay held.
  const quo = await quoIntakeProof(env, route, record, requestPhone(record), receipt);
  if (quo && router) return result('held', null, 'source_identity_conflict');
  if (quo) return quo.eligibility === 'suppressed'
    ? result('suppressed', null, quo.reason)
    : result('held', null, quo.reason);

  if (router && receipt) return result('held', null, 'source_identity_conflict');
  if (router) return router;

  if (receipt) return websiteProof(receipt, route, record);

  if (record.source === 'Angi') {
    const angi = await nativeAngiProof(record, MARKET[route.marketKey], now, { allowKc: true });
    if (angi.eligibility === 'eligible') return result('verified', 'angi', angi.reason, false,
      angi.sourceLeadId, angi.sourceCreatedAt);
    if (angi.retryable) return result('pending', null, angi.reason, true);
    return result('held', null, angi.reason);
  }

  if (isRecent(record.createdAt, now)) return result('pending', null,
    WEBSITE_SOURCES.has(record.source) ? 'website_attestation_pending' : 'source_proof_pending', true);
  if (WEBSITE_SOURCES.has(record.source)) return result('held', null, 'website_attestation_missing');
  return result('suppressed', null, 'not_verified_automatic_intake');
}
