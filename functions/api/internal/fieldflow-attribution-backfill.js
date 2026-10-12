import { getJobberOAuthRoute } from "../jobber/oauth/config.js";
import { submitFieldflowAttribution } from "../../../server/fieldflow-attribution.js";

// Temporary, manually invoked route. Remove it after the reviewed historical
// replay. Approved hashes must cover only real website submissions that were
// checked against Fieldflow for an existing attribution before configuration.
const EARLIEST_INQUIRY = "2026-09-23T00:00:00Z";
const MAX_BODY_BYTES = 2_048;
const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOBBER_ID = /^[A-Za-z0-9+/]+={0,2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const BODY_KEYS = ["mode", "submission_id", "market_key", "jobber_account_id", "jobber_request_id"];
const SOURCE_TRIPLES = new Map([
  ["Google Ads|google_ads", { sourceKey: "google", sourceDetail: "google_ads" }],
  ["Google Organic|google_organic", { sourceKey: "google", sourceDetail: "google_organic" }],
  ["Organic Online|organic_online", { sourceKey: "website", sourceDetail: "organic_online" }],
  // Match the ordinary website sender: preserve ai_referral in D1 while
  // Fieldflow groups that source under its accepted organic_online detail.
  ["Organic Online|ai_referral", { sourceKey: "website", sourceDetail: "organic_online" }],
  ["Good Attic Website|website_other", { sourceKey: "website", sourceDetail: "website_other" }],
]);
const RECEIVER_RECORD_KEYS = new Set([
  "schema_version", "jobber_account_id", "jobber_request_id", "submission_id",
  "occurred_at", "lead_source", "source_key", "source_detail", "source_reason",
  "gclid", "gbraid", "wbraid",
]);

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorized(request, env) {
  const expected = env?.FIELDFLOW_BACKFILL_TOKEN;
  const provided = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (typeof expected !== "string" || expected.length < 32 || !provided || provided.length > 512) return false;
  const [expectedDigest, providedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(providedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function digestSet(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const hashes = value.trim().toLowerCase().split(/[\s,]+/);
  if (hashes.length > 100 || hashes.some((hash) => !SHA256_HEX.test(hash))) return null;
  return new Set(hashes);
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) return null;
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== BODY_KEYS.length
    || BODY_KEYS.some((key) => !Object.hasOwn(body, key))) return null;
  if (body.mode !== "dry_run" && body.mode !== "send") return null;
  if (typeof body.submission_id !== "string" || !SUBMISSION_ID.test(body.submission_id)) return null;
  if (!["ut", "mo_stl", "mo_kc"].includes(body.market_key)) return null;
  for (const key of ["jobber_account_id", "jobber_request_id"]) {
    if (typeof body[key] !== "string" || body[key].length > 255 || !JOBBER_ID.test(body[key])) return null;
  }
  return body;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function buildReceiverRecord(body, row) {
  const source = SOURCE_TRIPLES.get(`${row.original_source}|${row.source_detail}`);
  if (!source) return null;
  if (!validTimestamp(row.inquiry_at) || row.inquiry_at < EARLIEST_INQUIRY) return null;
  const record = {
    schema_version: "2026-07-31",
    jobber_account_id: body.jobber_account_id,
    jobber_request_id: body.jobber_request_id,
    submission_id: body.submission_id.toLowerCase(),
    occurred_at: row.inquiry_at,
    lead_source: row.original_source,
    source_key: source.sourceKey,
    source_detail: source.sourceDetail,
    source_reason: "verified_website_ledger_backfill",
  };
  for (const key of ["gclid", "gbraid", "wbraid"]) {
    if (row[key] === null || row[key] === undefined || row[key] === "") continue;
    if (typeof row[key] !== "string" || !row[key].trim() || row[key].length > 500) return null;
    record[key] = row[key].trim();
  }
  if (Object.keys(record).some((key) => !RECEIVER_RECORD_KEYS.has(key))) return null;
  return record;
}

function sendOnlyEnvironment(env, marketKey) {
  const tokenKey = marketKey === "ut"
    ? "FIELDFLOW_ATTRIBUTION_TOKEN_SLC" : "FIELDFLOW_ATTRIBUTION_TOKEN_STL";
  return {
    EXTERNAL_API_WRITES_ENABLED: "true",
    FIELDFLOW_ATTRIBUTION_BASE_URL: env.FIELDFLOW_ATTRIBUTION_BASE_URL,
    [tokenKey]: env[tokenKey],
  };
}

async function findWebsiteProof(database, body) {
  return database.prepare(`
    SELECT client_id, source_created_at FROM acknowledgement_sources
    WHERE account_id = ? AND request_id = ? AND market_key = ?
      AND source_kind = 'website' AND source_lead_id = ?
      AND source_created_at >= ?
    LIMIT 1
  `).bind(
    body.jobber_account_id, body.jobber_request_id, body.market_key,
    `website:${body.submission_id.toLowerCase()}`, EARLIEST_INQUIRY,
  ).first();
}

async function findClosedLoopLead(database, body, proof) {
  return database.prepare(`
    SELECT inquiry_at, original_source, source_detail, gclid, gbraid, wbraid
    FROM closed_loop_leads
    WHERE submission_id = ? AND market_key = ? AND jobber_account_id = ?
      AND jobber_request_id = ? AND jobber_client_id = ?
      AND inquiry_at = ? AND inquiry_at >= ?
    LIMIT 1
  `).bind(
    body.submission_id, body.market_key, body.jobber_account_id,
    body.jobber_request_id, proof.client_id, proof.source_created_at,
    EARLIEST_INQUIRY,
  ).first();
}

async function transactionIsConsistent(database, body, proof) {
  const row = await database.prepare(`
    SELECT state, market_key, jobber_account_id, jobber_request_id,
      jobber_client_id, reconciliation_required
    FROM website_form_conversions WHERE submission_id = ? LIMIT 1
  `).bind(body.submission_id).first();
  if (!row) return true; // Form transaction tracking began after the historical start date.
  return row.state === "completed" && Number(row.reconciliation_required) === 0
    && row.market_key === body.market_key
    && row.jobber_account_id === body.jobber_account_id
    && row.jobber_request_id === body.jobber_request_id
    && row.jobber_client_id === proof.client_id;
}

export async function onRequestPost({ request, env }) {
  if (!(await authorized(request, env))) return response({ ok: false, code: "unauthorized" }, 401);
  let body;
  try { body = await readBody(request); } catch { body = null; }
  if (!body) return response({ ok: false, code: "invalid_request" }, 400);
  const approved = digestSet(env?.FIELDFLOW_BACKFILL_APPROVED_SHA256);
  if (!approved || !env?.ANGI_ROUTER_DB?.prepare) {
    return response({ ok: false, code: "backfill_unavailable" }, 503);
  }
  const digest = await sha256Hex(body.submission_id.toLowerCase());
  if (!approved.has(digest)) return response({ ok: false, code: "not_approved" }, 403);
  const excluded = env?.FIELDFLOW_BACKFILL_EXCLUDED_SHA256
    ? digestSet(env.FIELDFLOW_BACKFILL_EXCLUDED_SHA256) : new Set();
  if (!excluded || excluded.has(digest)) {
    return response({ ok: false, code: "excluded" }, 403);
  }
  if (body.mode === "send" && excluded.size === 0) {
    return response({ ok: false, code: "test_exclusions_unavailable" }, 503);
  }
  const route = getJobberOAuthRoute(body.market_key, "website");
  if (!route || route.expectedAccountId !== body.jobber_account_id) {
    return response({ ok: false, code: "account_mismatch" }, 409);
  }

  let proof;
  let consistent;
  let row;
  try {
    proof = await findWebsiteProof(env.ANGI_ROUTER_DB, body);
    if (!proof || !validTimestamp(proof.source_created_at)) {
      return response({ ok: false, code: "website_proof_missing" }, 409);
    }
    consistent = await transactionIsConsistent(env.ANGI_ROUTER_DB, body, proof);
    if (!consistent) return response({ ok: false, code: "transaction_conflict" }, 409);
    if (body.market_key === "mo_kc") {
      return response({ ok: false, code: "classification_unavailable" }, 409);
    }
    row = await findClosedLoopLead(env.ANGI_ROUTER_DB, body, proof);
  } catch {
    return response({ ok: false, code: "database_unavailable" }, 503);
  }
  if (!row) return response({ ok: false, code: "ledger_match_missing" }, 409);
  const record = buildReceiverRecord(body, row);
  if (!record) return response({ ok: false, code: "receiver_shape_unsupported" }, 409);

  // A dry run checks the outgoing subset against the mirrored Fieldflow
  // allowlist and source combinations without making an external request.
  const summary = {
    market: body.market_key,
    source_kind: record.lead_source,
    click_id_present: Boolean(record.gclid || record.gbraid || record.wbraid),
  };
  if (body.mode === "dry_run") {
    return response({ ok: true, code: "ready", ...summary });
  }
  if (env?.FIELDFLOW_BACKFILL_SEND_ENABLED !== "true"
    || env?.EXTERNAL_API_WRITES_ENABLED !== "true") {
    return response({ ok: false, code: "send_disabled" }, 503);
  }

  // Exclude the D1 binding: the verified ledger row already exists, and this
  // one-off replay may only POST attribution to Fieldflow, never write Jobber.
  const sendEnv = sendOnlyEnvironment(env, body.market_key);
  let result;
  try {
    result = await submitFieldflowAttribution(sendEnv, body.market_key, record);
  } catch {
    return response({ ok: false, code: "receiver_delivery_failed" }, 502);
  }
  if (!result.ok) {
    return response({
      ok: false,
      code: "receiver_delivery_failed",
      receiver_status: result.status,
      attempts: result.attempts,
    }, 502);
  }
  return response({
    ok: true,
    code: result.status === 202 ? "created" : "updated",
    receiver_status: result.status,
    ...summary,
  });
}

export const _private = { buildReceiverRecord, digestSet, sendOnlyEnvironment };
