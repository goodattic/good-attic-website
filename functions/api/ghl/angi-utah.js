import { _private as leadHelpers } from "../leads.js";
import {
  buildAngiAttribution,
  submitFieldflowAttribution,
} from "../../../server/fieldflow-attribution.js";

const EXPECTED_ANGI_ENTITY_ID = "131399442";
const EXPECTED_JOBBER_ACCOUNT_ID = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==";
const WEBHOOK_SECRET_ENV_KEY = "ANGI_ROUTER_SECRET";
const DATABASE_ENV_KEY = "ANGI_ROUTER_DB";
const ENABLED_ENV_KEY = "ANGI_ROUTER_ENABLED";
const CUTOVER_AT_ENV_KEY = "ANGI_ROUTER_CUTOVER_AT";
const LEASE_DURATION_MS = 2 * 60 * 1000;
const PROCESS_LOCK_DURATION_MS = 4 * 60 * 1000;
const RETRY_AFTER_SECONDS = 30;
const MAX_DELIVERY_ATTEMPTS = 8;
const MAX_FIELDFLOW_OUTBOX_ATTEMPTS = 8;
const REVIEW_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const LEGACY_JOBBER_AUTH_ACCOUNT_KEY = "utah";
const LEGACY_JOBBER_PROCESS_LOCK_NAME = "utah_jobber_process";
const ANGI_JOBBER_AUTH_ACCOUNT_KEY = "utah_angi";
const ANGI_JOBBER_PROCESS_LOCK_NAME = "utah_angi_jobber_process";

const JOBBER_ACCOUNT_QUERY = `
  query GoodAtticUtahAccountCheck {
    account {
      id
    }
  }
`;

const JOBBER_CLIENT_REQUESTS_QUERY = `
  query GoodAtticFindAngiRequest($clientId: EncodedId!) {
    client(id: $clientId) {
      requests(first: 25) {
        nodes {
          id
          title
        }
      }
    }
  }
`;

const JOBBER_REQUEST_NOTES_QUERY = `
  query GoodAtticFindAngiRequestNote($requestId: EncodedId!) {
    request(id: $requestId) {
      notes(first: 25) {
        nodes {
          id
          message
        }
      }
    }
  }
`;

const JOBBER_REQUEST_NOTE_CREATE_MUTATION = `
  mutation GoodAtticRequestCreateNote(
    $requestId: EncodedId!
    $input: RequestCreateNoteInput!
  ) {
    requestCreateNote(requestId: $requestId, input: $input) {
      requestNote {
        id
      }
      userErrors {
        message
        path
      }
    }
  }
`;

const JOBBER_CLIENT_CREATE_MUTATION = `
  mutation GoodAtticAngiClientCreate($input: ClientCreateInput!) {
    clientCreate(input: $input) {
      client {
        id
        clientProperties {
          nodes {
            id
          }
        }
      }
      userErrors {
        message
        path
      }
    }
  }
`;

const JOBBER_REQUEST_CREATE_MUTATION = `
  mutation GoodAtticAngiRequestCreate($input: RequestCreateInput!) {
    requestCreate(input: $input) {
      request {
        id
        title
        property {
          id
        }
      }
      userErrors {
        message
        path
      }
    }
  }
`;

const INSERT_FIELDFLOW_OUTBOX_SQL = `
  /* fieldflow_outbox:insert */
  INSERT OR IGNORE INTO fieldflow_attribution_outbox (
    idempotency_key,
    payload_json,
    status,
    attempt_count,
    next_attempt_at,
    created_at,
    updated_at
  ) VALUES (?, ?, 'pending', 0, ?, ?, ?)
`;

const SELECT_DRAINABLE_FIELDFLOW_OUTBOX_SQL = `
  /* fieldflow_outbox:select_drainable */
  SELECT
    idempotency_key,
    payload_json,
    status,
    attempt_count,
    next_attempt_at,
    last_error_code
  FROM fieldflow_attribution_outbox
  WHERE status IN ('pending', 'failed_retryable')
    AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
  ORDER BY created_at ASC
  LIMIT 1
`;

const MARK_FIELDFLOW_OUTBOX_SENT_SQL = `
  /* fieldflow_outbox:sent */
  UPDATE fieldflow_attribution_outbox
  SET
    status = 'sent',
    attempt_count = ?,
    next_attempt_at = NULL,
    last_error_code = NULL,
    sent_at = ?,
    updated_at = ?
  WHERE idempotency_key = ?
    AND status IN ('pending', 'failed_retryable')
`;

const MARK_FIELDFLOW_OUTBOX_RETRY_SQL = `
  /* fieldflow_outbox:retry */
  UPDATE fieldflow_attribution_outbox
  SET
    status = 'failed_retryable',
    attempt_count = ?,
    next_attempt_at = ?,
    last_error_code = ?,
    updated_at = ?
  WHERE idempotency_key = ?
    AND status IN ('pending', 'failed_retryable')
`;

const MARK_FIELDFLOW_OUTBOX_REVIEW_SQL = `
  /* fieldflow_outbox:needs_review */
  UPDATE fieldflow_attribution_outbox
  SET
    status = 'needs_review',
    attempt_count = ?,
    next_attempt_at = NULL,
    last_error_code = ?,
    updated_at = ?
  WHERE idempotency_key = ?
    AND status IN ('pending', 'failed_retryable')
`;

const FIELDFLOW_OUTBOX_STATUS_COUNTS_SQL = `
  /* fieldflow_outbox:status_counts */
  SELECT status, COUNT(*) AS count
  FROM fieldflow_attribution_outbox
  GROUP BY status
`;

const INSERT_DELIVERY_SQL = `
  /* angi_router:insert */
  INSERT OR IGNORE INTO angi_utah_jobber_deliveries (
    idempotency_key,
    payload_json,
    status,
    attempt_count,
    next_attempt_at,
    last_error_code,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)
`;

const SELECT_DELIVERY_SQL = `
  /* angi_router:select */
  SELECT
    idempotency_key,
    payload_json,
    status,
    attempt_count,
    next_attempt_at,
    lease_token,
    lease_expires_at,
    client_id,
    property_id,
    request_id,
    note_id,
    last_error_code
  FROM angi_utah_jobber_deliveries
  WHERE idempotency_key = ?
`;

const REQUEUE_VALIDATION_REVIEW_SQL = `
  /* angi_router:requeue_validation_review */
  UPDATE angi_utah_jobber_deliveries
  SET
    payload_json = ?,
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = ?,
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
    updated_at = ?
  WHERE idempotency_key = ?
    AND status = 'needs_review'
    AND last_error_code IN (
      'invalid_source_event_time',
      'invalid_source',
      'invalid_utah_state',
      'invalid_utah_zip',
      'invalid_lead_fields'
    )
`;

const SELECT_DRAINABLE_SQL = `
  /* angi_router:select_drainable */
  SELECT idempotency_key
  FROM angi_utah_jobber_deliveries
  WHERE status IN (
    'pending',
    'processing',
    'client_creating',
    'client_created',
    'request_creating',
    'request_created',
    'note_creating',
    'failed_retryable'
  )
    AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
  ORDER BY created_at ASC
  LIMIT ?
`;

const CLAIM_RECONCILIATION_SQL = `
  /* angi_router:claim_reconciliation */
  UPDATE angi_utah_jobber_deliveries
  SET
    attempt_count = attempt_count + 1,
    lease_token = ?,
    lease_expires_at = ?,
    updated_at = ?
  WHERE idempotency_key = ?
    AND status IN ('client_creating', 'request_creating', 'note_creating')
    AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
`;

const CLAIM_DELIVERY_SQL = `
  /* angi_router:claim */
  UPDATE angi_utah_jobber_deliveries
  SET
    status = CASE
      WHEN status IN ('pending', 'failed_retryable') THEN 'processing'
      ELSE status
    END,
    attempt_count = attempt_count + 1,
    lease_token = ?,
    lease_expires_at = ?,
    last_error_code = NULL,
    updated_at = ?
  WHERE idempotency_key = ?
    AND status IN (
      'pending',
      'processing',
      'client_created',
      'request_created',
      'failed_retryable'
    )
    AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
`;

const MARK_CLIENT_CREATING_SQL = `
  /* angi_router:client_creating */
  UPDATE angi_utah_jobber_deliveries
  SET status = 'client_creating', updated_at = ?
  WHERE idempotency_key = ? AND lease_token = ? AND status = 'processing'
`;

const MARK_CLIENT_CREATED_SQL = `
  /* angi_router:client_created */
  UPDATE angi_utah_jobber_deliveries
  SET
    status = 'client_created',
    client_id = ?,
    property_id = ?,
    updated_at = ?
  WHERE idempotency_key = ? AND lease_token = ? AND status = 'client_creating'
`;

const MARK_REQUEST_CREATING_SQL = `
  /* angi_router:request_creating */
  UPDATE angi_utah_jobber_deliveries
  SET status = 'request_creating', updated_at = ?
  WHERE idempotency_key = ? AND lease_token = ? AND status = 'client_created'
`;

const MARK_REQUEST_CREATED_SQL = `
  /* angi_router:request_created */
  UPDATE angi_utah_jobber_deliveries
  SET
    status = 'request_created',
    request_id = ?,
    updated_at = ?
  WHERE idempotency_key = ? AND lease_token = ? AND status = 'request_creating'
`;

const MARK_NOTE_CREATING_SQL = `
  /* angi_router:note_creating */
  UPDATE angi_utah_jobber_deliveries
  SET status = 'note_creating', updated_at = ?
  WHERE idempotency_key = ? AND lease_token = ? AND status = 'request_created'
`;

const MARK_COMPLETED_SQL = `
  /* angi_router:completed */
  UPDATE angi_utah_jobber_deliveries
  SET
    status = 'completed',
    request_id = ?,
    note_id = ?,
    payload_json = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = NULL,
    last_error_code = NULL,
    completed_at = ?,
    updated_at = ?
  WHERE idempotency_key = ?
    AND lease_token = ?
    AND status IN ('request_created', 'note_creating')
`;

const SCHEDULE_RETRY_SQL = `
  /* angi_router:schedule_retry */
  UPDATE angi_utah_jobber_deliveries
  SET
    status = ?,
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = ?,
    last_error_code = ?,
    updated_at = ?
  WHERE idempotency_key = ? AND lease_token = ? AND status = ?
`;

const MARK_INDETERMINATE_SQL = `
  /* angi_router:indeterminate */
  UPDATE angi_utah_jobber_deliveries
  SET
    status = 'needs_review',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = NULL,
    last_error_code = ?,
    updated_at = ?
  WHERE idempotency_key = ? AND lease_token = ?
`;

const MARK_MAX_ATTEMPTS_SQL = `
  /* angi_router:max_attempts */
  UPDATE angi_utah_jobber_deliveries
  SET
    status = 'needs_review',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = NULL,
    last_error_code = 'max_attempts_exceeded',
    updated_at = ?
  WHERE idempotency_key = ? AND status != 'completed'
`;

const ENSURE_PROCESS_LOCK_SQL = `
  /* angi_router:ensure_process_lock */
  INSERT OR IGNORE INTO angi_router_locks (
    lock_name,
    lease_token,
    lease_expires_at,
    updated_at
  ) VALUES (?, NULL, NULL, ?)
`;

const ACQUIRE_PROCESS_LOCK_SQL = `
  /* angi_router:acquire_process_lock */
  UPDATE angi_router_locks
  SET lease_token = ?, lease_expires_at = ?, updated_at = ?
  WHERE lock_name = ?
    AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
`;

const RELEASE_PROCESS_LOCK_SQL = `
  /* angi_router:release_process_lock */
  UPDATE angi_router_locks
  SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?
  WHERE lock_name = ? AND lease_token = ?
`;

const SELECT_JOBBER_AUTH_SQL = `
  /* angi_router:select_jobber_auth */
  SELECT access_token, access_expires_at, refresh_token
  FROM angi_router_jobber_auth
  WHERE account_key = ?
`;

const UPSERT_JOBBER_AUTH_SQL = `
  /* angi_router:upsert_jobber_auth */
  INSERT INTO angi_router_jobber_auth (
    account_key,
    access_token,
    access_expires_at,
    refresh_token,
    updated_at
  ) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(account_key) DO UPDATE SET
    access_token = excluded.access_token,
    access_expires_at = excluded.access_expires_at,
    refresh_token = excluded.refresh_token,
    updated_at = excluded.updated_at
`;

const INVALIDATE_JOBBER_ACCESS_SQL = `
  /* angi_router:invalidate_jobber_access */
  UPDATE angi_router_jobber_auth
  SET access_token = NULL, access_expires_at = NULL, updated_at = ?
  WHERE account_key = ?
`;

const REDACT_EXPIRED_REVIEW_SQL = `
  /* angi_router:redact_expired_review */
  UPDATE angi_utah_jobber_deliveries
  SET payload_json = NULL
  WHERE status = 'needs_review'
    AND payload_json IS NOT NULL
    AND updated_at < ?
`;

const STATUS_COUNTS_SQL = `
  /* angi_router:status_counts */
  SELECT status, COUNT(*) AS count
  FROM angi_utah_jobber_deliveries
  GROUP BY status
`;

const REVIEW_ITEMS_SQL = `
  /* angi_router:review_items */
  SELECT idempotency_key, last_error_code, updated_at, attempt_count
  FROM angi_utah_jobber_deliveries
  WHERE status = 'needs_review'
  ORDER BY updated_at ASC
  LIMIT 100
`;

class AngiRouterError extends Error {
  constructor(code, status = 503, { retryable = status >= 500 } = {}) {
    super(code);
    this.name = "AngiRouterError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function cleanScalar(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function cleanText(value, max = 2000) {
  return cleanScalar(value, max).replace(/\s+/g, " ").trim();
}

function getJobberConnectionConfig(env) {
  const sourceRoutingEnabled = env.ANGI_SOURCE_ROUTING_ENABLED === true
    || env.ANGI_SOURCE_ROUTING_ENABLED === "true";

  if (sourceRoutingEnabled) {
    return {
      authAccountKey: ANGI_JOBBER_AUTH_ACCOUNT_KEY,
      processLockName: ANGI_JOBBER_PROCESS_LOCK_NAME,
      clientId: cleanScalar(env.JOBBER_CLIENT_ID_ANGI, 500),
      clientSecret: cleanScalar(env.JOBBER_CLIENT_SECRET_ANGI, 1000),
      refreshTokenEnvKey: "JOBBER_REFRESH_TOKEN_ANGI_SLC",
      refreshToken: cleanScalar(env.JOBBER_REFRESH_TOKEN_ANGI_SLC, 4000),
    };
  }

  return {
    authAccountKey: LEGACY_JOBBER_AUTH_ACCOUNT_KEY,
    processLockName: LEGACY_JOBBER_PROCESS_LOCK_NAME,
    clientId: cleanScalar(env.JOBBER_CLIENT_ID_SLC, 500)
      || cleanScalar(env.JOBBER_CLIENT_ID, 500),
    clientSecret: cleanScalar(env.JOBBER_CLIENT_SECRET_SLC, 1000)
      || cleanScalar(env.JOBBER_CLIENT_SECRET, 1000),
    refreshTokenEnvKey: "JOBBER_REFRESH_TOKEN_SLC",
    refreshToken: cleanScalar(env.JOBBER_REFRESH_TOKEN_SLC, 4000),
  };
}

function normalizePhone(value) {
  const digits = cleanScalar(value, 40).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.slice(0, 10);
}

function normalizeZip(value) {
  return cleanScalar(value, 20).replace(/\D/g, "").slice(0, 5);
}

function normalizeState(value) {
  const state = cleanScalar(value, 20).toLowerCase().replace(/[^a-z]/g, "");
  if (state === "ut" || state === "utah") return "UT";
  return cleanScalar(value, 20).toUpperCase();
}

function normalizeLeadSource(value) {
  const source = cleanScalar(value, 80);
  const canonical = source.toLowerCase().replace(/[^a-z]/g, "");
  if (
    canonical === "angi"
    || canonical === "angieslist"
    || canonical === "homeadvisor"
  ) return "AngiesList";
  return source;
}

function normalizeSourceEventTime(payload, receivedAt) {
  const raw = firstValue(payload, [
    "eventTimestamp",
    "event_timestamp",
    "leadCreatedAt",
    "lead_created_at",
    "createdAt",
    "created_at",
  ]);
  if (raw === "" || raw === null || raw === undefined) {
    return {
      sourceEventProvided: false,
      sourceEventValid: true,
      sourceEventAt: "",
      receivedAt: new Date(receivedAt).toISOString(),
    };
  }

  let timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    timestamp = raw < 10_000_000_000 ? raw * 1000 : raw;
  } else {
    timestamp = Date.parse(cleanScalar(raw, 100));
  }
  const valid = Number.isFinite(timestamp)
    && timestamp >= Date.UTC(2020, 0, 1)
    && timestamp <= receivedAt + (24 * 60 * 60 * 1000);
  return {
    sourceEventProvided: true,
    sourceEventValid: valid,
    sourceEventAt: valid ? new Date(timestamp).toISOString() : "",
    receivedAt: new Date(receivedAt).toISOString(),
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function errorResponse(code, status, retryable = status >= 500) {
  const headers = retryable ? { "Retry-After": String(RETRY_AFTER_SECONDS) } : {};
  return jsonResponse({ ok: false, status: code }, status, headers);
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function getPresentedSecret(request) {
  const authorization = cleanScalar(request.headers.get("authorization"), 2000);
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  return bearer || cleanScalar(request.headers.get("x-good-attic-webhook-secret"), 2000);
}

function requireRouterAuth(request, env) {
  const expected = cleanScalar(env[WEBHOOK_SECRET_ENV_KEY], 2000);
  if (!expected) throw new AngiRouterError("router_not_configured", 503);
  if (!constantTimeEqual(getPresentedSecret(request), expected)) {
    throw new AngiRouterError("unauthorized", 401, { retryable: false });
  }
}

function requireRouterAccess(request, env) {
  requireRouterAuth(request, env);
  if (env[ENABLED_ENV_KEY] !== "true") {
    throw new AngiRouterError("router_disabled", 503);
  }
}

function getCutoverTimestamp(env) {
  const configured = cleanScalar(env[CUTOVER_AT_ENV_KEY], 100);
  if (!configured) throw new AngiRouterError("cutover_not_configured", 503);
  const cutoverAt = Date.parse(configured);
  if (!Number.isFinite(cutoverAt)) {
    throw new AngiRouterError("cutover_not_configured", 503);
  }
  return cutoverAt;
}

function isBeforeCutover(env, now = Date.now()) {
  return now < getCutoverTimestamp(env);
}

function selectAngiPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const candidates = [
    payload,
    payload.inboundWebhookRequest,
    payload.angi,
    payload.customData,
  ];
  return candidates.find((candidate) => (
    candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && (
      candidate.leadOid !== undefined
      || candidate.lead_oid !== undefined
      || candidate.spEntityId !== undefined
      || candidate.sp_entity_id !== undefined
    )
  )) || payload;
}

function firstValue(payload, names) {
  for (const name of names) {
    if (payload[name] !== undefined && payload[name] !== null) return payload[name];
  }
  return "";
}

function normalizeInterview(value) {
  if (!Array.isArray(value)) return "";
  return value
    .slice(0, 20)
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const question = cleanText(item.question, 180);
      const answer = cleanText(item.answer, 300);
      return [question, answer].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);
}

function normalizeAngiPayload(rawPayload, receivedAt = Date.now()) {
  const payload = selectAngiPayload(rawPayload);
  const firstName = cleanText(firstValue(payload, ["firstName", "first_name"]), 80);
  const lastName = cleanText(firstValue(payload, ["lastName", "last_name"]), 80);
  const suppliedName = cleanText(firstValue(payload, ["name", "fullName", "full_name"]), 160);
  const comments = cleanText(firstValue(payload, ["comments", "notes"]), 1200);
  const description = cleanText(firstValue(payload, ["leadDescription", "lead_description"]), 600);
  const interview = normalizeInterview(payload.interview);

  return {
    leadSource: normalizeLeadSource(firstValue(payload, ["leadSource", "lead_source"])),
    spEntityId: cleanScalar(firstValue(payload, ["spEntityId", "sp_entity_id"]), 32),
    leadOid: cleanScalar(firstValue(payload, ["leadOid", "lead_oid"]), 40),
    firstName,
    lastName,
    fullName: suppliedName || [firstName, lastName].filter(Boolean).join(" "),
    phone: normalizePhone(firstValue(payload, ["primaryPhone", "phone", "primary_phone"])),
    email: cleanText(firstValue(payload, ["email", "emailAddress", "email_address"]), 160),
    address: cleanText(firstValue(payload, ["address", "streetAddress", "street_address"]), 240),
    city: cleanText(payload.city, 120),
    state: normalizeState(firstValue(payload, ["stateProvince", "state", "state_province"])),
    zip: normalizeZip(firstValue(payload, ["postalCode", "zip", "postal_code"])),
    taskName: cleanText(firstValue(payload, ["taskName", "task_name", "service"]), 160),
    notes: [comments, description, interview].filter(Boolean).join("\n").slice(0, 2000),
    ...normalizeSourceEventTime(payload, receivedAt),
  };
}

function evaluateGate(angi) {
  if (angi.leadSource.toLowerCase() !== "angieslist") return "non_angi_source";
  if (angi.spEntityId !== EXPECTED_ANGI_ENTITY_ID) return "non_utah_entity";
  if (angi.state !== "UT") return "non_utah_state";
  if (!/^84\d{3}$/.test(angi.zip)) return "non_utah_zip";
  return "";
}

function validateAngiLead(angi) {
  const missing = [];
  if (!/^\d{5,24}$/.test(angi.leadOid)) missing.push("lead_oid");
  if (!angi.fullName) missing.push("name");
  if (angi.phone.length !== 10) missing.push("phone");
  if (angi.email && !angi.email.includes("@")) missing.push("email");
  if (!angi.address) missing.push("address");
  if (!angi.city) missing.push("city");
  return missing;
}

function buildRequestTitle(angi) {
  const marker = `[Angi ${angi.leadOid}]`;
  const service = cleanText(angi.taskName, 160) || "Attic assessment";
  const availableServiceLength = Math.max(1, 160 - marker.length - 1);
  return `${service.slice(0, availableServiceLength).trim()} ${marker}`;
}

function buildWebsiteLead(angi) {
  return leadHelpers.buildLead({
    first_name: angi.firstName,
    last_name: angi.lastName,
    name: angi.fullName,
    phone: angi.phone,
    email: angi.email,
    street_address: angi.address,
    city: angi.city,
    state: angi.state,
    zip: angi.zip,
    project_type_label: buildRequestTitle(angi),
    additional_notes: angi.notes,
    lead_source: "AngiesList",
    page_market: "ut",
  }, `angi:${angi.spEntityId}:${angi.leadOid}`);
}

function getDatabase(env) {
  const database = env[DATABASE_ENV_KEY];
  if (!database || typeof database.prepare !== "function") {
    throw new AngiRouterError("idempotency_store_not_configured", 503);
  }
  return database;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function runStatement(database, sql, bindings) {
  return database.prepare(sql).bind(...bindings).run();
}

async function readDelivery(database, idempotencyKey) {
  return database.prepare(SELECT_DELIVERY_SQL).bind(idempotencyKey).first();
}

async function acquireProcessLock(database, connection) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseToken = crypto.randomUUID();
  try {
    await runStatement(database, ENSURE_PROCESS_LOCK_SQL, [
      connection.processLockName,
      nowIso,
    ]);
    const acquired = await runStatement(database, ACQUIRE_PROCESS_LOCK_SQL, [
      leaseToken,
      now + PROCESS_LOCK_DURATION_MS,
      nowIso,
      connection.processLockName,
      now,
    ]);
    return changes(acquired) === 1 ? leaseToken : null;
  } catch {
    throw new AngiRouterError("process_lock_unavailable", 503);
  }
}

async function releaseProcessLock(database, leaseToken, connection) {
  if (!leaseToken) return;
  try {
    await runStatement(database, RELEASE_PROCESS_LOCK_SQL, [
      new Date().toISOString(),
      connection.processLockName,
      leaseToken,
    ]);
  } catch {
    // The short lease expires automatically; never expose tokens or PII in logs.
  }
}

async function readJobberAuth(database, connection) {
  return database
    .prepare(SELECT_JOBBER_AUTH_SQL)
    .bind(connection.authAccountKey)
    .first();
}

async function bootstrapRefreshToken(env, connection) {
  const tokenStore = env.JOBBER_TOKEN_STORE;
  if (tokenStore && typeof tokenStore.get === "function") {
    const stored = cleanScalar(
      await tokenStore.get(`jobber_refresh_token:${connection.refreshTokenEnvKey}`),
      4000,
    );
    if (stored) return stored;
  }
  return connection.refreshToken;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function persistJobberAuth(
  database,
  connection,
  accessToken,
  accessExpiresAt,
  refreshToken,
) {
  const result = await runStatement(database, UPSERT_JOBBER_AUTH_SQL, [
    connection.authAccountKey,
    accessToken,
    accessExpiresAt,
    refreshToken,
    new Date().toISOString(),
  ]);
  if (changes(result) !== 1) {
    throw new AngiRouterError("jobber_token_checkpoint_failed", 503);
  }
}

async function refreshJobberAccess(database, env, connection, existingAuth) {
  const clientId = connection.clientId;
  const clientSecret = connection.clientSecret;
  const refreshToken = cleanScalar(existingAuth?.refresh_token, 4000)
    || await bootstrapRefreshToken(env, connection);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new AngiRouterError("jobber_auth_not_configured", 503);
  }

  let response;
  try {
    response = await fetch(JOBBER_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
  } catch {
    throw new AngiRouterError("jobber_token_refresh_failed", 503);
  }

  const data = await safeJson(response);
  if (!response.ok || !data?.access_token) {
    throw new AngiRouterError("jobber_token_refresh_failed", 503);
  }

  const nextRefreshToken = cleanScalar(data.refresh_token, 4000) || refreshToken;
  const expiresInSeconds = Math.max(60, Math.min(7200, Number(data.expires_in) || 3600));
  const accessExpiresAt = Date.now() + (expiresInSeconds * 1000);
  await persistJobberAuth(
    database,
    connection,
    cleanScalar(data.access_token, 4000),
    accessExpiresAt,
    nextRefreshToken,
  );
  return cleanScalar(data.access_token, 4000);
}

async function getJobberAccess(
  database,
  env,
  connection,
  { forceRefresh = false } = {},
) {
  const auth = await readJobberAuth(database, connection);
  if (
    !forceRefresh
    && auth?.access_token
    && Number(auth.access_expires_at || 0) > Date.now() + 60_000
  ) {
    return cleanScalar(auth.access_token, 4000);
  }
  return refreshJobberAccess(database, env, connection, auth);
}

async function invalidateJobberAccess(database, connection) {
  await runStatement(database, INVALIDATE_JOBBER_ACCESS_SQL, [
    new Date().toISOString(),
    connection.authAccountKey,
  ]);
}

async function listDrainable(database, limit) {
  const now = Date.now();
  const result = await database
    .prepare(SELECT_DRAINABLE_SQL)
    .bind(now, now, limit)
    .all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function buildIdempotencyKey(angi) {
  if (/^\d{5,24}$/.test(angi.leadOid)) {
    return `${angi.spEntityId}:${angi.leadOid}`;
  }
  const keyMaterial = { ...angi };
  delete keyMaterial.receivedAt;
  return `quarantine:${angi.spEntityId}:${await sha256Hex(JSON.stringify(keyMaterial))}`;
}

async function enqueueDelivery(
  database,
  angi,
  { status = "pending", errorCode = null } = {},
) {
  const key = await buildIdempotencyKey(angi);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  try {
    await runStatement(database, INSERT_DELIVERY_SQL, [
      key,
      JSON.stringify(angi),
      status,
      now,
      errorCode,
      nowIso,
      nowIso,
    ]);
    if (status === "pending") {
      await runStatement(database, REQUEUE_VALIDATION_REVIEW_SQL, [
        JSON.stringify(angi),
        now,
        nowIso,
        key,
      ]);
    }
    const record = await readDelivery(database, key);
    if (!record) throw new Error("missing_delivery");
    return record;
  } catch {
    throw new AngiRouterError("idempotency_store_unavailable", 503);
  }
}

async function claimDelivery(database, idempotencyKey) {
  const now = Date.now();
  let record;
  try {
    record = await readDelivery(database, idempotencyKey);
    if (!record) return { kind: "missing" };
    if (record.status === "completed") return { kind: "completed" };
    if (record.status === "needs_review") return { kind: "indeterminate" };
    if (Number(record.attempt_count || 0) >= MAX_DELIVERY_ATTEMPTS) {
      await runStatement(database, MARK_MAX_ATTEMPTS_SQL, [
        new Date(now).toISOString(),
        idempotencyKey,
      ]);
      return { kind: "indeterminate" };
    }
    if (Number(record.next_attempt_at || 0) > now) return { kind: "deferred" };
    if (Number(record.lease_expires_at || 0) > now) return { kind: "busy" };

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = now + LEASE_DURATION_MS;
    const reconciliation = [
      "client_creating",
      "request_creating",
      "note_creating",
    ].includes(record.status);
    const claimed = await runStatement(
      database,
      reconciliation ? CLAIM_RECONCILIATION_SQL : CLAIM_DELIVERY_SQL,
      [
      leaseToken,
      leaseExpiresAt,
      new Date(now).toISOString(),
      idempotencyKey,
      now,
      ...(reconciliation ? [] : [now]),
      ],
    );
    if (changes(claimed) !== 1) return { kind: "busy" };

    record = await readDelivery(database, idempotencyKey);
    if (!record || record.lease_token !== leaseToken) return { kind: "busy" };
    return { kind: "acquired", leaseToken, record };
  } catch (error) {
    if (error instanceof AngiRouterError) throw error;
    throw new AngiRouterError("idempotency_store_unavailable", 503);
  }
}

async function requireStateChange(database, sql, bindings, code) {
  try {
    const result = await runStatement(database, sql, bindings);
    if (changes(result) !== 1) throw new Error("state_conflict");
  } catch {
    throw new AngiRouterError(code, 503);
  }
}

async function markClientCreating(database, key, leaseToken) {
  await requireStateChange(
    database,
    MARK_CLIENT_CREATING_SQL,
    [new Date().toISOString(), key, leaseToken],
    "idempotency_checkpoint_failed",
  );
}

async function markClientCreated(database, key, leaseToken, clientId, propertyId) {
  await requireStateChange(
    database,
    MARK_CLIENT_CREATED_SQL,
    [clientId, propertyId || null, new Date().toISOString(), key, leaseToken],
    "idempotency_checkpoint_failed",
  );
}

async function markRequestCreating(database, key, leaseToken) {
  await requireStateChange(
    database,
    MARK_REQUEST_CREATING_SQL,
    [new Date().toISOString(), key, leaseToken],
    "idempotency_checkpoint_failed",
  );
}

async function markRequestCreated(database, key, leaseToken, requestId) {
  await requireStateChange(
    database,
    MARK_REQUEST_CREATED_SQL,
    [requestId, new Date().toISOString(), key, leaseToken],
    "request_checkpoint_failed",
  );
}

async function markNoteCreating(database, key, leaseToken) {
  await requireStateChange(
    database,
    MARK_NOTE_CREATING_SQL,
    [new Date().toISOString(), key, leaseToken],
    "note_checkpoint_failed",
  );
}

async function markCompleted(database, key, leaseToken, requestId, noteId) {
  const timestamp = new Date().toISOString();
  await requireStateChange(
    database,
    MARK_COMPLETED_SQL,
    [requestId, noteId || null, timestamp, timestamp, key, leaseToken],
    "idempotency_completion_failed",
  );
}

function retryDelayMs(attemptCount) {
  return Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(attemptCount, 7)));
}

async function scheduleRetry(
  database,
  record,
  leaseToken,
  currentStatus,
  nextStatus,
  errorCode,
) {
  const now = Date.now();
  try {
    const result = await runStatement(database, SCHEDULE_RETRY_SQL, [
      nextStatus,
      now + retryDelayMs(Number(record.attempt_count || 1)),
      errorCode,
      new Date(now).toISOString(),
      record.idempotency_key,
      leaseToken,
      currentStatus,
    ]);
    return changes(result) === 1;
  } catch {
    return false;
  }
}

async function markIndeterminate(database, record, leaseToken, errorCode) {
  try {
    await runStatement(database, MARK_INDETERMINATE_SQL, [
      errorCode,
      new Date().toISOString(),
      record.idempotency_key,
      leaseToken,
    ]);
  } catch {
    // Keeping an uncertain stage non-drainable is safer than risking a duplicate write.
  }
}

class JobberMutationError extends Error {
  constructor(outcome) {
    super(outcome);
    this.name = "JobberMutationError";
    this.outcome = outcome;
  }
}

async function createJobberClientOnce(env, accessToken, lead) {
  let result;
  try {
    result = await leadHelpers.jobberGraphql(
      env,
      accessToken,
      JOBBER_CLIENT_CREATE_MUTATION,
      { input: leadHelpers.buildClientInput(lead, { includePhone: true }) },
    );
  } catch (error) {
    const partial = error?.details?.response?.data?.clientCreate;
    if (partial?.client?.id && !partial?.userErrors?.length) {
      return partial.client;
    }
    // HTTP/network/top-level GraphQL failures can include a committed mutation.
    throw new JobberMutationError("ambiguous");
  }
  const payload = result?.data?.clientCreate;
  if (payload?.userErrors?.length) throw new JobberMutationError("rejected");
  if (!payload?.client?.id) throw new JobberMutationError("ambiguous");
  return payload.client;
}

async function createJobberRequestOnce(env, accessToken, lead, clientId, propertyId) {
  let result;
  try {
    result = await leadHelpers.jobberGraphql(
      env,
      accessToken,
      JOBBER_REQUEST_CREATE_MUTATION,
      {
        input: leadHelpers.buildRequestInput(lead, clientId, propertyId),
      },
    );
  } catch (error) {
    const partial = error?.details?.response?.data?.requestCreate;
    if (partial?.request?.id && !partial?.userErrors?.length) {
      return partial.request;
    }
    // Never repeat until the unique request marker has been reconciled.
    throw new JobberMutationError("ambiguous");
  }
  const payload = result?.data?.requestCreate;
  if (payload?.userErrors?.length) throw new JobberMutationError("rejected");
  if (!payload?.request?.id) throw new JobberMutationError("ambiguous");
  return payload.request;
}

async function getVerifiedUtahAccess(env, database, connection) {
  let accessToken = await getJobberAccess(database, env, connection);
  let result;
  try {
    result = await leadHelpers.jobberGraphql(
      env,
      accessToken,
      JOBBER_ACCOUNT_QUERY,
      {},
    );
  } catch {
    await invalidateJobberAccess(database, connection);
    accessToken = await getJobberAccess(
      database,
      env,
      connection,
      { forceRefresh: true },
    );
    result = await leadHelpers.jobberGraphql(
      env,
      accessToken,
      JOBBER_ACCOUNT_QUERY,
      {},
    );
  }
  if (result?.data?.account?.id !== EXPECTED_JOBBER_ACCOUNT_ID) {
    throw new AngiRouterError("jobber_account_mismatch", 503);
  }
  return accessToken;
}

async function checkUtahJobberAuthorization(env, database) {
  const connection = getJobberConnectionConfig(env);
  const processLease = await acquireProcessLock(database, connection);
  if (!processLease) return "busy";

  try {
    await getVerifiedUtahAccess(env, database, connection);
    return "verified";
  } finally {
    await releaseProcessLock(database, processLease, connection);
  }
}

async function findExistingAngiRequest(env, accessToken, clientId, expectedTitle) {
  try {
    const result = await leadHelpers.jobberGraphql(
      env,
      accessToken,
      JOBBER_CLIENT_REQUESTS_QUERY,
      { clientId },
    );
    const matches = (result?.data?.client?.requests?.nodes || [])
      .filter((request) => request?.title === expectedTitle && request?.id);
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

function buildNoteMarker(angi) {
  return `[Angi Lead ${angi.spEntityId}:${angi.leadOid}]`;
}

function buildRequestNote(angi) {
  const address = [angi.address, angi.city, angi.state, angi.zip].filter(Boolean).join(", ");
  return [
    "Good Attic internal Angi lead",
    `Marker: ${buildNoteMarker(angi)}`,
    `Source: ${angi.leadSource}`,
    `Provider entity ID: ${angi.spEntityId}`,
    `Angi lead ID: ${angi.leadOid}`,
    `Service: ${angi.taskName || "Attic assessment"}`,
    `Service address: ${address}`,
    `Customer comments / interview: ${angi.notes || "None provided"}`,
  ].join("\n").slice(0, 4000);
}

async function findExistingAngiRequestNote(env, accessToken, requestId, marker) {
  try {
    const result = await leadHelpers.jobberGraphql(
      env,
      accessToken,
      JOBBER_REQUEST_NOTES_QUERY,
      { requestId },
    );
    const matches = (result?.data?.request?.notes?.nodes || [])
      .filter((note) => note?.id && cleanScalar(note?.message, 4000).includes(marker));
    return { checked: true, note: matches.length === 1 ? matches[0] : null };
  } catch {
    return { checked: false, note: null };
  }
}

async function createAngiRequestNote(env, accessToken, requestId, message) {
  const result = await leadHelpers.jobberGraphql(
    env,
    accessToken,
    JOBBER_REQUEST_NOTE_CREATE_MUTATION,
    {
      requestId,
      input: { message },
    },
  );
  const userErrors = result?.data?.requestCreateNote?.userErrors || [];
  if (userErrors.length) {
    const error = new AngiRouterError("jobber_note_rejected", 503);
    error.definiteRejection = true;
    throw error;
  }
  const note = result?.data?.requestCreateNote?.requestNote;
  if (!note?.id) throw new AngiRouterError("jobber_note_result_indeterminate", 503);
  return note;
}

function parseStoredLead(record) {
  try {
    const lead = JSON.parse(record.payload_json);
    if (!lead || typeof lead !== "object") throw new Error("invalid");
    return lead;
  } catch {
    throw new AngiRouterError("stored_payload_invalid", 503);
  }
}

async function finishCompletionWithRetries(
  database,
  record,
  leaseToken,
  requestId,
  noteId,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await markCompleted(
        database,
        record.idempotency_key,
        leaseToken,
        requestId,
        noteId,
      );
      return true;
    } catch {
      // Retry the D1 checkpoint only; never repeat the successful Jobber mutation.
    }
  }
  await markIndeterminate(
    database,
    record,
    leaseToken,
    "idempotency_completion_failed",
  );
  return false;
}

async function addNoteAndComplete(
  env,
  database,
  record,
  leaseToken,
  accessToken,
  angi,
  requestId,
  currentStatus,
  freshRequest,
) {
  try {
    await enqueueFieldflowAttribution(
      database,
      record.idempotency_key,
      angi,
      requestId,
    );
  } catch {
    // Fieldflow is an independent analytics sink. A D1/outbox failure must
    // never cause a successful Jobber request or note mutation to be repeated.
    console.error("Fieldflow Angi attribution enqueue failed", {
      code: "fieldflow_outbox_enqueue_failed",
    });
  }

  const marker = buildNoteMarker(angi);
  const message = buildRequestNote(angi);

  if (!freshRequest) {
    const lookup = await findExistingAngiRequestNote(
      env,
      accessToken,
      requestId,
      marker,
    );
    if (!lookup.checked) {
      const queued = await scheduleRetry(
        database,
        record,
        leaseToken,
        currentStatus,
        "request_created",
        "jobber_note_lookup_failed",
      );
      return queued ? "queued" : "reconciliation_required";
    }
    if (lookup.note?.id) {
      return await finishCompletionWithRetries(
        database,
        record,
        leaseToken,
        requestId,
        lookup.note.id,
      )
        ? "created"
        : "created_completion_pending";
    }
    if (currentStatus === "note_creating") {
      const queued = await scheduleRetry(
        database,
        record,
        leaseToken,
        currentStatus,
        "request_created",
        "jobber_note_not_observed",
      );
      return queued ? "queued" : "reconciliation_required";
    }
  }

  try {
    await markNoteCreating(database, record.idempotency_key, leaseToken);
  } catch {
    const queued = await scheduleRetry(
      database,
      record,
      leaseToken,
      "request_created",
      "request_created",
      "note_checkpoint_failed",
    );
    return queued ? "queued" : "reconciliation_required";
  }

  let note;
  try {
    note = await createAngiRequestNote(env, accessToken, requestId, message);
  } catch (error) {
    const lookup = await findExistingAngiRequestNote(
      env,
      accessToken,
      requestId,
      marker,
    );
    if (lookup.note?.id) {
      return await finishCompletionWithRetries(
        database,
        record,
        leaseToken,
        requestId,
        lookup.note.id,
      )
        ? "created"
        : "created_completion_pending";
    }
    const queued = await scheduleRetry(
      database,
      record,
      leaseToken,
      "note_creating",
      "request_created",
      error?.definiteRejection ? "jobber_note_rejected" : "jobber_note_result_indeterminate",
    );
    return queued ? "queued" : "reconciliation_required";
  }

  return await finishCompletionWithRetries(
    database,
    record,
    leaseToken,
    requestId,
    note.id,
  )
    ? "created"
    : "created_completion_pending";
}

async function processClaim(env, database, claim, connection) {
  const record = claim.record;
  const leaseToken = claim.leaseToken;
  const angi = parseStoredLead(record);
  const lead = buildWebsiteLead(angi);
  let currentStatus = record.status;
  let accessToken;

  try {
    accessToken = await getVerifiedUtahAccess(env, database, connection);
  } catch (error) {
    const queued = await scheduleRetry(
      database,
      record,
      leaseToken,
      currentStatus,
      currentStatus === "processing" ? "failed_retryable" : currentStatus,
      error instanceof AngiRouterError ? error.code : "jobber_access_failed",
    );
    return queued ? "queued" : "reconciliation_required";
  }

  let clientId = cleanScalar(record.client_id, 500);
  let propertyId = cleanScalar(record.property_id, 500);
  let requestId = cleanScalar(record.request_id, 500);

  if (currentStatus === "client_creating") {
    await markIndeterminate(
      database,
      record,
      leaseToken,
      "jobber_client_result_requires_review",
    );
    return "reconciliation_required";
  }

  if (currentStatus === "request_creating") {
    const existingRequest = clientId
      ? await findExistingAngiRequest(env, accessToken, clientId, lead.service)
      : null;
    if (existingRequest?.id) {
      requestId = existingRequest.id;
      try {
        await markRequestCreated(
          database,
          record.idempotency_key,
          leaseToken,
          requestId,
        );
      } catch {
        return "reconciliation_required";
      }
      return addNoteAndComplete(
        env,
        database,
        record,
        leaseToken,
        accessToken,
        angi,
        requestId,
        "request_created",
        false,
      );
    }
    await markIndeterminate(
      database,
      record,
      leaseToken,
      "jobber_request_result_requires_review",
    );
    return "reconciliation_required";
  }

  if (currentStatus === "request_created" || currentStatus === "note_creating") {
    if (!requestId) {
      await markIndeterminate(
        database,
        record,
        leaseToken,
        "request_checkpoint_invalid",
      );
      return "reconciliation_required";
    }
    return addNoteAndComplete(
      env,
      database,
      record,
      leaseToken,
      accessToken,
      angi,
      requestId,
      currentStatus,
      false,
    );
  }

  if (currentStatus === "processing") {
    try {
      await markClientCreating(database, record.idempotency_key, leaseToken);
    } catch {
      return "queued";
    }
    currentStatus = "client_creating";

    let client;
    try {
      client = await createJobberClientOnce(env, accessToken, lead);
    } catch (error) {
      if (error?.outcome === "rejected") {
        const queued = await scheduleRetry(
          database,
          record,
          leaseToken,
          currentStatus,
          "failed_retryable",
          "jobber_client_rejected",
        );
        return queued ? "queued" : "reconciliation_required";
      }
      await markIndeterminate(
        database,
        record,
        leaseToken,
        "jobber_client_result_indeterminate",
      );
      return "reconciliation_required";
    }

    clientId = cleanScalar(client?.id, 500);
    propertyId = cleanScalar(client?.clientProperties?.nodes?.[0]?.id, 500);
    if (!clientId) {
      await markIndeterminate(
        database,
        record,
        leaseToken,
        "jobber_client_result_indeterminate",
      );
      return "reconciliation_required";
    }

    try {
      await markClientCreated(
        database,
        record.idempotency_key,
        leaseToken,
        clientId,
        propertyId,
      );
    } catch {
      await markIndeterminate(
        database,
        record,
        leaseToken,
        "client_checkpoint_indeterminate",
      );
      return "reconciliation_required";
    }
    currentStatus = "client_created";
  }

  if (currentStatus !== "client_created" || !clientId) {
    await markIndeterminate(
      database,
      record,
      leaseToken,
      "idempotency_state_invalid",
    );
    return "reconciliation_required";
  }

  try {
    await markRequestCreating(database, record.idempotency_key, leaseToken);
  } catch {
    const queued = await scheduleRetry(
      database,
      record,
      leaseToken,
      "client_created",
      "client_created",
      "request_checkpoint_failed",
    );
    return queued ? "queued" : "reconciliation_required";
  }

  let request;
  try {
    request = await createJobberRequestOnce(
      env,
      accessToken,
      lead,
      clientId,
      propertyId || null,
    );
  } catch (error) {
    if (error?.outcome === "rejected") {
      const queued = await scheduleRetry(
        database,
        record,
        leaseToken,
        "request_creating",
        "client_created",
        "jobber_request_rejected",
      );
      return queued ? "queued" : "reconciliation_required";
    }
    const existingRequest = await findExistingAngiRequest(
      env,
      accessToken,
      clientId,
      lead.service,
    );
    if (existingRequest?.id) {
      requestId = existingRequest.id;
      try {
        await markRequestCreated(
          database,
          record.idempotency_key,
          leaseToken,
          requestId,
        );
      } catch {
        return "reconciliation_required";
      }
      return addNoteAndComplete(
        env,
        database,
        record,
        leaseToken,
        accessToken,
        angi,
        requestId,
        "request_created",
        false,
      );
    }
    await markIndeterminate(
      database,
      record,
      leaseToken,
      "jobber_request_result_indeterminate",
    );
    return "reconciliation_required";
  }

  requestId = cleanScalar(request?.id, 500);
  if (!requestId) {
    await markIndeterminate(
      database,
      record,
      leaseToken,
      "jobber_request_result_indeterminate",
    );
    return "reconciliation_required";
  }

  try {
    await markRequestCreated(
      database,
      record.idempotency_key,
      leaseToken,
      requestId,
    );
  } catch {
    return "reconciliation_required";
  }

  return addNoteAndComplete(
    env,
    database,
    record,
    leaseToken,
    accessToken,
    angi,
    requestId,
    "request_created",
    true,
  );
}

async function processDeliveryByKey(env, database, idempotencyKey, connection) {
  const claim = await claimDelivery(database, idempotencyKey);
  if (claim.kind === "completed") return "duplicate";
  if (claim.kind === "indeterminate") return "reconciliation_required";
  if (["busy", "deferred"].includes(claim.kind)) return "queued";
  if (claim.kind !== "acquired") return "missing";
  return processClaim(env, database, claim, connection);
}

async function enqueueFieldflowAttribution(
  database,
  angiIdempotencyKey,
  angi,
  requestId,
) {
  const payload = buildAngiAttribution(angi, requestId);
  if (
    !payload.jobber_request_id
    || !payload.provider_lead_id
    || !payload.occurred_at
  ) {
    throw new Error("invalid_fieldflow_attribution");
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const result = await runStatement(database, INSERT_FIELDFLOW_OUTBOX_SQL, [
    `angi:${cleanScalar(angiIdempotencyKey, 500)}`,
    JSON.stringify(payload),
    now,
    nowIso,
    nowIso,
  ]);
  return changes(result) === 1 ? "created" : "duplicate";
}

async function listDrainableFieldflowAttribution(database) {
  const result = await database
    .prepare(SELECT_DRAINABLE_FIELDFLOW_OUTBOX_SQL)
    .bind(Date.now())
    .all();
  return Array.isArray(result?.results) ? result.results[0] || null : null;
}

function fieldflowFailureCode(result) {
  if (result?.status) return `http_${Number(result.status)}`;
  const reason = cleanScalar(result?.reason, 80).toLowerCase();
  return /^[a-z0-9_]{1,80}$/.test(reason)
    ? reason
    : "fieldflow_delivery_failed";
}

function fieldflowFailureIsRetryable(result) {
  const status = Number(result?.status || 0);
  return (
    result?.reason === "network_error"
    || status === 429
    || status >= 500
  );
}

async function drainFieldflowAttributionOutbox(env, database) {
  let row;
  try {
    row = await listDrainableFieldflowAttribution(database);
  } catch {
    return "unavailable";
  }
  if (!row) return "empty";

  const attempts = Number(row.attempt_count || 0) + 1;
  let payload;
  try {
    payload = JSON.parse(row.payload_json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("invalid");
    }
  } catch {
    await runStatement(database, MARK_FIELDFLOW_OUTBOX_REVIEW_SQL, [
      attempts,
      "invalid_outbox_payload",
      new Date().toISOString(),
      row.idempotency_key,
    ]);
    return "needs_review";
  }

  let result;
  try {
    result = await submitFieldflowAttribution(env, "ut", payload);
  } catch {
    result = {
      ok: false,
      attempts: 1,
      status: 0,
      reason: "network_error",
    };
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  if (result.ok) {
    await runStatement(database, MARK_FIELDFLOW_OUTBOX_SENT_SQL, [
      attempts,
      nowIso,
      nowIso,
      row.idempotency_key,
    ]);
    return "sent";
  }

  const errorCode = fieldflowFailureCode(result);
  if (
    fieldflowFailureIsRetryable(result)
    && attempts < MAX_FIELDFLOW_OUTBOX_ATTEMPTS
  ) {
    await runStatement(database, MARK_FIELDFLOW_OUTBOX_RETRY_SQL, [
      attempts,
      now + retryDelayMs(attempts),
      errorCode,
      nowIso,
      row.idempotency_key,
    ]);
    return "queued";
  }

  await runStatement(database, MARK_FIELDFLOW_OUTBOX_REVIEW_SQL, [
    attempts,
    attempts >= MAX_FIELDFLOW_OUTBOX_ATTEMPTS
      ? "max_attempts_exceeded"
      : errorCode,
    nowIso,
    row.idempotency_key,
  ]);
  return "needs_review";
}

async function cleanupRetainedDeliveries(database) {
  const now = Date.now();
  const reviewBefore = new Date(now - REVIEW_RETENTION_MS).toISOString();
  const reviewed = await runStatement(database, REDACT_EXPIRED_REVIEW_SQL, [reviewBefore]);
  return changes(reviewed);
}

async function getFieldflowStatusSummary(database) {
  try {
    const result = await database.prepare(FIELDFLOW_OUTBOX_STATUS_COUNTS_SQL).all();
    const counts = {};
    for (const row of result?.results || []) {
      const status = cleanScalar(row?.status, 80);
      if (status) counts[status] = Number(row?.count || 0);
    }
    return {
      counts,
      needs_review: Number(counts.needs_review || 0),
      unavailable: false,
    };
  } catch {
    return { counts: {}, needs_review: 0, unavailable: true };
  }
}

async function getStatusSummary(database) {
  const result = await database.prepare(STATUS_COUNTS_SQL).all();
  const counts = {};
  for (const row of result?.results || []) {
    const status = cleanScalar(row?.status, 80);
    if (status) counts[status] = Number(row?.count || 0);
  }
  return {
    counts,
    needs_review: Number(counts.needs_review || 0),
    fieldflow: await getFieldflowStatusSummary(database),
  };
}

async function getReviewItems(database) {
  const result = await database.prepare(REVIEW_ITEMS_SQL).all();
  return (result?.results || []).map((row) => ({
    idempotency_key: cleanScalar(row?.idempotency_key, 160),
    last_error_code: cleanScalar(row?.last_error_code, 120),
    updated_at: cleanScalar(row?.updated_at, 80),
    attempt_count: Number(row?.attempt_count || 0),
  }));
}

async function drainPendingDeliveries(env, database) {
  const summary = {
    scanned: 0,
    created: 0,
    queued: 0,
    reconciliation_required: 0,
    needs_review: 0,
    cleaned: 0,
    lock_busy: false,
    fieldflow: {
      scanned: 0,
      sent: 0,
      queued: 0,
      needs_review: 0,
      unavailable: false,
    },
  };

  const connection = getJobberConnectionConfig(env);
  const processLease = await acquireProcessLock(database, connection);
  if (!processLease) {
    summary.lock_busy = true;
    const statusSummary = await getStatusSummary(database);
    summary.needs_review = statusSummary.needs_review;
    summary.fieldflow.needs_review = statusSummary.fieldflow.needs_review;
    summary.fieldflow.unavailable = statusSummary.fieldflow.unavailable;
    return summary;
  }

  try {
    summary.cleaned = await cleanupRetainedDeliveries(database);
    const rows = await listDrainable(database, 1);
    summary.scanned = rows.length;
    if (rows.length) {
      const status = await processDeliveryByKey(
        env,
        database,
        rows[0].idempotency_key,
        connection,
      );
    if (status === "created" || status === "duplicate") summary.created += 1;
    else if (status === "reconciliation_required" || status === "created_completion_pending") {
      summary.reconciliation_required += 1;
    } else {
      summary.queued += 1;
    }
    }
    let fieldflowStatus;
    try {
      fieldflowStatus = await drainFieldflowAttributionOutbox(env, database);
    } catch {
      fieldflowStatus = "unavailable";
      console.error("Fieldflow Angi attribution drain failed", {
        code: "fieldflow_outbox_drain_failed",
      });
    }
    if (fieldflowStatus !== "empty") summary.fieldflow.scanned = 1;
    if (fieldflowStatus === "sent") summary.fieldflow.sent = 1;
    if (fieldflowStatus === "queued") summary.fieldflow.queued = 1;
    if (fieldflowStatus === "needs_review") summary.fieldflow.needs_review = 1;
    if (fieldflowStatus === "unavailable") summary.fieldflow.unavailable = true;
    const statusSummary = await getStatusSummary(database);
    summary.needs_review = statusSummary.needs_review;
    summary.fieldflow.needs_review = statusSummary.fieldflow.needs_review;
    summary.fieldflow.unavailable = statusSummary.fieldflow.unavailable;
    return summary;
  } finally {
    await releaseProcessLock(database, processLease, connection);
  }
}

export async function onRequestPost({ request, env }) {
  const receivedAt = Date.now();
  let cutoverAt;
  try {
    requireRouterAccess(request, env);
    cutoverAt = getCutoverTimestamp(env);
    if (receivedAt < cutoverAt) {
      return jsonResponse({
        ok: true,
        status: "ignored",
        reason: "before_cutover",
      }, 202);
    }
  } catch (error) {
    if (error instanceof AngiRouterError) {
      return errorResponse(error.code, error.status, error.retryable);
    }
    return errorResponse("unauthorized", 401, false);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("invalid_json", 400, false);
  }

  const angi = normalizeAngiPayload(payload, receivedAt);
  if (angi.spEntityId !== EXPECTED_ANGI_ENTITY_ID) {
    return jsonResponse({
      ok: true,
      status: "ignored",
      reason: "non_utah_entity",
    }, 202);
  }

  if (
    angi.sourceEventProvided
    && angi.sourceEventValid
    && Date.parse(angi.sourceEventAt) < cutoverAt
  ) {
    return jsonResponse({
      ok: true,
      status: "ignored",
      reason: "source_event_before_cutover",
    }, 202);
  }

  let database;
  let record;
  let quarantineReason = "";
  if (!angi.sourceEventValid) quarantineReason = "invalid_source_event_time";
  else if (angi.leadSource.toLowerCase() !== "angieslist") {
    quarantineReason = "invalid_source";
  } else if (angi.state !== "UT") quarantineReason = "invalid_utah_state";
  else if (!/^84\d{3}$/.test(angi.zip)) quarantineReason = "invalid_utah_zip";
  else if (validateAngiLead(angi).length) quarantineReason = "invalid_lead_fields";

  try {
    database = getDatabase(env);
    record = await enqueueDelivery(database, angi, {
      status: quarantineReason ? "needs_review" : "pending",
      errorCode: quarantineReason || null,
    });
  } catch (error) {
    if (error instanceof AngiRouterError) {
      return errorResponse(error.code, error.status, error.retryable);
    }
    return errorResponse("idempotency_store_unavailable", 503);
  }

  if (record.status === "completed") {
    return jsonResponse({ ok: true, status: "duplicate" });
  }
  return jsonResponse({
    ok: true,
    status: record.status === "needs_review" ? "needs_review" : "queued",
  }, 202);
}

export const _private = {
  EXPECTED_ANGI_ENTITY_ID,
  EXPECTED_JOBBER_ACCOUNT_ID,
  requireRouterAuth,
  requireRouterAccess,
  getCutoverTimestamp,
  isBeforeCutover,
  normalizeAngiPayload,
  evaluateGate,
  validateAngiLead,
  buildWebsiteLead,
  enqueueDelivery,
  claimDelivery,
  processDeliveryByKey,
  enqueueFieldflowAttribution,
  drainFieldflowAttributionOutbox,
  drainPendingDeliveries,
  checkUtahJobberAuthorization,
  getStatusSummary,
  getReviewItems,
  getDatabase,
  jsonResponse,
  errorResponse,
};
