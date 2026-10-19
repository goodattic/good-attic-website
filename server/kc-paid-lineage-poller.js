import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { _private as leadHelpers } from "../functions/api/leads.js";
import { readAttributionSignal, reconcileMissingKcPaidWebsiteLeads } from "./fieldflow-attribution.js";

const KC_ROUTE = getJobberOAuthRoute("mo_kc", "website");
const PAGE_SIZE = 50;
const MAX_PAGES = 100;
const MAX_OBJECTS = 200;
const POLL_LEASE_MS = 20 * 60 * 1000;
const STABLE_CONFLICT_MIN_AGE_MS = 25 * 60 * 1000;
const RECHECKABLE_RELATION_CODES = new Set([
  "request_identity_conflict", "request_changed_during_poll",
  "assessment_identity_conflict", "quote_identity_conflict",
  "job_identity_conflict", "job_quote_identity_conflict",
  "quote_changed_during_poll", "quote_job_request_mismatch",
  "quote_job_inverse_mismatch",
  "job_changed_during_poll", "invoice_client_conflict",
  "invoice_changed_during_poll", "invoice_mixed_request_or_client",
  "invoice_job_quote_conflict", "invoice_without_verified_job",
  "invoice_forward_reverse_mismatch",
]);
const IMMEDIATE_HOLD_CODES = new Set([
  "invoice_mixed_request_or_client", "invoice_client_conflict",
]);
const REQUEST_QUERY = `query KcPaidLineageRequest($id: EncodedId!) {
  account { id }
  request(id: $id) {
    id client { id }
    assessment { id startAt completedAt request { id } client { id } }
  }
}`;
const REQUEST_QUOTES_QUERY = `query KcPaidLineageRequestQuotes($id: EncodedId!, $after: String, $first: Int!) {
  account { id }
  request(id: $id) {
    id client { id }
    quotes(first: $first, after: $after) {
      nodes { id createdAt quoteStatus client { id } request { id client { id } } }
      totalCount
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const REQUEST_JOBS_QUERY = `query KcPaidLineageRequestJobs($id: EncodedId!, $after: String, $first: Int!) {
  account { id }
  request(id: $id) {
    id client { id }
    jobs(first: $first, after: $after) {
      nodes { id createdAt jobStatus client { id } request { id client { id } }
        quote { id request { id client { id } } } }
      totalCount
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const QUOTE_JOBS_QUERY = `query KcPaidLineageQuoteJobs($id: EncodedId!, $after: String, $first: Int!) {
  account { id }
  quote(id: $id) {
    id client { id } request { id client { id } }
    jobs(first: $first, after: $after) {
      nodes { id }
      totalCount
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const JOB_INVOICES_QUERY = `query KcPaidLineageJobInvoices($id: EncodedId!, $after: String, $first: Int!) {
  account { id }
  job(id: $id) {
    id client { id } request { id client { id } }
    quote { id request { id client { id } } }
    invoices(first: $first, after: $after) {
      nodes { id createdAt invoiceStatus client { id } }
      totalCount
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const INVOICE_JOBS_QUERY = `query KcPaidLineageInvoiceJobs($id: EncodedId!, $after: String, $first: Int!) {
  account { id }
  invoice(id: $id) {
    id client { id }
    jobs(first: $first, after: $after) {
      nodes { id client { id } request { id client { id } }
        quote { id request { id client { id } } } }
      totalCount
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const INVOICE_ARCHIVED_JOBS_QUERY = `query KcPaidLineageInvoiceArchivedJobs($id: EncodedId!, $after: String, $first: Int!) {
  account { id }
  invoice(id: $id) {
    id client { id }
    archivedJobs(first: $first, after: $after) {
      nodes { id client { id } request { id client { id } }
        quote { id request { id client { id } } } }
      totalCount
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class LineageError extends Error {
  constructor(code, retryable = false) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

function hold(code) { throw new LineageError(code); }
function retry(code) { throw new LineageError(code, true); }

function sameClient(node, requestId, clientId) {
  return clean(node?.client?.id) === clientId
    && clean(node?.request?.id) === requestId
    && clean(node?.request?.client?.id) === clientId;
}

function validPaidProof(lead) {
  const accountId = KC_ROUTE.expectedAccountId;
  if (lead?.market_key !== "mo_kc" || lead?.original_source !== "Google Ads"
    || lead?.source_detail !== "google_ads" || lead?.jobber_account_id !== accountId
    || !clean(lead?.jobber_request_id) || !clean(lead?.jobber_client_id)
    || lead?.lead_id !== `jobber-request:${lead.jobber_request_id}`
    || lead?.proof_account_id !== accountId || lead?.proof_request_id !== lead.jobber_request_id
    || lead?.proof_client_id !== lead.jobber_client_id
    || lead?.source_lead_id !== `website:${clean(lead?.submission_id).toLowerCase()}`
    || lead?.proof_state !== "completed" || lead?.proof_source_key !== "google"
    || lead?.proof_source_detail !== "google_ads"
    || lead?.form_state !== "completed" || lead?.form_transaction_id !== lead.submission_id
    || lead?.form_reconciliation_required !== 0
    || lead?.receipt_source_kind !== "website"
    || lead?.source_created_at !== lead.inquiry_at) return false;
  let proof;
  try { proof = JSON.parse(lead.evidence_json); } catch { return false; }
  if (proof?.schema_version !== 1 || proof?.source_key !== "google"
    || proof?.source_detail !== "google_ads" || proof?.source_reason !== lead.source_reason
    || !proof?.attribution || !proof?.verified_signals) return false;
  const prefix = lead.source_reason.startsWith("paid_touch_") ? "paid_touch"
    : lead.source_reason.startsWith("first_touch_") ? "first_touch" : "";
  const capturedAt = proof.attribution[prefix ? `${prefix}_captured_at` : "attribution_captured_at"];
  if (!Number.isFinite(Date.parse(capturedAt))
    || readAttributionSignal(proof.attribution, "utm_campaign", prefix) !== clean(lead.campaign)) return false;
  const reason = clean(lead.source_reason, 2000).replace(/^(paid_touch|first_touch)_/, "");
  if (["gclid", "gbraid", "wbraid"].includes(reason)) {
    const value = clean(proof.verified_signals[reason]);
    return /^[A-Za-z0-9._~-]{6,300}$/.test(value) && value === lead[reason];
  }
  if (reason === "gad_source") return /^\d{1,12}$/.test(clean(proof.verified_signals.gad_source));
  if (reason === "google_paid_utm") {
    return clean(proof.verified_signals.utm_source).toLowerCase() === "google"
      && /^(cpc|ppc|paidsearch|paid-search|sem)$/i.test(
        clean(proof.verified_signals.utm_medium).replace(/[\s_]+/g, "-"));
  }
  return false;
}

async function queryChecked(query, document, variables = {}) {
  let result;
  try { result = await query(document, variables); } catch { retry("jobber_query_failed"); }
  if (result?.errors?.length || !result?.data) retry("jobber_query_failed");
  if (result.data.account?.id !== KC_ROUTE.expectedAccountId) hold("jobber_account_mismatch");
  return result.data;
}

async function connectionPages(query, document, variables, selectConnection, validateParent) {
  const nodes = [];
  const ids = new Set();
  const cursors = new Set();
  let after = null;
  let expectedTotal = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await queryChecked(query, document, { ...variables, after, first: PAGE_SIZE });
    const parent = validateParent(data);
    const connection = selectConnection(parent);
    if (!connection || !Array.isArray(connection.nodes)
      || typeof connection.pageInfo?.hasNextPage !== "boolean"
      || !Number.isSafeInteger(connection.totalCount) || connection.totalCount < 0) {
      retry("jobber_connection_incomplete");
    }
    if (expectedTotal === null) expectedTotal = connection.totalCount;
    if (connection.totalCount !== expectedTotal) retry("jobber_connection_changed_during_poll");
    for (const node of connection.nodes) {
      const id = clean(node?.id);
      if (!id || ids.has(id)) retry("jobber_connection_duplicate_or_missing_id");
      ids.add(id);
      nodes.push(node);
      if (nodes.length > MAX_OBJECTS) retry("jobber_connection_limit");
    }
    if (!connection.pageInfo.hasNextPage) {
      if (nodes.length !== expectedTotal) retry("jobber_connection_count_mismatch");
      return nodes;
    }
    const cursor = clean(connection.pageInfo.endCursor, 1000);
    if (!cursor || cursors.has(cursor) || connection.nodes.length === 0) retry("jobber_pagination_invalid");
    cursors.add(cursor);
    after = cursor;
  }
  retry("jobber_pagination_limit");
}

function object(type, node, lead, extra = {}) {
  return {
    object_type: type,
    object_id: clean(node.id),
    request_id: lead.jobber_request_id,
    client_id: lead.jobber_client_id,
    source_created_at: clean(node.createdAt || node.startAt, 80),
    jobber_status: clean(extra.status, 80),
    parent_quote_id: clean(extra.quoteId),
    parent_job_ids_json: extra.jobIds ? JSON.stringify([...extra.jobIds].sort()) : null,
  };
}

// Every page is fetched before a linked row can be written. A conflict holds
// the whole Request so a shared Client never becomes a fabricated lineage.
export async function collectKcPaidLineage(lead, query) {
  if (!validPaidProof(lead)) hold("paid_source_proof_invalid");
  const requestId = lead.jobber_request_id;
  const clientId = lead.jobber_client_id;
  const requestData = await queryChecked(query, REQUEST_QUERY, { id: requestId });
  const request = requestData.request;
  if (!request || request.id !== requestId || request.client?.id !== clientId) hold("request_identity_conflict");
  const objects = [];
  if (request.assessment) {
    const assessment = request.assessment;
    if (!clean(assessment.id) || assessment.request?.id !== requestId
      || assessment.client?.id !== clientId) hold("assessment_identity_conflict");
    objects.push(object("assessment", assessment, lead, {
      status: assessment.completedAt ? "completed" : "scheduled",
    }));
  }
  const validateRequest = (data) => {
    if (data.request?.id !== requestId || data.request?.client?.id !== clientId) hold("request_changed_during_poll");
    return data.request;
  };
  const quotes = await connectionPages(query, REQUEST_QUOTES_QUERY, { id: requestId },
    (parent) => parent.quotes, validateRequest);
  const quoteIds = new Set();
  for (const quote of quotes) {
    if (!sameClient(quote, requestId, clientId)) hold("quote_identity_conflict");
    quoteIds.add(quote.id);
    objects.push(object("quote", quote, lead, { status: quote.quoteStatus }));
    if (objects.length > MAX_OBJECTS) retry("jobber_object_limit");
  }
  const jobs = await connectionPages(query, REQUEST_JOBS_QUERY, { id: requestId },
    (parent) => parent.jobs, validateRequest);
  const jobIds = new Set(jobs.map((job) => job.id));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  for (const job of jobs) {
    if (!sameClient(job, requestId, clientId)) hold("job_identity_conflict");
    if (job.quote && (!quoteIds.has(job.quote.id)
      || job.quote.request?.id !== requestId
      || job.quote.request?.client?.id !== clientId)) hold("job_quote_identity_conflict");
    objects.push(object("job", job, lead, { status: job.jobStatus, quoteId: job.quote?.id }));
    if (objects.length > MAX_OBJECTS) retry("jobber_object_limit");
  }
  for (const quote of quotes) {
    const quoteJobs = await connectionPages(query, QUOTE_JOBS_QUERY, { id: quote.id },
      (parent) => parent.jobs, (data) => {
        if (data.quote?.id !== quote.id || !sameClient(data.quote, requestId, clientId)) {
          hold("quote_changed_during_poll");
        }
        return data.quote;
      });
    for (const job of quoteJobs) {
      if (!jobIds.has(job.id) || jobsById.get(job.id)?.quote?.id !== quote.id) {
        hold("quote_job_request_mismatch");
      }
    }
    const expectedJobIds = new Set(jobs.filter((job) => job.quote?.id === quote.id)
      .map((job) => job.id));
    if (quoteJobs.length !== expectedJobIds.size
      || quoteJobs.some((job) => !expectedJobIds.has(job.id))) {
      hold("quote_job_inverse_mismatch");
    }
  }
  const invoices = new Map();
  const invoiceForwardJobs = new Map();
  for (const job of jobs) {
    const jobInvoices = await connectionPages(query, JOB_INVOICES_QUERY, { id: job.id },
      (parent) => parent.invoices, (data) => {
        if (data.job?.id !== job.id || !sameClient(data.job, requestId, clientId)
          || clean(data.job.quote?.id) !== clean(job.quote?.id)) hold("job_changed_during_poll");
        return data.job;
      });
    for (const invoice of jobInvoices) {
      if (invoice.client?.id !== clientId) hold("invoice_client_conflict");
      const prior = invoices.get(invoice.id);
      if (prior && (prior.createdAt !== invoice.createdAt
        || prior.invoiceStatus !== invoice.invoiceStatus)) hold("invoice_changed_during_poll");
      invoices.set(invoice.id, invoice);
      if (!invoiceForwardJobs.has(invoice.id)) invoiceForwardJobs.set(invoice.id, new Set());
      invoiceForwardJobs.get(invoice.id).add(job.id);
    }
  }
  for (const invoice of invoices.values()) {
    const validateInvoice = (data) => {
      if (data.invoice?.id !== invoice.id || data.invoice?.client?.id !== clientId) {
        hold("invoice_changed_during_poll");
      }
      return data.invoice;
    };
    const active = await connectionPages(query, INVOICE_JOBS_QUERY, { id: invoice.id },
      (parent) => parent.jobs, validateInvoice);
    const archived = await connectionPages(query, INVOICE_ARCHIVED_JOBS_QUERY, { id: invoice.id },
      (parent) => parent.archivedJobs, validateInvoice);
    const linkedIds = new Set();
    for (const linkedJob of [...active, ...archived]) {
      if (!sameClient(linkedJob, requestId, clientId) || !jobIds.has(linkedJob.id)) {
        hold("invoice_mixed_request_or_client");
      }
      if (linkedJob.quote && (!quoteIds.has(linkedJob.quote.id)
        || linkedJob.quote.request?.id !== requestId
        || linkedJob.quote.request?.client?.id !== clientId)) hold("invoice_job_quote_conflict");
      linkedIds.add(linkedJob.id);
    }
    if (linkedIds.size === 0) hold("invoice_without_verified_job");
    const forwardIds = invoiceForwardJobs.get(invoice.id);
    if (linkedIds.size !== forwardIds?.size
      || [...linkedIds].some((id) => !forwardIds.has(id))) hold("invoice_forward_reverse_mismatch");
    objects.push(object("invoice", invoice, lead, {
      status: invoice.invoiceStatus, jobIds: linkedIds,
    }));
    if (objects.length > MAX_OBJECTS) retry("jobber_object_limit");
  }
  return objects;
}

async function collectStableKcPaidLineage(lead, query) {
  try {
    return await collectKcPaidLineage(lead, query);
  } catch (first) {
    if (!(first instanceof LineageError) || first.retryable
      || !RECHECKABLE_RELATION_CODES.has(first.code)) throw first;
    try {
      return await collectKcPaidLineage(lead, query);
    } catch (second) {
      if (second instanceof LineageError && !second.retryable
        && second.code === first.code) {
        if (IMMEDIATE_HOLD_CODES.has(second.code)) throw second;
        retry(second.code);
      }
      retry("jobber_relationship_changed_during_poll");
    }
  }
}

const CANDIDATES_SQL = `
  SELECT l.*, p.account_id AS proof_account_id, p.jobber_request_id AS proof_request_id,
    p.jobber_client_id AS proof_client_id, p.source_lead_id, p.source_reason,
    p.evidence_json, p.state AS proof_state, p.source_key AS proof_source_key,
    p.source_detail AS proof_source_detail,
    f.state AS form_state, f.transaction_id AS form_transaction_id,
    f.reconciliation_required AS form_reconciliation_required,
    a.source_kind AS receipt_source_kind, a.source_created_at
  FROM closed_loop_leads l
  LEFT JOIN website_google_source_proofs p
    ON p.submission_id = l.submission_id AND p.market_key = l.market_key
    AND p.account_id = l.jobber_account_id
    AND p.jobber_request_id = l.jobber_request_id
    AND p.jobber_client_id = l.jobber_client_id
  LEFT JOIN website_form_conversions f
    ON f.submission_id = p.submission_id AND f.transaction_id = p.submission_id
    AND f.market_key = p.market_key AND f.jobber_account_id = p.account_id
    AND f.jobber_request_id = p.jobber_request_id
    AND f.jobber_client_id = p.jobber_client_id
  LEFT JOIN acknowledgement_sources a
    ON a.account_id = p.account_id AND a.request_id = p.jobber_request_id
    AND a.client_id = p.jobber_client_id AND a.market_key = p.market_key
    AND a.source_lead_id = p.source_lead_id
  LEFT JOIN kc_paid_lineage_polls last ON last.lead_id = l.lead_id
  WHERE l.market_key = 'mo_kc' AND l.original_source = 'Google Ads'
    AND l.source_detail = 'google_ads'
  ORDER BY COALESCE(last.last_polled_at, '') ASC, l.inquiry_at ASC
  LIMIT ?`;

async function persistPoll(database, lead, objects, status, code, now) {
  const previous = await database.prepare(`
    SELECT status, hold_code, last_polled_at FROM kc_paid_lineage_polls
    WHERE lead_id = ? LIMIT 1
  `).bind(lead.lead_id).first();
  if (previous?.status === "held") {
    status = "held";
    code = previous.hold_code || "prior_hold_requires_review";
  }
  if (status === "linked") {
    const priorObjects = await database.prepare(`
      SELECT object_type, object_id FROM kc_paid_lineage_objects
      WHERE lead_id = ? AND status IN ('linked', 'unverified')
    `).bind(lead.lead_id).all();
    const current = new Set(objects.map((entry) => `${entry.object_type}:${entry.object_id}`));
    if ((priorObjects?.results || []).some((entry) =>
      !current.has(`${entry.object_type}:${entry.object_id}`))) {
      status = "retryable";
      code = "object_disappeared_from_complete_snapshot";
    }
  }
  if (status === "retryable"
    && (RECHECKABLE_RELATION_CODES.has(code)
      || code === "object_disappeared_from_complete_snapshot")
    && previous?.status === "retryable" && previous.hold_code === code
    && Number.isFinite(Date.parse(previous.last_polled_at))
    && Date.parse(now) - Date.parse(previous.last_polled_at) >= STABLE_CONFLICT_MIN_AGE_MS) {
    status = "held";
  }
  const collidingLeadIds = new Set();
  for (const entry of objects) {
    const existing = await database.prepare(`
      SELECT lead_id, request_id, client_id, status FROM kc_paid_lineage_objects
      WHERE account_id = ? AND object_type = ? AND object_id = ? LIMIT 1
    `).bind(lead.jobber_account_id, entry.object_type, entry.object_id).first();
    if (!existing) continue;
    if (existing.lead_id !== lead.lead_id) {
      collidingLeadIds.add(existing.lead_id);
      status = "held";
      code = "cross_lead_collision";
    } else if (existing.request_id !== entry.request_id || existing.client_id !== entry.client_id) {
      status = "held";
      code = "stored_identity_conflict";
    } else if (existing.status === "held" && status === "linked") {
      status = "held";
      code = "prior_object_hold_requires_review";
    }
  }
  const statements = [];
  for (const collidingLeadId of collidingLeadIds) {
    statements.push(database.prepare(`UPDATE kc_paid_lineage_objects
      SET status = 'held', hold_code = 'cross_lead_collision', last_seen_at = ?
      WHERE lead_id = ? AND status IN ('linked', 'unverified')`).bind(now, collidingLeadId));
    statements.push(database.prepare(`UPDATE kc_paid_lineage_polls
      SET status = 'held', hold_code = 'cross_lead_collision', updated_at = ?
      WHERE lead_id = ?`).bind(now, collidingLeadId));
  }
  if (status === "held") {
    statements.push(database.prepare(`UPDATE kc_paid_lineage_objects
      SET status = 'held', hold_code = ?, last_seen_at = ?
      WHERE lead_id = ? AND status IN ('linked', 'unverified')`).bind(code, now, lead.lead_id));
  } else if (status === "retryable") {
    statements.push(database.prepare(`UPDATE kc_paid_lineage_objects
      SET status = 'unverified', hold_code = ?, last_seen_at = ?
      WHERE lead_id = ? AND status = 'linked'`).bind(code, now, lead.lead_id));
  }
  for (const entry of status === "retryable" ? [] : objects) {
    statements.push(database.prepare(`
      INSERT INTO kc_paid_lineage_objects (
        account_id, object_type, object_id, lead_id, request_id, client_id,
        parent_quote_id, parent_job_ids_json, jobber_status, source_created_at,
        status, hold_code, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, object_type, object_id) DO UPDATE SET
        status = CASE WHEN kc_paid_lineage_objects.lead_id <> excluded.lead_id
          OR kc_paid_lineage_objects.status = 'held' THEN 'held' ELSE excluded.status END,
        hold_code = CASE WHEN kc_paid_lineage_objects.lead_id <> excluded.lead_id
          THEN 'cross_lead_collision' WHEN kc_paid_lineage_objects.status = 'held'
          THEN kc_paid_lineage_objects.hold_code ELSE excluded.hold_code END,
        parent_quote_id = CASE WHEN kc_paid_lineage_objects.lead_id = excluded.lead_id
          AND kc_paid_lineage_objects.status <> 'held' AND excluded.status = 'linked'
          THEN excluded.parent_quote_id ELSE kc_paid_lineage_objects.parent_quote_id END,
        parent_job_ids_json = CASE WHEN kc_paid_lineage_objects.lead_id = excluded.lead_id
          AND kc_paid_lineage_objects.status <> 'held' AND excluded.status = 'linked'
          THEN excluded.parent_job_ids_json ELSE kc_paid_lineage_objects.parent_job_ids_json END,
        jobber_status = CASE WHEN kc_paid_lineage_objects.lead_id = excluded.lead_id
          AND excluded.status = 'linked' THEN excluded.jobber_status
          ELSE kc_paid_lineage_objects.jobber_status END,
        source_created_at = CASE WHEN kc_paid_lineage_objects.lead_id = excluded.lead_id
          AND excluded.status = 'linked' THEN excluded.source_created_at
          ELSE kc_paid_lineage_objects.source_created_at END,
        last_seen_at = excluded.last_seen_at
    `).bind(
      lead.jobber_account_id, entry.object_type, entry.object_id, lead.lead_id,
      entry.request_id, entry.client_id, entry.parent_quote_id || null,
      entry.parent_job_ids_json, entry.jobber_status || null,
      entry.source_created_at || null, status === "linked" ? "linked" : "held",
      code || null, now, now,
    ));
  }
  statements.push(database.prepare(`
    INSERT INTO kc_paid_lineage_polls (
      lead_id, account_id, request_id, status, hold_code, object_count,
      attempt_count, last_polled_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(lead_id) DO UPDATE SET
      status = CASE WHEN kc_paid_lineage_polls.status = 'held'
        THEN 'held' ELSE excluded.status END,
      hold_code = CASE WHEN kc_paid_lineage_polls.status = 'held'
        THEN kc_paid_lineage_polls.hold_code ELSE excluded.hold_code END,
      object_count = excluded.object_count,
      attempt_count = kc_paid_lineage_polls.attempt_count + 1,
      last_polled_at = excluded.last_polled_at,
      updated_at = excluded.updated_at
  `).bind(lead.lead_id, lead.jobber_account_id, lead.jobber_request_id,
    status, code || null, objects.length, now, now));
  await database.batch(statements);
  return status;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function claimPoll(database) {
  const token = crypto.randomUUID();
  const nowMs = Date.now();
  await database.prepare(`INSERT OR IGNORE INTO kc_paid_lineage_poll_lock
    (lock_name, lease_token, lease_expires_at, updated_at)
    VALUES ('kc_paid_website', NULL, NULL, ?)`)
    .bind(new Date(nowMs).toISOString()).run();
  const result = await database.prepare(`UPDATE kc_paid_lineage_poll_lock
    SET lease_token = ?, lease_expires_at = ?, updated_at = ?
    WHERE lock_name = 'kc_paid_website'
      AND (lease_token IS NULL OR lease_expires_at <= ?)`)
    .bind(token, nowMs + POLL_LEASE_MS, new Date(nowMs).toISOString(), nowMs).run();
  return changes(result) === 1 ? token : null;
}

async function releasePoll(database, token) {
  await database.prepare(`UPDATE kc_paid_lineage_poll_lock
    SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE lock_name = 'kc_paid_website' AND lease_token = ?`)
    .bind(new Date().toISOString(), token).run();
}

export async function pollKcPaidLineage(env, { limit = 8, query = null, now = () => new Date().toISOString() } = {}) {
  const database = env?.ANGI_ROUTER_DB;
  if (!database?.prepare || !database?.batch) return { ok: false, code: "database_unavailable" };
  const token = await claimPoll(database);
  if (!token) return { ok: true, busy: true, examined: 0, linked: 0, held: 0, retryable: 0 };
  try {
    const reconciliation = await reconcileMissingKcPaidWebsiteLeads(database, { limit, now });
    if (!reconciliation.ok) return reconciliation;
    const boundedLimit = Math.max(1, Math.min(8, Number(limit) || 8));
    const candidates = await database.prepare(CANDIDATES_SQL).bind(boundedLimit).all();
    const leads = candidates?.results || [];
    if (!Array.isArray(leads)) return { ok: false, code: "database_response_invalid" };
    if (leads.length === 0) return { ok: true, examined: 0, linked: 0,
      held: 0, retryable: 0, reconciliation };
    let graphQuery = query;
    if (!graphQuery) {
      graphQuery = (document, variables) =>
        leadHelpers.jobberGraphqlWithAuthorizationRecovery(env, KC_ROUTE, document, variables);
    }
    const result = { ok: true, examined: 0, linked: 0, held: 0, retryable: 0,
      reconciliation };
    for (const lead of leads) {
      result.examined += 1;
      try {
        const objects = await collectStableKcPaidLineage(lead, graphQuery);
        const applied = await persistPoll(database, lead, objects, "linked", null, now());
        result[applied] += 1;
      } catch (error) {
        if (!(error instanceof LineageError)) throw error;
        const status = error.retryable ? "retryable" : "held";
        const applied = await persistPoll(database, lead, [], status, error.code, now());
        result[applied] += 1;
      }
    }
    return result;
  } finally {
    try { await releasePoll(database, token); } catch { /* the claim expires */ }
  }
}

export const _private = {
  CANDIDATES_SQL, KC_ROUTE, LineageError, connectionPages, validPaidProof,
  claimPoll, releasePoll, collectStableKcPaidLineage, persistPoll,
  REQUEST_QUERY, REQUEST_QUOTES_QUERY, REQUEST_JOBS_QUERY, QUOTE_JOBS_QUERY,
  JOB_INVOICES_QUERY, INVOICE_JOBS_QUERY, INVOICE_ARCHIVED_JOBS_QUERY,
};
