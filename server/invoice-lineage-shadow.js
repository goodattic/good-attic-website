import { canonicalJobberId, sourceHash } from './acknowledgement-source.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';

const JOBBER_API_URL = 'https://api.getjobber.com/api/graphql';
const GRAPHQL_VERSION = '2025-04-16';
const id = (value, type) => canonicalJobberId(value, type);
const nodes = connection => Array.isArray(connection?.nodes) ? connection.nodes : [];
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;

// A single invoice is read with its current and archived Job links. Two nodes
// suffice because more than one distinct Job is an explicit review hold.
export const INVOICE_LINEAGE_QUERY = `query CallOriginInvoiceLineage($id: EncodedId!) {
  account { id }
  invoice(id: $id) {
    id updatedAt invoiceStatus client { id }
    amounts { total paymentsTotal invoiceBalance }
    jobs(first: 2) {
      nodes { id client { id } request { id client { id } }
        quote { id client { id } request { id client { id } } } }
      pageInfo { hasNextPage endCursor }
    }
    archivedJobs(first: 2) {
      nodes { id client { id } request { id client { id } }
        quote { id client { id } request { id client { id } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** Only a Jobber GraphQL query is issued; the access token is never logged. */
export async function readJobberInvoiceLineage({ marketKey, invoiceId, tokenForMarket,
  fetchImpl = globalThis.fetch, apiUrl = JOBBER_API_URL } = {}) {
  if (!id(invoiceId, 'Invoice')) throw new Error('invoice_id_invalid');
  if (typeof tokenForMarket !== 'function' || typeof fetchImpl !== 'function') {
    throw new Error('jobber_invoice_reader_unavailable');
  }
  const token = await tokenForMarket(marketKey);
  if (typeof token !== 'string' || !token.trim()) throw new Error('jobber_invoice_token_unavailable');
  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': GRAPHQL_VERSION },
    body: JSON.stringify({ query: INVOICE_LINEAGE_QUERY, variables: { id: invoiceId } }),
  });
  if (!response.ok) throw new Error('jobber_invoice_read_failed');
  const body = await response.json();
  if (body?.errors?.length || !body?.data) throw new Error('jobber_invoice_graphql_failed');
  return body.data;
}

function moneyMicros(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(cents)
    && Number.isSafeInteger(cents * 10000) ? cents * 10000 : null;
}

/** Resolve IDs and amounts from the provider graph; never infer from names/phone. */
export function deriveInvoiceLineage({ marketKey, accountId, invoiceId, data }) {
  const route = getJobberOAuthRoute(marketKey, 'website');
  const reasons = [];
  const expectedAccountId = route && ['ut', 'mo_stl'].includes(marketKey)
    ? route.expectedAccountId : null;
  if (!expectedAccountId || id(accountId, 'Account') !== expectedAccountId
    || id(data?.account?.id, 'Account') !== expectedAccountId) reasons.push('jobber_account_conflict');

  const invoice = data?.invoice;
  const normalizedInvoiceId = id(invoice?.id, 'Invoice');
  if (!normalizedInvoiceId || normalizedInvoiceId !== id(invoiceId, 'Invoice')) reasons.push('invoice_id_conflict_or_missing');
  const clientId = id(invoice?.client?.id, 'Client');
  if (!clientId) reasons.push('invoice_client_missing');
  if (!invoice?.jobs || !invoice?.archivedJobs
    || invoice.jobs.pageInfo?.hasNextPage || invoice.archivedJobs.pageInfo?.hasNextPage) {
    reasons.push('job_connection_incomplete');
  }
  const jobs = [...nodes(invoice?.jobs), ...nodes(invoice?.archivedJobs)];
  const distinctJobs = new Map();
  for (const job of jobs) {
    const jobId = id(job?.id, 'Job');
    if (!jobId) reasons.push('job_id_invalid');
    else if (distinctJobs.has(jobId) && JSON.stringify(distinctJobs.get(jobId)) !== JSON.stringify(job)) {
      reasons.push('job_snapshot_conflict');
    } else distinctJobs.set(jobId, job);
  }
  if (distinctJobs.size === 0) reasons.push('job_missing');
  if (distinctJobs.size > 1) reasons.push('multiple_jobs_on_invoice');
  const [jobId, job] = distinctJobs.size === 1 ? [...distinctJobs][0] : [null, null];
  const jobClientId = id(job?.client?.id, 'Client');
  if (job && (!jobClientId || jobClientId !== clientId)) reasons.push('invoice_job_client_conflict');

  const quoteId = job?.quote ? id(job.quote.id, 'Quote') : null;
  if (job?.quote && !quoteId) reasons.push('quote_id_invalid');
  const quoteClientId = job?.quote ? id(job.quote.client?.id, 'Client') : null;
  if (job?.quote && (!quoteClientId || quoteClientId !== clientId)) reasons.push('invoice_quote_client_conflict');
  const jobRequestId = id(job?.request?.id, 'Request');
  const quoteRequestId = id(job?.quote?.request?.id, 'Request');
  if ((job?.request && !jobRequestId) || (job?.quote?.request && !quoteRequestId)) {
    reasons.push('request_id_invalid');
  }
  if (jobRequestId && quoteRequestId && jobRequestId !== quoteRequestId) {
    reasons.push('job_quote_request_conflict');
  }
  const requestId = jobRequestId || quoteRequestId;
  if (job && !requestId) reasons.push('request_missing');
  const requestClients = [job?.request?.client?.id, job?.quote?.request?.client?.id]
    .filter(value => value !== null && value !== undefined);
  if (requestClients.some(value => id(value, 'Client') !== clientId)) {
    reasons.push('invoice_request_client_conflict');
  }
  if (requestId && requestClients.length === 0) reasons.push('request_client_missing');

  const invoiceStatus = typeof invoice?.invoiceStatus === 'string' && invoice.invoiceStatus.trim()
    ? invoice.invoiceStatus.trim().toLowerCase() : null;
  if (!invoiceStatus) reasons.push('invoice_status_missing');
  const total = moneyMicros(invoice?.amounts?.total);
  const payments = moneyMicros(invoice?.amounts?.paymentsTotal);
  const balance = moneyMicros(invoice?.amounts?.invoiceBalance);
  if (total === null) reasons.push('invoice_total_missing_or_invalid');
  if (payments === null) reasons.push('payments_total_missing_or_invalid');
  if (balance === null) reasons.push('invoice_balance_missing_or_invalid');

  return {
    account_id: expectedAccountId || accountId || null,
    market_key: marketKey,
    invoice_id: id(invoiceId, 'Invoice'), invoice_client_id: clientId,
    job_id: jobId, quote_id: quoteId, operational_request_id: requestId,
    invoice_status: invoiceStatus, invoice_total_micros: total,
    payments_total_micros: payments, invoice_balance_micros: balance,
    jobber_updated_at: validTime(invoice?.updatedAt),
    lineage_status: reasons.length ? 'held' : 'resolved',
    hold_reasons: [...new Set(reasons)],
    evidence: { account: data?.account?.id || null, invoice: invoice || null },
  };
}

/**
 * Writes only D1 shadow rows. resolveCallOrigin is an optional injected
 * verifier from call-origin-stage3c-shadow.js; absent means unassessed.
 */
export async function observeInvoiceLineageShadow({ database, marketKey, accountId, invoiceId,
  readInvoice, resolveCallOrigin, observedAt = new Date().toISOString() }) {
  if (!database?.prepare || typeof database.batch !== 'function' || typeof readInvoice !== 'function') {
    throw new Error('invoice_shadow_dependencies_unavailable');
  }
  if (!id(invoiceId, 'Invoice') || !validTime(observedAt)) throw new Error('invoice_shadow_input_invalid');
  const data = await readInvoice(invoiceId);
  const row = deriveInvoiceLineage({ marketKey, accountId, invoiceId, data });
  let origin = { status: row.lineage_status === 'held' ? 'held' : 'unassessed', reason: null };
  if (row.lineage_status === 'resolved' && typeof resolveCallOrigin === 'function') {
    try {
      origin = await resolveCallOrigin({ database, marketKey, accountId,
        type: 'request', object: { id: row.operational_request_id,
          client: { id: row.invoice_client_id } } });
    } catch {
      origin = { status: 'held', reason: 'call_origin_verification_failed' };
    }
    if (origin.status === 'resolved' && (origin.account_id !== row.account_id
      || origin.client_id !== row.invoice_client_id
      || origin.operational_request_id !== row.operational_request_id
      || !id(origin.original_request_id, 'Request')
      || typeof origin.quo_call_id !== 'string'
      || !/^AC[0-9a-f]{32}$/i.test(origin.quo_call_id)
      || !['original_request', 'verified_lineage'].includes(origin.evidence_kind)
      || (origin.evidence_kind === 'verified_lineage'
        && (typeof origin.link_decision_id !== 'string' || !origin.link_decision_id
          || !Number.isSafeInteger(origin.link_revision) || origin.link_revision < 0)))) {
      origin = { status: 'held', reason: 'call_origin_identity_conflict' };
    }
    if (!['resolved', 'held', 'not_call_origin'].includes(origin.status)) {
      origin = { status: 'held', reason: 'call_origin_verification_invalid' };
    }
  }
  const evidence = JSON.stringify({ jobber: row.evidence, lineage: {
    account_id: row.account_id, invoice_id: row.invoice_id, client_id: row.invoice_client_id,
    job_id: row.job_id, quote_id: row.quote_id, request_id: row.operational_request_id,
    status: row.lineage_status, hold_reasons: row.hold_reasons },
  call_origin: origin.status === 'resolved' ? {
    status: origin.status, quo_call_id: origin.quo_call_id,
    original_request_id: origin.original_request_id, evidence_kind: origin.evidence_kind,
    link_decision_id: origin.link_decision_id || null,
    link_revision: origin.link_revision ?? null,
  } : { status: origin.status, reason: origin.reason || null } });
  const hash = await sourceHash(evidence);
  const fields = {
    account_id: row.account_id, invoice_id: row.invoice_id, market_key: row.market_key,
    invoice_client_id: row.invoice_client_id, job_id: row.job_id, quote_id: row.quote_id,
    operational_request_id: row.operational_request_id, invoice_status: row.invoice_status,
    invoice_total_micros: row.invoice_total_micros,
    payments_total_micros: row.payments_total_micros,
    invoice_balance_micros: row.invoice_balance_micros,
    jobber_updated_at: row.jobber_updated_at, lineage_status: row.lineage_status,
    hold_reasons_json: JSON.stringify(row.hold_reasons), call_origin_status: origin.status,
    call_origin_hold_reason: origin.reason || null,
    quo_call_id: origin.status === 'resolved' ? origin.quo_call_id : null,
    original_request_id: origin.status === 'resolved' ? origin.original_request_id : null,
    call_origin_evidence_kind: origin.status === 'resolved' ? origin.evidence_kind : null,
    link_decision_id: origin.status === 'resolved' ? origin.link_decision_id || null : null,
    link_revision: origin.status === 'resolved' ? origin.link_revision ?? null : null,
    evidence_json: evidence, evidence_hash: hash,
    first_observed_at: validTime(observedAt), last_observed_at: validTime(observedAt),
  };
  const columns = Object.keys(fields);
  const insert = database.prepare(`INSERT INTO invoice_lineage_shadow (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
    ON CONFLICT(account_id, invoice_id) DO UPDATE SET
      ${columns.filter(column => column !== 'account_id' && column !== 'invoice_id'
        && column !== 'first_observed_at').map(column => `${column}=excluded.${column}`).join(', ')}`)
    .bind(...columns.map(column => fields[column]));
  const revision = database.prepare(`INSERT OR IGNORE INTO invoice_lineage_shadow_revisions
    (account_id, invoice_id, evidence_hash, evidence_json, first_observed_at)
    VALUES (?, ?, ?, ?, ?)`).bind(row.account_id, row.invoice_id, hash, evidence, validTime(observedAt));
  await database.batch([insert, revision]);
  return { ...row, call_origin_status: origin.status,
    call_origin_hold_reason: origin.reason || null,
    quo_call_id: fields.quo_call_id, original_request_id: fields.original_request_id,
    evidence_hash: hash };
}
