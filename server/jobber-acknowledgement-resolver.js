import { _private as leadHelpers } from '../functions/api/leads.js';
import { _private as contactHelpers } from './jobber-contact-resolver.js';
import {
  canonicalJobberId, normalizeAcknowledgementPhone, readWebsiteAcknowledgementSource, sourceHash,
} from './acknowledgement-source.js';

const QUERY = `query GoodAtticAcknowledgementSource($id: EncodedId!) {
  account { id }
  request(id: $id) {
    id createdAt jobberWebUri source phone
    client { id firstName phones { number normalizedPhoneNumber primary smsAllowed } }
    notes(first: 100) {
      nodes {
        __typename
        ... on RequestNote {
          id createdAt message
          createdBy { __typename ... on Application { id name } }
        }
      }
      pageInfo { hasNextPage }
    }
  }
}`;
const MARKETS = { ut: 'utah', mo_stl: 'stl', mo_kc: 'kc' };
const WEBSITE_SOURCES = new Set(['Good Attic Website Leads', 'Good Attic Google Leads']);
const ANGI_APPLICATION_ID = btoa('gid://Jobber/Application/152570');
const PROOF_GRACE_MS = 5 * 60_000;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const decision = (eligibility, reason, retryable = false, extra = {}) => ({ eligibility, reason, retryable, ...extra });

function freshRequest(createdAt, now) {
  const age = now - Date.parse(createdAt);
  return age >= -30_000 && age < PROOF_GRACE_MS;
}

function requestPhone(record) {
  const phones = record.client.phones;
  if (!Array.isArray(phones) || phones.length > 1000) return { reason: 'jobber_phone_response_invalid' };
  const normalized = [];
  for (const item of phones) {
    if (!item || typeof item.number !== 'string' || typeof item.primary !== 'boolean'
      || typeof item.smsAllowed !== 'boolean'
      || (item.normalizedPhoneNumber !== null && typeof item.normalizedPhoneNumber !== 'string')) {
      return { reason: 'jobber_phone_response_invalid' };
    }
    const raw = normalizeAcknowledgementPhone(item.number);
    const provider = item.normalizedPhoneNumber ? normalizeAcknowledgementPhone(item.normalizedPhoneNumber) : null;
    if ((item.number.trim() && !raw) || (item.normalizedPhoneNumber && !provider) || (raw && provider && raw !== provider)) {
      return { reason: 'jobber_phone_identity_conflict' };
    }
    if (raw || provider) normalized.push({ phone: provider || raw, primary: item.primary, smsAllowed: item.smsAllowed });
  }
  if (record.phone !== null && typeof record.phone !== 'string') return { reason: 'jobber_phone_response_invalid' };
  let phone = record.phone?.trim() ? normalizeAcknowledgementPhone(record.phone) : null;
  if (record.phone?.trim() && !phone) return { reason: 'invalid_request_phone' };
  if (!phone) {
    const primary = [...new Set(normalized.filter(item => item.primary).map(item => item.phone))];
    const all = [...new Set(normalized.map(item => item.phone))];
    if (primary.length > 1 || (!primary.length && all.length > 1)) return { reason: 'ambiguous_request_phone' };
    phone = primary[0] || all[0] || null;
  }
  if (!phone) return { reason: 'missing_request_phone' };
  const matches = normalized.filter(item => item.phone === phone);
  if (!matches.length) return { reason: 'request_client_phone_mismatch' };
  // This Jobber capability flag is not documented as customer consent or STOP.
  // Keep it visible without inventing a Quo messaging preference from it.
  return { phone, smsAllowed: matches.every(item => item.smsAllowed) };
}

async function nativeAngiProof(record, market, now) {
  if (market === 'kc') return decision('suppressed', 'angi_market_not_enabled');
  if (!record.notes || !Array.isArray(record.notes.nodes) || !record.notes.pageInfo
    || typeof record.notes.pageInfo.hasNextPage !== 'boolean') {
    return decision('held', 'angi_note_response_invalid');
  }
  if (record.notes.pageInfo.hasNextPage) return decision('held', 'angi_notes_incomplete');
  const certificates = new Map();
  for (const note of record.notes.nodes) {
    if (note?.__typename !== 'RequestNote') continue; // ClientNotes can be inherited across Requests.
    if (note.createdBy?.__typename !== 'Application'
      || canonicalJobberId(note.createdBy.id, 'Application') !== ANGI_APPLICATION_ID) continue;
    if (!canonicalJobberId(note.id, 'RequestNote') || !Number.isFinite(Date.parse(note.createdAt))
      || Math.abs(Date.parse(note.createdAt) - Date.parse(record.createdAt)) > PROOF_GRACE_MS) {
      return decision('held', 'angi_note_time_or_identity_invalid');
    }
    const certificate = typeof note.message === 'string'
      ? note.message.match(/^Trusted Form:\s*https:\/\/cert\.trustedform\.com\/([0-9a-f]{40})\/?\s*$/i) : null;
    if (!certificate) {
      if (typeof note.message === 'string' && /trusted\s*form/i.test(note.message)) {
        return decision('held', 'angi_source_certificate_invalid');
      }
      continue;
    }
    const canonical = `https://cert.trustedform.com/${certificate[1].toLowerCase()}`;
    certificates.set(canonical, Math.min(certificates.get(canonical) ?? Infinity, Date.parse(note.createdAt)));
  }
  if (certificates.size > 1) return decision('held', 'angi_multiple_source_certificates');
  if (!certificates.size) return decision('held', 'angi_source_proof_missing', freshRequest(record.createdAt, now));
  const [certificate, noteTime] = [...certificates][0];
  return decision('eligible', 'native_angi_request_note_verified', false, {
    sourceKind: 'angi', sourceLeadId: `trustedform:${await sourceHash(certificate)}`,
    // This is the Jobber/native-app receipt time, not an original vendor lead timestamp.
    sourceCreatedAt: new Date(Math.min(Date.parse(record.createdAt), noteTime)).toISOString(),
  });
}

export async function resolveAcknowledgementEligibility(env, route, record, now = Date.now()) {
  const phone = requestPhone(record);
  const base = { phone: phone.phone || '', smsPreference: 'unknown', smsAllowed: phone.smsAllowed ?? null,
    sourceKind: null, sourceLeadId: null, sourceCreatedAt: null };
  let proof;
  const receipt = await readWebsiteAcknowledgementSource(env, route.expectedAccountId, canonicalJobberId(record.id, 'Request'));
  if (receipt) {
    const sourceTime = Date.parse(receipt.source_created_at), createdTime = Date.parse(record.createdAt);
    if (receipt.account_id !== route.expectedAccountId || receipt.market_key !== route.marketKey
      || canonicalJobberId(receipt.request_id, 'Request') !== canonicalJobberId(record.id, 'Request')
      || canonicalJobberId(receipt.client_id, 'Client') !== canonicalJobberId(record.client.id, 'Client')
      || receipt.source_kind !== 'website'
      || !/^website:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt.source_lead_id || '')
      || !Number.isFinite(sourceTime) || sourceTime > createdTime + 30_000 || createdTime - sourceTime > 3_600_000) {
      proof = decision('held', 'website_receipt_identity_conflict');
    } else if (!receipt.phone_sha256 || !phone.phone || receipt.phone_sha256 !== await sourceHash(phone.phone)) {
      proof = decision('held', 'website_receipt_phone_mismatch');
    } else {
      proof = decision('eligible', 'website_receipt_verified', false, {
        sourceKind: 'website', sourceLeadId: receipt.source_lead_id,
        sourceCreatedAt: new Date(sourceTime).toISOString(),
      });
    }
  } else if (record.source === 'Angi') {
    proof = await nativeAngiProof(record, MARKETS[route.marketKey], now);
  } else if (WEBSITE_SOURCES.has(record.source)) {
    const pending = freshRequest(record.createdAt, now);
    proof = decision('held', pending ? 'website_attestation_pending' : 'website_attestation_missing', pending);
  } else {
    // Neither client.leadSource nor a person's editable labels can authorize a text.
    proof = decision('suppressed', 'not_verified_automatic_intake');
  }
  if (proof.eligibility === 'eligible' && phone.reason) {
    proof = { ...proof, ...decision('held', phone.reason) };
  }
  return { ...base, ...proof };
}

export async function handleJobberAcknowledgementResolve({ request, env }, dependencies = leadHelpers) {
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (!await contactHelpers.authorized(request, env.CONTACT_SYNC_BROKER_SECRET)) return json({ ok: false, code: 'unauthorized' }, 401);
  if (Number(request.headers.get('Content-Length')) > 8192) return json({ ok: false, code: 'payload_too_large' }, 413);
  let input;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192) return json({ ok: false, code: 'payload_too_large' }, 413);
    input = JSON.parse(raw);
  } catch { return json({ ok: false, code: 'invalid_input' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['account_id', 'request_id'].includes(key))) return json({ ok: false, code: 'invalid_input' }, 400);
  const route = contactHelpers.ROUTES.get(input.account_id);
  if (!route || !canonicalJobberId(input.request_id, 'Request')) return json({ ok: false, code: 'unknown_jobber_object' }, 400);
  if (!env.ANGI_ROUTER_DB?.prepare) return json({ ok: false, code: 'jobber_authoritative_database_unavailable' }, 503);
  try {
    const token = await dependencies.refreshJobberAccessToken(env, route);
    const result = await dependencies.jobberGraphql(env, token.accessToken, QUERY, { id: input.request_id });
    if (result?.errors?.length) return json({ ok: false, code: 'jobber_resolve_failed' }, 503);
    if (!contactHelpers.sameId(result?.data?.account?.id, route.expectedAccountId, 'Account')) return json({ ok: false, code: 'jobber_account_mismatch' }, 409);
    const record = result.data.request;
    if (record === null) return json({ ok: false, code: 'jobber_object_not_found' }, 404);
    if (!record || !contactHelpers.sameId(record.id, input.request_id, 'Request')) return json({ ok: false, code: 'jobber_object_mismatch' }, 409);
    if (!canonicalJobberId(record.client?.id, 'Client') || typeof record.source !== 'string'
      || typeof record.client.firstName !== 'string' || typeof record.createdAt !== 'string'
      || !Number.isFinite(Date.parse(record.createdAt))) return json({ ok: false, code: 'jobber_response_invalid' }, 502);
    let uri;
    try { uri = new URL(record.jobberWebUri); } catch { return json({ ok: false, code: 'jobber_url_invalid' }, 502); }
    const numericId = atob(record.id).split('/').at(-1);
    if (uri.protocol !== 'https:' || uri.hostname !== 'secure.getjobber.com' || uri.username || uri.password
      || uri.port || uri.search || uri.hash || uri.pathname !== `/work_requests/${numericId}`) return json({ ok: false, code: 'jobber_url_invalid' }, 502);
    const eligibility = await resolveAcknowledgementEligibility(env, route, record, dependencies.now?.() ?? Date.now());
    return json({ ok: true, account_id: route.expectedAccountId, market: MARKETS[route.marketKey], request: {
      id: canonicalJobberId(record.id, 'Request'), createdAt: new Date(record.createdAt).toISOString(),
      jobberWebUri: uri.href, clientId: canonicalJobberId(record.client.id, 'Client'),
      firstName: record.client.firstName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100),
      ...eligibility,
    } });
  } catch { return json({ ok: false, code: 'jobber_resolve_failed' }, 503); }
}

export const _private = { QUERY, nativeAngiProof, requestPhone, PROOF_GRACE_MS };
