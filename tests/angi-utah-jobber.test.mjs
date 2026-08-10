import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  _private as angiRouter,
  onRequestPost as handleAngiWebhook,
} from "../functions/api/ghl/angi-utah.js";
import { onRequestGet as handleAuthCheck } from "../functions/api/ghl/angi-utah-auth-check.js";
import { onRequestPost as handleDrain } from "../functions/api/ghl/angi-utah-drain.js";
import { onRequestGet as handleStatus } from "../functions/api/ghl/angi-utah-status.js";

const SECRET = "unit-test-secret-that-is-long-enough";
const UTAH_ACCOUNT_ID = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==";
const FIELDFLOW_BASE_URL = "https://fieldflow.example.test/api/integrations/highlevel/lead-attribution";
const FIELDFLOW_TOKEN = "fieldflow-unit-test-token";

const SAMPLE_ANGI_LEAD = {
  name: "Test Homeowner",
  firstName: "Test",
  lastName: "Homeowner",
  address: "123 Test Street",
  city: "Draper",
  stateProvince: "UT",
  postalCode: "84020",
  primaryPhone: "8015550101",
  email: "test-homeowner@example.test",
  leadOid: 635435743,
  spEntityId: 131399442,
  leadSource: "AngiesList",
  taskName: "Blown-In Insulation - Install or Upgrade",
  comments: "Please call before arriving.",
};

class FakeD1 {
  constructor() {
    this.records = new Map();
    this.fieldflowRecords = new Map();
    this.events = [];
    this.locks = new Map();
    this.auth = new Map();
  }

  prepare(sql) {
    const database = this;
    return {
      first: () => database.first(sql, []),
      all: () => database.all(sql, []),
      run: () => database.run(sql, []),
      bind(...bindings) {
        return {
          first: () => database.first(sql, bindings),
          all: () => database.all(sql, bindings),
          run: () => database.run(sql, bindings),
        };
      },
    };
  }

  async first(sql, bindings) {
    if (sql.includes("angi_router:select_jobber_auth")) {
      const record = this.auth.get(bindings[0]);
      return record ? { ...record } : null;
    }
    if (sql.includes("angi_router:select")) {
      const record = this.records.get(bindings[0]);
      return record ? { ...record } : null;
    }
    throw new Error("Unexpected first SQL");
  }

  async all(sql, bindings) {
    if (sql.includes("fieldflow_outbox:status_counts")) {
      const counts = new Map();
      for (const record of this.fieldflowRecords.values()) {
        counts.set(record.status, (counts.get(record.status) || 0) + 1);
      }
      return {
        results: [...counts].map(([status, count]) => ({ status, count })),
      };
    }
    if (sql.includes("fieldflow_outbox:select_drainable")) {
      const [nextAttemptCutoff] = bindings;
      const row = [...this.fieldflowRecords.values()]
        .filter((record) => (
          ["pending", "failed_retryable"].includes(record.status)
          && (record.next_attempt_at === null || record.next_attempt_at <= nextAttemptCutoff)
        ))
        .sort((left, right) => left.created_at.localeCompare(right.created_at))[0];
      return { results: row ? [{ ...row }] : [] };
    }
    if (sql.includes("angi_router:review_items")) {
      return {
        results: [...this.records.values()]
          .filter((record) => record.status === "needs_review")
          .sort((left, right) => left.updated_at.localeCompare(right.updated_at))
          .slice(0, 100)
          .map((record) => ({
            idempotency_key: record.idempotency_key,
            last_error_code: record.last_error_code,
            updated_at: record.updated_at,
            attempt_count: record.attempt_count,
          })),
      };
    }
    if (sql.includes("angi_router:status_counts")) {
      const counts = new Map();
      for (const record of this.records.values()) {
        counts.set(record.status, (counts.get(record.status) || 0) + 1);
      }
      return {
        results: [...counts].map(([status, count]) => ({ status, count })),
      };
    }
    if (!sql.includes("angi_router:select_drainable")) throw new Error("Unexpected all SQL");
    const [nextAttemptCutoff, leaseCutoff, limit] = bindings;
    const results = [...this.records.values()]
      .filter((record) => (
        [
          "pending",
          "processing",
          "client_creating",
          "client_created",
          "request_creating",
          "request_created",
          "note_creating",
          "failed_retryable",
        ].includes(record.status)
        && (record.next_attempt_at === null || record.next_attempt_at <= nextAttemptCutoff)
        && (record.lease_expires_at === null || record.lease_expires_at <= leaseCutoff)
      ))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(0, limit)
      .map((record) => ({ idempotency_key: record.idempotency_key }));
    return { results };
  }

  async run(sql, bindings) {
    if (sql.includes("fieldflow_outbox:insert")) {
      const [key, payloadJson, nextAttemptAt, createdAt, updatedAt] = bindings;
      if (this.fieldflowRecords.has(key)) return changed(0);
      this.fieldflowRecords.set(key, {
        idempotency_key: key,
        payload_json: payloadJson,
        status: "pending",
        attempt_count: 0,
        next_attempt_at: nextAttemptAt,
        last_error_code: null,
        created_at: createdAt,
        updated_at: updatedAt,
        sent_at: null,
      });
      this.events.push(`fieldflow_enqueued:${key}`);
      return changed(1);
    }

    if (sql.includes("fieldflow_outbox:sent")) {
      const [attemptCount, sentAt, updatedAt, key] = bindings;
      const record = this.fieldflowRecords.get(key);
      if (!record || !["pending", "failed_retryable"].includes(record.status)) {
        return changed(0);
      }
      record.status = "sent";
      record.attempt_count = attemptCount;
      record.next_attempt_at = null;
      record.last_error_code = null;
      record.sent_at = sentAt;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("fieldflow_outbox:retry")) {
      const [attemptCount, nextAttemptAt, errorCode, updatedAt, key] = bindings;
      const record = this.fieldflowRecords.get(key);
      if (!record || !["pending", "failed_retryable"].includes(record.status)) {
        return changed(0);
      }
      record.status = "failed_retryable";
      record.attempt_count = attemptCount;
      record.next_attempt_at = nextAttemptAt;
      record.last_error_code = errorCode;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("fieldflow_outbox:needs_review")) {
      const [attemptCount, errorCode, updatedAt, key] = bindings;
      const record = this.fieldflowRecords.get(key);
      if (!record || !["pending", "failed_retryable"].includes(record.status)) {
        return changed(0);
      }
      record.status = "needs_review";
      record.attempt_count = attemptCount;
      record.next_attempt_at = null;
      record.last_error_code = errorCode;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:requeue_validation_review")) {
      const [payloadJson, nextAttemptAt, updatedAt, key] = bindings;
      const record = this.records.get(key);
      const validationErrors = new Set([
        "invalid_source_event_time",
        "invalid_source",
        "invalid_utah_state",
        "invalid_utah_zip",
        "invalid_lead_fields",
      ]);
      if (
        !record
        || record.status !== "needs_review"
        || !validationErrors.has(record.last_error_code)
      ) return changed(0);
      record.payload_json = payloadJson;
      record.status = "pending";
      record.attempt_count = 0;
      record.next_attempt_at = nextAttemptAt;
      record.lease_token = null;
      record.lease_expires_at = null;
      record.last_error_code = null;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:ensure_process_lock")) {
      const [name, updatedAt] = bindings;
      if (!this.locks.has(name)) {
        this.locks.set(name, {
          lock_name: name,
          lease_token: null,
          lease_expires_at: null,
          updated_at: updatedAt,
        });
        return changed(1);
      }
      return changed(0);
    }

    if (sql.includes("angi_router:acquire_process_lock")) {
      const [leaseToken, leaseExpiresAt, updatedAt, name, cutoff] = bindings;
      const lock = this.locks.get(name);
      if (
        !lock
        || (
          lock.lease_token !== null
          && lock.lease_expires_at !== null
          && lock.lease_expires_at > cutoff
        )
      ) return changed(0);
      lock.lease_token = leaseToken;
      lock.lease_expires_at = leaseExpiresAt;
      lock.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:release_process_lock")) {
      const [updatedAt, name, leaseToken] = bindings;
      const lock = this.locks.get(name);
      if (!lock || lock.lease_token !== leaseToken) return changed(0);
      lock.lease_token = null;
      lock.lease_expires_at = null;
      lock.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:upsert_jobber_auth")) {
      const [accountKey, accessToken, expiresAt, refreshToken, updatedAt] = bindings;
      this.auth.set(accountKey, {
        account_key: accountKey,
        access_token: accessToken,
        access_expires_at: expiresAt,
        refresh_token: refreshToken,
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("angi_router:invalidate_jobber_access")) {
      const [updatedAt, accountKey] = bindings;
      const auth = this.auth.get(accountKey);
      if (!auth) return changed(0);
      auth.access_token = null;
      auth.access_expires_at = null;
      auth.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:redact_expired_review")) {
      const [cutoff] = bindings;
      let count = 0;
      for (const record of this.records.values()) {
        if (
          record.status === "needs_review"
          && record.payload_json !== null
          && record.updated_at < cutoff
        ) {
          record.payload_json = null;
          count += 1;
        }
      }
      return changed(count);
    }

    if (sql.includes("angi_router:max_attempts")) {
      const [updatedAt, key] = bindings;
      const record = this.records.get(key);
      if (!record || record.status === "completed") return changed(0);
      record.status = "needs_review";
      record.lease_token = null;
      record.lease_expires_at = null;
      record.next_attempt_at = null;
      record.last_error_code = "max_attempts_exceeded";
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:insert")) {
      const [
        key,
        payloadJson,
        status,
        nextAttemptAt,
        errorCode,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.records.has(key)) return changed(0);
      this.records.set(key, {
        idempotency_key: key,
        payload_json: payloadJson,
        status,
        attempt_count: 0,
        next_attempt_at: nextAttemptAt,
        lease_token: null,
        lease_expires_at: null,
        client_id: null,
        property_id: null,
        request_id: null,
        note_id: null,
        last_error_code: errorCode,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
      });
      return changed(1);
    }

    if (sql.includes("angi_router:claim_reconciliation")) {
      const [leaseToken, leaseExpiresAt, updatedAt, key, leaseCutoff] = bindings;
      const record = this.records.get(key);
      const eligible = record
        && ["client_creating", "request_creating", "note_creating"].includes(record.status)
        && (record.lease_expires_at === null || record.lease_expires_at <= leaseCutoff);
      if (!eligible) return changed(0);
      record.attempt_count += 1;
      record.lease_token = leaseToken;
      record.lease_expires_at = leaseExpiresAt;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:claim")) {
      const [leaseToken, leaseExpiresAt, updatedAt, key, nextCutoff, leaseCutoff] = bindings;
      const record = this.records.get(key);
      const eligible = record
        && [
          "pending",
          "processing",
          "client_created",
          "request_created",
          "failed_retryable",
        ].includes(record.status)
        && (record.next_attempt_at === null || record.next_attempt_at <= nextCutoff)
        && (record.lease_expires_at === null || record.lease_expires_at <= leaseCutoff);
      if (!eligible) return changed(0);
      if (["pending", "failed_retryable"].includes(record.status)) record.status = "processing";
      record.attempt_count += 1;
      record.lease_token = leaseToken;
      record.lease_expires_at = leaseExpiresAt;
      record.last_error_code = null;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:client_creating")) {
      const [updatedAt, key, leaseToken] = bindings;
      const record = this.records.get(key);
      if (!matches(record, leaseToken, "processing")) return changed(0);
      record.status = "client_creating";
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:client_created")) {
      const [clientId, propertyId, updatedAt, key, leaseToken] = bindings;
      const record = this.records.get(key);
      if (!matches(record, leaseToken, "client_creating")) return changed(0);
      record.status = "client_created";
      record.client_id = clientId;
      record.property_id = propertyId;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:request_creating")) {
      const [updatedAt, key, leaseToken] = bindings;
      const record = this.records.get(key);
      if (!matches(record, leaseToken, "client_created")) return changed(0);
      record.status = "request_creating";
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:request_created")) {
      const [requestId, updatedAt, key, leaseToken] = bindings;
      const record = this.records.get(key);
      if (!matches(record, leaseToken, "request_creating")) return changed(0);
      record.status = "request_created";
      record.request_id = requestId;
      record.updated_at = updatedAt;
      this.events.push(`request_checkpointed:${requestId}`);
      return changed(1);
    }

    if (sql.includes("angi_router:note_creating")) {
      const [updatedAt, key, leaseToken] = bindings;
      const record = this.records.get(key);
      if (!matches(record, leaseToken, "request_created")) return changed(0);
      record.status = "note_creating";
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:completed")) {
      const [requestId, noteId, completedAt, updatedAt, key, leaseToken] = bindings;
      const record = this.records.get(key);
      if (
        !record
        || record.lease_token !== leaseToken
        || !["request_created", "note_creating"].includes(record.status)
      ) return changed(0);
      record.status = "completed";
      record.request_id = requestId;
      record.note_id = noteId;
      record.payload_json = null;
      record.lease_token = null;
      record.lease_expires_at = null;
      record.next_attempt_at = null;
      record.last_error_code = null;
      record.completed_at = completedAt;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:schedule_retry")) {
      const [nextStatus, nextAttemptAt, errorCode, updatedAt, key, leaseToken, status] = bindings;
      const record = this.records.get(key);
      if (!matches(record, leaseToken, status)) return changed(0);
      record.status = nextStatus;
      record.lease_token = null;
      record.lease_expires_at = null;
      record.next_attempt_at = nextAttemptAt;
      record.last_error_code = errorCode;
      record.updated_at = updatedAt;
      return changed(1);
    }

    if (sql.includes("angi_router:indeterminate")) {
      const [errorCode, updatedAt, key, leaseToken] = bindings;
      const record = this.records.get(key);
      if (!record || record.lease_token !== leaseToken) return changed(0);
      record.status = "needs_review";
      record.lease_token = null;
      record.lease_expires_at = null;
      record.next_attempt_at = null;
      record.last_error_code = errorCode;
      record.updated_at = updatedAt;
      return changed(1);
    }

    throw new Error("Unexpected run SQL");
  }
}

function changed(count) {
  return { meta: { changes: count } };
}

function matches(record, leaseToken, status) {
  return Boolean(record && record.lease_token === leaseToken && record.status === status);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildFetchMock({
  accountId = UTAH_ACCOUNT_ID,
  tokenFailure = false,
  ambiguousRequest = false,
  ambiguousNote = false,
  partialClient = false,
  partialRequest = false,
  fieldflowStatuses = [],
  fieldflowNetworkFailures = 0,
  onFieldflow = null,
} = {}) {
  const calls = [];
  const remainingFieldflowStatuses = [...fieldflowStatuses];
  let remainingFieldflowNetworkFailures = fieldflowNetworkFailures;
  const mock = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/oauth/token")) {
      if (tokenFailure) throw new Error("temporary network failure");
      return json({
        access_token: "test-access-token",
        refresh_token: "rotated-test-refresh-token",
        expires_in: 3600,
      });
    }

    if (String(url) === `${FIELDFLOW_BASE_URL}/slc`) {
      const payload = JSON.parse(options.body);
      if (typeof onFieldflow === "function") onFieldflow(payload, options);
      if (remainingFieldflowNetworkFailures > 0) {
        remainingFieldflowNetworkFailures -= 1;
        throw new Error("temporary Fieldflow network failure");
      }
      const status = remainingFieldflowStatuses.shift() ?? 202;
      return json({ ok: status >= 200 && status < 300 }, status);
    }

    const body = JSON.parse(options.body);
    if (body.query.includes("GoodAtticUtahAccountCheck")) {
      return json({ data: { account: { id: accountId } } });
    }
    if (body.query.includes("GoodAtticAngiClientCreate")) {
      if (partialClient) {
        return json({
          data: {
            clientCreate: {
              client: {
                id: "client-partial",
                clientProperties: { nodes: [{ id: "property-partial" }] },
              },
              userErrors: [],
            },
          },
          errors: [{ message: "partial mutation error" }],
        });
      }
      return json({
        data: {
          clientCreate: {
            client: {
              id: "client-1",
              jobberWebUri: "https://example.test/client",
              clientProperties: {
                nodes: [{ id: "property-1", jobberWebUri: "https://example.test/property" }],
              },
            },
            userErrors: [],
          },
        },
      });
    }
    if (body.query.includes("GoodAtticFindAngiRequestNote")) {
      return json({
        data: {
          request: {
            notes: { nodes: [] },
          },
        },
      });
    }
    if (body.query.includes("GoodAtticFindAngiRequest(")) {
      return json({
        data: {
          client: {
            requests: {
              nodes: [{
                id: "request-adopted",
                title: "Blown-In Insulation - Install or Upgrade [Angi 635435743]",
              }],
            },
          },
        },
      });
    }
    if (body.query.includes("GoodAtticRequestCreateNote")) {
      if (ambiguousNote) throw new Error("response lost after note creation");
      return json({
        data: {
          requestCreateNote: {
            requestNote: { id: "note-1" },
            userErrors: [],
          },
        },
      });
    }
    if (body.query.includes("GoodAtticAngiRequestCreate")) {
      if (ambiguousRequest) throw new Error("response lost after request creation");
      if (partialRequest) {
        return json({
          data: {
            requestCreate: {
              request: { id: "request-partial", title: "partial" },
              userErrors: [],
            },
          },
          errors: [{ message: "partial request mutation error" }],
        });
      }
      return json({
        data: {
          requestCreate: {
            request: {
              id: "request-1",
              jobberWebUri: "https://example.test/request",
              property: { id: "property-1" },
            },
            userErrors: [],
          },
        },
      });
    }
    throw new Error("Unexpected network request");
  };
  mock.calls = calls;
  return mock;
}

function buildEnv(database, overrides = {}) {
  return {
    ANGI_ROUTER_DB: database,
    ANGI_ROUTER_ENABLED: "true",
    ANGI_ROUTER_SECRET: SECRET,
    ANGI_ROUTER_CUTOVER_AT: "2020-01-01T00:00:00.000Z",
    JOBBER_CLIENT_ID: "jobber-client-id",
    JOBBER_CLIENT_SECRET: "jobber-client-secret",
    JOBBER_REFRESH_TOKEN_SLC: "jobber-refresh-token",
    ...overrides,
  };
}

function buildWebhookRequest(payload = SAMPLE_ANGI_LEAD, secret = SECRET) {
  return new Request("https://goodattic.example/api/ghl/angi-utah", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function buildDrainRequest() {
  return new Request("https://goodattic.example/api/ghl/angi-utah-drain", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit: 10 }),
  });
}

function buildStatusRequest() {
  return new Request("https://goodattic.example/api/ghl/angi-utah-status", {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
}

function buildAuthCheckRequest(secret = SECRET) {
  return new Request("https://goodattic.example/api/ghl/angi-utah-auth-check", {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });
}

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("creates exactly one Utah Jobber request, never an assessment, and deduplicates", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);

  const response = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env,
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, status: "queued" });
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(database.records.get("131399442:635435743").status, "pending");

  const drained = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(drained.status, 200);
  const drainedBody = await drained.json();
  assert.equal(drainedBody.summary.created, 1);

  const graphqlBodies = fetchMock.calls
    .filter((call) => call.url.includes("/graphql"))
    .map((call) => JSON.parse(call.options.body));
  assert.equal(
    graphqlBodies.filter((body) => body.query.includes("GoodAtticAngiClientCreate")).length,
    1,
  );
  assert.equal(
    graphqlBodies.filter((body) => body.query.includes("GoodAtticAngiRequestCreate")).length,
    1,
  );
  assert.equal(
    graphqlBodies.filter((body) => body.query.includes("GoodAtticRequestCreateNote")).length,
    1,
  );
  assert.equal(graphqlBodies.some((body) => /assessmentCreate/i.test(body.query)), false);
  const requestMutation = graphqlBodies.find(
    (body) => body.query.includes("GoodAtticAngiRequestCreate"),
  );
  assert.equal(
    requestMutation.variables.input.title,
    "Blown-In Insulation - Install or Upgrade [Angi 635435743]",
  );
  const noteMutation = graphqlBodies.find(
    (body) => body.query.includes("GoodAtticRequestCreateNote"),
  );
  assert.match(noteMutation.variables.input.message, /Provider entity ID: 131399442/);
  assert.match(noteMutation.variables.input.message, /Angi lead ID: 635435743/);
  assert.match(noteMutation.variables.input.message, /Please call before arriving/);

  const record = database.records.get("131399442:635435743");
  assert.equal(record.status, "completed");
  assert.equal(record.payload_json, null);
  assert.equal(record.request_id, "request-1");
  assert.equal(record.note_id, "note-1");

  record.completed_at = "2000-01-01T00:00:00.000Z";
  record.updated_at = "2000-01-01T00:00:00.000Z";
  await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(database.records.has("131399442:635435743"), true);
  assert.equal(record.status, "completed");

  const callCount = fetchMock.calls.length;
  const duplicate = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env,
  });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true, status: "duplicate" });
  assert.equal(fetchMock.calls.length, callCount);
});

test("accepts a phone-only Angi lead and omits an empty Jobber email field", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);

  const response = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      email: "",
      stateProvince: "Utah",
      leadSource: "Angi",
    }),
    env,
  });
  assert.equal(response.status, 202);
  assert.equal(fetchMock.calls.length, 0);
  await handleDrain({ request: buildDrainRequest(), env });

  const clientMutation = fetchMock.calls
    .filter((call) => call.url.includes("/graphql"))
    .map((call) => JSON.parse(call.options.body))
    .find((body) => body.query.includes("GoodAtticAngiClientCreate"));
  assert.equal("emails" in clientMutation.variables.input, false);
  assert.equal(clientMutation.variables.input.phones[0].number, SAMPLE_ANGI_LEAD.primaryPhone);
});

test("normalizes a valid Utah HomeAdvisor lead to the existing Angi label", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);

  const response = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      leadSource: "HomeAdvisor",
    }),
    env,
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, status: "queued" });
  const record = database.records.get("131399442:635435743");
  assert.equal(record.status, "pending");
  assert.equal(JSON.parse(record.payload_json).leadSource, "AngiesList");

  const drained = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(drained.status, 200);
  assert.equal(record.status, "completed");

  const graphqlBodies = fetchMock.calls
    .filter((call) => call.url.includes("/graphql"))
    .map((call) => JSON.parse(call.options.body));
  const requestMutation = graphqlBodies.find(
    (body) => body.query.includes("GoodAtticAngiRequestCreate"),
  );
  assert.equal(
    requestMutation.variables.input.title,
    "Blown-In Insulation - Install or Upgrade [Angi 635435743]",
  );
  const noteMutation = graphqlBodies.find(
    (body) => body.query.includes("GoodAtticRequestCreateNote"),
  );
  assert.match(noteMutation.variables.input.message, /Source: AngiesList/);
});

test("keeps the Utah and source gates closed after adding the HomeAdvisor alias", async () => {
  const wrongEntityDatabase = new FakeD1();
  const wrongEntityResponse = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      leadSource: "HomeAdvisor",
      spEntityId: 158494539,
    }),
    env: buildEnv(wrongEntityDatabase),
  });
  assert.equal(wrongEntityResponse.status, 202);
  assert.deepEqual(await wrongEntityResponse.json(), {
    ok: true,
    status: "ignored",
    reason: "non_utah_entity",
  });
  assert.equal(wrongEntityDatabase.records.size, 0);

  const wrongMarketDatabase = new FakeD1();
  const wrongMarketResponse = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      leadSource: "HomeAdvisor",
      stateProvince: "MO",
      postalCode: "63017",
    }),
    env: buildEnv(wrongMarketDatabase),
  });
  assert.equal(wrongMarketResponse.status, 202);
  assert.deepEqual(await wrongMarketResponse.json(), {
    ok: true,
    status: "needs_review",
  });
  assert.equal(
    wrongMarketDatabase.records.get("131399442:635435743").last_error_code,
    "invalid_utah_state",
  );

  const unrelatedSourceDatabase = new FakeD1();
  const unrelatedSourceResponse = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      leadSource: "Unrelated Provider",
    }),
    env: buildEnv(unrelatedSourceDatabase),
  });
  assert.equal(unrelatedSourceResponse.status, 202);
  assert.deepEqual(await unrelatedSourceResponse.json(), {
    ok: true,
    status: "needs_review",
  });
  assert.equal(
    unrelatedSourceDatabase.records.get("131399442:635435743").last_error_code,
    "invalid_source",
  );
});

test("adopts a uniquely marked request after an ambiguous request-create response", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock({ ambiguousRequest: true });
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);

  const response = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env,
  });
  assert.equal(response.status, 202);
  assert.equal(fetchMock.calls.length, 0);
  const drained = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(drained.status, 200);
  const record = database.records.get("131399442:635435743");
  assert.equal(record.status, "completed");
  assert.equal(record.request_id, "request-adopted");
  assert.equal(
    fetchMock.calls.some((call) => call.options.body?.includes("GoodAtticFindAngiRequest")),
    true,
  );
});

test("checkpoints the request before a failed note and drains the note without another request", async () => {
  const database = new FakeD1();
  const firstFetch = buildFetchMock({ ambiguousNote: true });
  globalThis.fetch = firstFetch;
  const env = buildEnv(database);

  const queued = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env,
  });
  assert.equal(queued.status, 202);
  assert.deepEqual(await queued.json(), { ok: true, status: "queued" });
  assert.equal(firstFetch.calls.length, 0);
  const firstDrain = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(firstDrain.status, 200);

  const record = database.records.get("131399442:635435743");
  assert.equal(record.status, "request_created");
  assert.equal(record.request_id, "request-1");
  assert.equal(record.note_id, null);
  record.next_attempt_at = Date.now() - 1;

  const drainFetch = buildFetchMock();
  globalThis.fetch = drainFetch;
  const drained = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(drained.status, 200);
  assert.equal(record.status, "completed");
  assert.equal(record.request_id, "request-1");
  assert.equal(record.note_id, "note-1");

  const drainQueries = drainFetch.calls
    .filter((call) => call.url.includes("/graphql"))
    .map((call) => JSON.parse(call.options.body).query);
  assert.equal(
    drainQueries.some((query) => query.includes("GoodAtticAngiRequestCreate")),
    false,
  );
  assert.equal(
    drainQueries.some((query) => query.includes("GoodAtticRequestCreateNote")),
    true,
  );
});

test("serializes concurrent drains and refreshes the Utah token once", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);
  await handleAngiWebhook({ request: buildWebhookRequest(), env });

  const [first, second] = await Promise.all([
    handleDrain({ request: buildDrainRequest(), env }),
    handleDrain({ request: buildDrainRequest(), env }),
  ]);
  const summaries = [(await first.json()).summary, (await second.json()).summary];
  assert.equal(summaries.reduce((total, item) => total + item.created, 0), 1);
  assert.equal(summaries.filter((item) => item.lock_busy).length, 1);
  assert.equal(
    fetchMock.calls.filter((call) => call.url.includes("/oauth/token")).length,
    1,
  );
  assert.equal(
    fetchMock.calls.filter((call) => call.options.body?.includes("GoodAtticAngiClientCreate")).length,
    1,
  );
});

test("source routing drains through an isolated Angi auth record, lock, and token", async () => {
  const database = new FakeD1();
  database.auth.set("utah", {
    account_key: "utah",
    access_token: "legacy-access-token",
    access_expires_at: Date.now() + 3_600_000,
    refresh_token: "legacy-d1-refresh-token",
    updated_at: new Date().toISOString(),
  });
  database.locks.set("utah_jobber_process", {
    lock_name: "utah_jobber_process",
    lease_token: "legacy-process-in-progress",
    lease_expires_at: Date.now() + 60_000,
    updated_at: new Date().toISOString(),
  });

  const requestedTokenKeys = [];
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database, {
    ANGI_SOURCE_ROUTING_ENABLED: "true",
    JOBBER_CLIENT_ID_ANGI: "angi-client-id",
    JOBBER_CLIENT_SECRET_ANGI: "angi-client-secret",
    JOBBER_REFRESH_TOKEN_ANGI_SLC: "angi-env-refresh-token",
    JOBBER_TOKEN_STORE: {
      async get(key) {
        requestedTokenKeys.push(key);
        return key === "jobber_refresh_token:JOBBER_REFRESH_TOKEN_ANGI_SLC"
          ? "angi-kv-refresh-token"
          : "legacy-kv-refresh-token";
      },
    },
  });

  await handleAngiWebhook({ request: buildWebhookRequest(), env });
  const drained = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(drained.status, 200);
  assert.equal((await drained.json()).summary.created, 1);

  assert.deepEqual(requestedTokenKeys, [
    "jobber_refresh_token:JOBBER_REFRESH_TOKEN_ANGI_SLC",
  ]);
  const tokenCall = fetchMock.calls.find((call) => call.url.includes("/oauth/token"));
  const tokenBody = new URLSearchParams(tokenCall.options.body);
  assert.equal(tokenBody.get("client_id"), "angi-client-id");
  assert.equal(tokenBody.get("client_secret"), "angi-client-secret");
  assert.equal(tokenBody.get("refresh_token"), "angi-kv-refresh-token");

  assert.equal(database.auth.get("utah")?.access_token, "legacy-access-token");
  assert.equal(database.auth.get("utah")?.refresh_token, "legacy-d1-refresh-token");
  assert.equal(database.auth.get("utah_angi")?.refresh_token, "rotated-test-refresh-token");
  assert.equal(
    database.locks.get("utah_jobber_process")?.lease_token,
    "legacy-process-in-progress",
  );
  assert.equal(database.locks.get("utah_angi_jobber_process")?.lease_token, null);
});

test("source routing never falls back to the legacy Jobber connection", async () => {
  const database = new FakeD1();
  database.auth.set("utah", {
    account_key: "utah",
    access_token: "legacy-access-token",
    access_expires_at: Date.now() + 3_600_000,
    refresh_token: "legacy-d1-refresh-token",
    updated_at: new Date().toISOString(),
  });
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database, {
    ANGI_SOURCE_ROUTING_ENABLED: "true",
  });

  const response = await handleAuthCheck({
    request: buildAuthCheckRequest(),
    env,
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    status: "verification_failed",
  });
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(database.auth.has("utah_angi"), false);
  assert.equal(database.auth.get("utah")?.access_token, "legacy-access-token");
  assert.equal(database.locks.has("utah_jobber_process"), false);
  assert.equal(database.locks.get("utah_angi_jobber_process")?.lease_token, null);
});

test("auth check seeds D1 and verifies Utah without enabled/cutover gates or Jobber mutations", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database, {
    ANGI_ROUTER_ENABLED: "false",
    ANGI_ROUTER_CUTOVER_AT: "",
    ANGI_SOURCE_ROUTING_ENABLED: "false",
  });

  const response = await handleAuthCheck({
    request: buildAuthCheckRequest(),
    env,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "verified" });
  assert.equal(database.records.size, 0);
  assert.equal(database.auth.get("utah")?.refresh_token, "rotated-test-refresh-token");
  assert.equal(database.auth.has("utah_angi"), false);
  assert.equal(database.locks.get("utah_jobber_process")?.lease_token, null);
  assert.equal(database.locks.has("utah_angi_jobber_process"), false);
  const tokenCall = fetchMock.calls.find((call) => call.url.includes("/oauth/token"));
  const tokenBody = new URLSearchParams(tokenCall.options.body);
  assert.equal(tokenBody.get("client_id"), "jobber-client-id");
  assert.equal(tokenBody.get("client_secret"), "jobber-client-secret");
  assert.equal(tokenBody.get("refresh_token"), "jobber-refresh-token");
  const queries = fetchMock.calls
    .filter((call) => call.url.includes("/graphql"))
    .map((call) => JSON.parse(call.options.body).query);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].includes("GoodAtticUtahAccountCheck"), true);
  assert.equal(queries.some((query) => /mutation/i.test(query)), false);
});

test("auth check returns only busy status when the Utah Jobber process lock is held", async () => {
  const database = new FakeD1();
  database.locks.set("utah_jobber_process", {
    lock_name: "utah_jobber_process",
    lease_token: "another-process",
    lease_expires_at: Date.now() + 60_000,
    updated_at: new Date().toISOString(),
  });
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;

  const response = await handleAuthCheck({
    request: buildAuthCheckRequest(),
    env: buildEnv(database, {
      ANGI_ROUTER_ENABLED: "false",
      ANGI_ROUTER_CUTOVER_AT: "",
    }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, status: "busy" });
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(database.records.size, 0);
});

test("auth check requires router bearer auth and never exposes Jobber verification details", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock({ accountId: "wrong-account" });
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);

  const unauthorized = await handleAuthCheck({
    request: buildAuthCheckRequest("wrong-secret"),
    env,
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { ok: false, status: "unauthorized" });
  assert.equal(fetchMock.calls.length, 0);

  const mismatch = await handleAuthCheck({
    request: buildAuthCheckRequest(),
    env,
  });
  assert.equal(mismatch.status, 503);
  const responseText = await mismatch.text();
  assert.deepEqual(JSON.parse(responseText), {
    ok: false,
    status: "verification_failed",
  });
  assert.equal(responseText.includes("wrong-account"), false);
  assert.equal(responseText.includes("test-access-token"), false);
  assert.equal(responseText.includes("rotated-test-refresh-token"), false);
  assert.equal(
    fetchMock.calls.some((call) => /mutation/i.test(call.options.body || "")),
    false,
  );
  assert.equal(database.records.size, 0);
  assert.equal(database.locks.get("utah_jobber_process")?.lease_token, null);
});

test("adopts partial client and request mutation IDs without repeating either mutation", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock({ partialClient: true, partialRequest: true });
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);
  await handleAngiWebhook({ request: buildWebhookRequest(), env });

  const drained = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(drained.status, 200);
  const record = database.records.get("131399442:635435743");
  assert.equal(record.status, "completed");
  assert.equal(record.client_id, "client-partial");
  assert.equal(record.request_id, "request-partial");
  assert.equal(
    fetchMock.calls.filter((call) => call.options.body?.includes("GoodAtticAngiClientCreate")).length,
    1,
  );
  assert.equal(
    fetchMock.calls.filter((call) => call.options.body?.includes("GoodAtticAngiRequestCreate")).length,
    1,
  );
});

test("quarantines an exact Utah entity with a bad address and requeues corrected replay", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const env = buildEnv(database);

  const quarantined = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      stateProvince: "MO",
      postalCode: "63017",
    }),
    env,
  });
  assert.equal(quarantined.status, 202);
  assert.deepEqual(await quarantined.json(), { ok: true, status: "needs_review" });
  const record = database.records.get("131399442:635435743");
  assert.equal(record.status, "needs_review");
  assert.equal(record.last_error_code, "invalid_utah_state");
  assert.equal(fetchMock.calls.length, 0);

  const visible = await handleStatus({ request: buildStatusRequest(), env });
  const visibility = await visible.json();
  assert.equal(visibility.summary.needs_review, 1);
  assert.deepEqual(visibility.needs_review[0], {
    idempotency_key: "131399442:635435743",
    last_error_code: "invalid_utah_state",
    updated_at: record.updated_at,
    attempt_count: 0,
  });
  assert.equal(JSON.stringify(visibility).includes(SAMPLE_ANGI_LEAD.email), false);

  record.updated_at = "2000-01-01T00:00:00.000Z";
  const cleanup = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal((await cleanup.json()).summary.cleaned, 1);
  assert.equal(database.records.has("131399442:635435743"), true);
  assert.equal(record.status, "needs_review");
  assert.equal(record.payload_json, null);

  const corrected = await handleAngiWebhook({
    request: buildWebhookRequest(SAMPLE_ANGI_LEAD),
    env,
  });
  assert.equal(corrected.status, 202);
  assert.deepEqual(await corrected.json(), { ok: true, status: "queued" });
  assert.equal(record.status, "pending");
  assert.equal(record.last_error_code, null);
  assert.notEqual(record.payload_json, null);
});

test("requires a valid cutover timestamp before accepting a lead", async () => {
  const database = new FakeD1();
  const response = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env: buildEnv(database, { ANGI_ROUTER_CUTOVER_AT: "" }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    status: "cutover_not_configured",
  });
  assert.equal(database.records.size, 0);
});

test("validates an optional source timestamp without requiring one on live payloads", async () => {
  const database = new FakeD1();
  const env = buildEnv(database, {
    ANGI_ROUTER_CUTOVER_AT: "2025-01-01T00:00:00.000Z",
  });

  const historical = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      eventTimestamp: "2024-12-31T23:59:00.000Z",
    }),
    env,
  });
  assert.deepEqual(await historical.json(), {
    ok: true,
    status: "ignored",
    reason: "source_event_before_cutover",
  });
  assert.equal(database.records.size, 0);

  const invalid = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      eventTimestamp: "not-a-timestamp",
    }),
    env,
  });
  assert.deepEqual(await invalid.json(), { ok: true, status: "needs_review" });
  assert.equal(
    database.records.get("131399442:635435743").last_error_code,
    "invalid_source_event_time",
  );
});

test("fails closed while disabled", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const response = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env: buildEnv(database, { ANGI_ROUTER_ENABLED: "false" }),
  });
  assert.equal(response.status, 503);
  assert.equal(database.records.size, 0);
  assert.equal(fetchMock.calls.length, 0);
});

test("ignores but does not enqueue leads received before the configured cutover", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const response = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env: buildEnv(database, { ANGI_ROUTER_CUTOVER_AT: "2999-01-01T00:00:00.000Z" }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "ignored",
    reason: "before_cutover",
  });
  assert.equal(database.records.size, 0);
  assert.equal(fetchMock.calls.length, 0);
});

test("ignores a non-Utah Angi entity before touching D1 or Jobber", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock();
  globalThis.fetch = fetchMock;
  const response = await handleAngiWebhook({
    request: buildWebhookRequest({
      ...SAMPLE_ANGI_LEAD,
      spEntityId: 158494539,
      stateProvince: "MO",
      postalCode: "63017",
    }),
    env: buildEnv(database),
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "ignored");
  assert.equal(database.records.size, 0);
  assert.equal(fetchMock.calls.length, 0);
});

test("rejects a bad bearer secret without exposing request data", async () => {
  const database = new FakeD1();
  const response = await handleAngiWebhook({
    request: buildWebhookRequest(SAMPLE_ANGI_LEAD, "wrong-secret"),
    env: buildEnv(database),
  });
  assert.equal(response.status, 401);
  const responseText = await response.text();
  assert.equal(responseText.includes(SAMPLE_ANGI_LEAD.email), false);
  assert.equal(responseText.includes(SECRET), false);
  assert.equal(database.records.size, 0);
});

test("queues an account mismatch and later drains it without acknowledging a Jobber write", async () => {
  const database = new FakeD1();
  const wrongAccountFetch = buildFetchMock({ accountId: "wrong-account" });
  globalThis.fetch = wrongAccountFetch;
  const env = buildEnv(database);

  const queued = await handleAngiWebhook({
    request: buildWebhookRequest(),
    env,
  });
  assert.equal(queued.status, 202);
  assert.deepEqual(await queued.json(), { ok: true, status: "queued" });
  assert.equal(wrongAccountFetch.calls.length, 0);
  const firstDrain = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(firstDrain.status, 200);
  assert.equal(
    wrongAccountFetch.calls.some((call) => call.options.body?.includes("clientCreate")),
    false,
  );

  const record = database.records.get("131399442:635435743");
  assert.equal(record.status, "failed_retryable");
  record.next_attempt_at = Date.now() - 1;

  const correctAccountFetch = buildFetchMock();
  globalThis.fetch = correctAccountFetch;
  const drained = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal(drained.status, 200);
  const drainedBody = await drained.json();
  assert.equal(drainedBody.summary.created, 1);
  assert.equal(record.status, "completed");
});

test("enqueues and sends PII-free Angi attribution only after the Jobber request checkpoint", async () => {
  const database = new FakeD1();
  let deliveredPayload;
  let deliveredHeaders;
  const fetchMock = buildFetchMock({
    onFieldflow(payload, options) {
      deliveredPayload = payload;
      deliveredHeaders = options.headers;
      const delivery = database.records.get("131399442:635435743");
      assert.equal(delivery.request_id, "request-1");
      assert.equal(delivery.status, "completed");
    },
  });
  globalThis.fetch = fetchMock;
  const env = buildEnv(database, {
    FIELDFLOW_ATTRIBUTION_BASE_URL: FIELDFLOW_BASE_URL,
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: FIELDFLOW_TOKEN,
  });

  await handleAngiWebhook({ request: buildWebhookRequest(), env });
  assert.equal(database.fieldflowRecords.size, 0);
  const drained = await handleDrain({ request: buildDrainRequest(), env });
  const summary = (await drained.json()).summary;

  assert.deepEqual(deliveredPayload, {
    schema_version: "2026-07-31",
    jobber_request_id: "request-1",
    provider_lead_id: "635435743",
    provider_name: "Angi",
    submission_id: "angi:131399442:635435743",
    occurred_at: deliveredPayload.occurred_at,
    lead_source: "Angi",
    source_reason: "server_routed_angi_provider",
    request_title: "[Angi 635435743]",
  });
  assert.match(deliveredPayload.occurred_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(deliveredHeaders.Authorization, `Bearer ${FIELDFLOW_TOKEN}`);
  assert.equal(deliveredHeaders["Content-Type"], "application/json");
  const serialized = JSON.stringify(deliveredPayload);
  for (const pii of [
    SAMPLE_ANGI_LEAD.name,
    SAMPLE_ANGI_LEAD.email,
    SAMPLE_ANGI_LEAD.primaryPhone,
    SAMPLE_ANGI_LEAD.address,
    SAMPLE_ANGI_LEAD.comments,
  ]) {
    assert.equal(serialized.includes(pii), false);
  }

  const checkpointIndex = database.events.indexOf("request_checkpointed:request-1");
  const enqueueIndex = database.events.indexOf(
    "fieldflow_enqueued:angi:131399442:635435743",
  );
  assert.notEqual(checkpointIndex, -1);
  assert.ok(enqueueIndex > checkpointIndex);
  assert.equal(
    database.fieldflowRecords.get("angi:131399442:635435743").status,
    "sent",
  );
  assert.equal(summary.fieldflow.sent, 1);
});

test("retries Fieldflow independently without repeating any completed Jobber mutation", async () => {
  const database = new FakeD1();
  const failedFetch = buildFetchMock({ fieldflowStatuses: [503, 503, 503] });
  globalThis.fetch = failedFetch;
  const env = buildEnv(database, {
    FIELDFLOW_ATTRIBUTION_BASE_URL: FIELDFLOW_BASE_URL,
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: FIELDFLOW_TOKEN,
  });

  await handleAngiWebhook({ request: buildWebhookRequest(), env });
  const firstDrain = await handleDrain({ request: buildDrainRequest(), env });
  const firstSummary = (await firstDrain.json()).summary;
  const jobberRecord = database.records.get("131399442:635435743");
  const fieldflowRecord = database.fieldflowRecords.get(
    "angi:131399442:635435743",
  );
  assert.equal(jobberRecord.status, "completed");
  assert.equal(fieldflowRecord.status, "failed_retryable");
  assert.equal(fieldflowRecord.last_error_code, "http_503");
  assert.equal(firstSummary.fieldflow.queued, 1);

  const originalGraphqlBodies = failedFetch.calls
    .filter((call) => call.url.includes("/graphql"))
    .map((call) => JSON.parse(call.options.body));
  for (const operation of [
    "GoodAtticAngiClientCreate",
    "GoodAtticAngiRequestCreate",
    "GoodAtticRequestCreateNote",
  ]) {
    assert.equal(
      originalGraphqlBodies.filter((body) => body.query.includes(operation)).length,
      1,
    );
  }

  fieldflowRecord.next_attempt_at = Date.now() - 1;
  const recoveredFetch = buildFetchMock({ fieldflowStatuses: [200] });
  globalThis.fetch = recoveredFetch;
  const recovered = await handleDrain({ request: buildDrainRequest(), env });
  assert.equal((await recovered.json()).summary.fieldflow.sent, 1);
  assert.equal(fieldflowRecord.status, "sent");
  assert.equal(
    recoveredFetch.calls.some((call) => call.url.includes("/graphql")),
    false,
  );
  assert.equal(
    recoveredFetch.calls.filter((call) => call.url === `${FIELDFLOW_BASE_URL}/slc`).length,
    1,
  );
});

test("quarantines nonretryable Fieldflow responses while leaving Jobber completed", async () => {
  const database = new FakeD1();
  const fetchMock = buildFetchMock({ fieldflowStatuses: [400] });
  globalThis.fetch = fetchMock;
  const env = buildEnv(database, {
    FIELDFLOW_ATTRIBUTION_BASE_URL: FIELDFLOW_BASE_URL,
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: FIELDFLOW_TOKEN,
  });

  await handleAngiWebhook({ request: buildWebhookRequest(), env });
  const drained = await handleDrain({ request: buildDrainRequest(), env });
  const summary = (await drained.json()).summary;
  assert.equal(database.records.get("131399442:635435743").status, "completed");
  const outbox = database.fieldflowRecords.get("angi:131399442:635435743");
  assert.equal(outbox.status, "needs_review");
  assert.equal(outbox.last_error_code, "http_400");
  assert.equal(summary.fieldflow.needs_review, 1);
  assert.equal(
    fetchMock.calls.filter((call) => call.url === `${FIELDFLOW_BASE_URL}/slc`).length,
    1,
  );
  const visible = await handleStatus({ request: buildStatusRequest(), env });
  const visibility = await visible.json();
  assert.equal(visibility.summary.fieldflow.counts.needs_review, 1);
  assert.equal(visibility.summary.fieldflow.needs_review, 1);
  assert.equal(visibility.summary.fieldflow.unavailable, false);
});

test("uses INSERT OR IGNORE and enforces the independent Fieldflow attempt ceiling", async () => {
  const database = new FakeD1();
  const angi = angiRouter.normalizeAngiPayload(SAMPLE_ANGI_LEAD);
  const first = await angiRouter.enqueueFieldflowAttribution(
    database,
    "131399442:635435743",
    angi,
    "request-first",
  );
  const duplicate = await angiRouter.enqueueFieldflowAttribution(
    database,
    "131399442:635435743",
    angi,
    "request-duplicate",
  );
  assert.equal(first, "created");
  assert.equal(duplicate, "duplicate");
  const outbox = database.fieldflowRecords.get("angi:131399442:635435743");
  assert.equal(JSON.parse(outbox.payload_json).jobber_request_id, "request-first");

  outbox.status = "failed_retryable";
  outbox.attempt_count = 7;
  outbox.next_attempt_at = Date.now() - 1;
  const fetchMock = buildFetchMock({ fieldflowNetworkFailures: 3 });
  globalThis.fetch = fetchMock;
  const env = buildEnv(database, {
    FIELDFLOW_ATTRIBUTION_BASE_URL: FIELDFLOW_BASE_URL,
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: FIELDFLOW_TOKEN,
  });
  const status = await angiRouter.drainFieldflowAttributionOutbox(env, database);
  assert.equal(status, "needs_review");
  assert.equal(outbox.status, "needs_review");
  assert.equal(outbox.attempt_count, 8);
  assert.equal(outbox.last_error_code, "max_attempts_exceeded");
});
