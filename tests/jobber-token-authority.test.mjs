import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { _private as leads, onRequestPost } from "../functions/api/leads.js";

function changed(count) {
  return { meta: { changes: count } };
}

class TokenAuthorityD1 {
  constructor({ row, checkpointMode = "ok", beforeCheckpoint = null, failureWriteMode = "ok", onFence = null } = {}) {
    this.row = row ? { ...row } : null;
    this.checkpointMode = checkpointMode;
    this.beforeCheckpoint = beforeCheckpoint;
    this.failureWriteMode = failureWriteMode;
    this.onFence = onFence;
    this.locks = new Map();
    this.failures = new Map();
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...bindings) {
        return {
          first: () => database.first(sql, bindings),
          run: () => database.run(sql, bindings),
        };
      },
    };
  }

  async first(sql, bindings) {
    if (
      sql.includes("jobber_token_authority:select_auth")
      || sql.includes("jobber_token_authority:verify_checkpoint")
    ) {
      if (!this.row || this.row.account_key !== bindings[0]) return null;
      return { ...this.row };
    }
    throw new Error("Unexpected first SQL");
  }

  async run(sql, bindings) {
    if (sql.includes("website_lead_intake_failures:record")) {
      if (this.failureWriteMode === "throw") throw new Error("recovery D1 unavailable");
      if (this.failureWriteMode === "hang") return new Promise(() => {});
      const previous = this.failures.get(bindings[0]);
      this.failures.set(bindings[0], {
        submissionId: bindings[0],
        market: bindings[1],
        source: bindings[2],
        payload: JSON.parse(bindings[3]),
        code: bindings[4],
        status: bindings[5],
        nextRetryAt: bindings[6],
        expiresAt: bindings[7],
        attempts: (previous?.attempts || 0) + 1,
      });
      this.failure = bindings;
      return changed(1);
    }

    if (sql.includes("website_lead_intake_failures:resolve_after_jobber_request")) {
      const existed = this.failures.delete(bindings[0]);
      return changed(existed ? 1 : 0);
    }

    if (sql.includes("jobber_token_authority:fence_unauthorized_access")) {
      const [errorCode, updatedAt, accountKey, accessToken, revision] = bindings;
      if (
        !this.row || this.row.account_key !== accountKey
        || this.row.access_token !== accessToken
        || this.row.refresh_revision !== revision
        || this.row.refresh_status !== "ready"
      ) {
        this.onFence?.({ changed: false, row: this.row ? { ...this.row } : null });
        return changed(0);
      }
      Object.assign(this.row, {
        access_expires_at: 0,
        refresh_status: "ready",
        last_error_code: errorCode,
        updated_at: updatedAt,
      });
      this.onFence?.({ changed: true, row: { ...this.row } });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:mark_unauthorized_broken")) {
      const [errorCode, updatedAt, accountKey, accessToken, revision] = bindings;
      if (
        !this.row || this.row.account_key !== accountKey
        || this.row.access_token !== accessToken
        || this.row.refresh_revision !== revision
        || this.row.refresh_status !== "ready"
      ) return changed(0);
      Object.assign(this.row, {
        access_expires_at: 0,
        refresh_status: "refresh_outcome_unknown",
        refresh_lease_token: null,
        refresh_lease_expires_at: null,
        last_error_code: errorCode,
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:ensure_process_lock")) {
      const [lockName, updatedAt] = bindings;
      if (!this.locks.has(lockName)) {
        this.locks.set(lockName, {
          lease_token: null,
          lease_expires_at: null,
          updated_at: updatedAt,
        });
      }
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:acquire_process_lock")) {
      const [leaseToken, leaseExpiresAt, updatedAt, lockName, now] = bindings;
      const lock = this.locks.get(lockName);
      if (
        !lock
        || (
          lock.lease_token
          && Number(lock.lease_expires_at || 0) > now
        )
      ) return changed(0);
      Object.assign(lock, {
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:release_process_lock")) {
      const [updatedAt, lockName, leaseToken] = bindings;
      const lock = this.locks.get(lockName);
      if (!lock || lock.lease_token !== leaseToken) return changed(0);
      Object.assign(lock, {
        lease_token: null,
        lease_expires_at: null,
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:fence_expired_refresh")) {
      const [updatedAt, accountKey, revision, refreshLeaseToken] = bindings;
      if (
        !this.row
        || this.row.account_key !== accountKey
        || this.row.refresh_status !== "in_flight"
        || this.row.refresh_revision !== revision
        || this.row.refresh_lease_token !== refreshLeaseToken
      ) return changed(0);
      Object.assign(this.row, {
        refresh_status: "refresh_outcome_unknown",
        refresh_lease_token: null,
        refresh_lease_expires_at: null,
        last_error_code: "refresh_lease_expired",
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:claim_refresh")) {
      const [
        revision,
        refreshLeaseToken,
        refreshLeaseExpiresAt,
        updatedAt,
        accountKey,
        previousRevision,
        refreshToken,
      ] = bindings;
      if (
        !this.row
        || this.row.account_key !== accountKey
        || this.row.refresh_status !== "ready"
        || this.row.refresh_revision !== previousRevision
        || this.row.refresh_token !== refreshToken
      ) return changed(0);
      Object.assign(this.row, {
        refresh_revision: revision,
        refresh_status: "in_flight",
        refresh_lease_token: refreshLeaseToken,
        refresh_lease_expires_at: refreshLeaseExpiresAt,
        last_error_code: null,
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:mark_refresh_unknown")) {
      const [errorCode, updatedAt, accountKey, revision, refreshLeaseToken] = bindings;
      if (
        !this.row
        || this.row.account_key !== accountKey
        || this.row.refresh_status !== "in_flight"
        || this.row.refresh_revision !== revision
        || this.row.refresh_lease_token !== refreshLeaseToken
      ) return changed(0);
      Object.assign(this.row, {
        refresh_status: "refresh_outcome_unknown",
        refresh_lease_token: null,
        refresh_lease_expires_at: null,
        last_error_code: errorCode,
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:checkpoint_refresh")) {
      if (this.beforeCheckpoint) this.beforeCheckpoint(this);
      const [
        accessToken,
        accessExpiresAt,
        refreshToken,
        updatedAt,
        accountKey,
        revision,
        refreshLeaseToken,
      ] = bindings;
      const matches = this.row
        && this.row.account_key === accountKey
        && this.row.refresh_status === "in_flight"
        && this.row.refresh_revision === revision
        && this.row.refresh_lease_token === refreshLeaseToken;
      if (!matches || ["zero", "throw"].includes(this.checkpointMode)) {
        if (this.checkpointMode === "throw") throw new Error("D1 unavailable");
        return changed(0);
      }
      Object.assign(this.row, {
        access_token: accessToken,
        access_expires_at: accessExpiresAt,
        refresh_token: refreshToken,
        refresh_status: "ready",
        refresh_lease_token: null,
        refresh_lease_expires_at: null,
        last_error_code: null,
        updated_at: updatedAt,
      });
      if (this.checkpointMode === "commit_then_throw") {
        throw new Error("D1 response lost after commit");
      }
      return changed(1);
    }

    throw new Error("Unexpected run SQL");
  }
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function authRow(overrides = {}) {
  return {
    account_key: "utah",
    access_token: "expired-access",
    access_expires_at: Date.now() - 1,
    refresh_token: "refresh-v7",
    refresh_revision: 7,
    refresh_status: "ready",
    refresh_lease_token: null,
    refresh_lease_expires_at: null,
    last_error_code: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function envFor(database) {
  return {
    ANGI_ROUTER_DB: database,
    JOBBER_CLIENT_ID: "website-client-id",
    JOBBER_CLIENT_SECRET: "website-client-secret",
  };
}

function successfulTokenFetch(callCounter) {
  return async (url, options) => {
    callCounter.count += 1;
    assert.equal(String(url), "https://api.getjobber.com/api/oauth/token");
    assert.match(String(options.body), /refresh_token=refresh-v7/);
    return Response.json({
      access_token: "access-v8",
      refresh_token: "refresh-v8",
      expires_in: 3600,
    });
  };
}

test("rotates once through the authoritative D1 revision fence", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  const calls = { count: 0 };
  globalThis.fetch = successfulTokenFetch(calls);

  const result = await leads.refreshJobberAccessToken(
    envFor(database),
    leads.MARKET_ROUTES.ut,
  );

  assert.equal(result.accessToken, "access-v8");
  assert.equal(result.tokenRotated, true);
  assert.equal(calls.count, 1);
  assert.equal(database.row.refresh_revision, 8);
  assert.equal(database.row.refresh_status, "ready");
  assert.equal(database.row.refresh_token, "refresh-v8");
  assert.equal(database.row.refresh_lease_token, null);
  assert.equal(database.row.last_error_code, null);
});

test("transport ambiguity fences the token and never replays it", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("response lost");
  };

  await assert.rejects(
    leads.refreshJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut),
    (error) => error?.details?.code === "jobber_refresh_transport_unknown",
  );
  assert.equal(database.row.refresh_status, "refresh_outcome_unknown");
  assert.equal(database.row.last_error_code, "provider_transport_unknown");

  await assert.rejects(
    leads.refreshJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut),
    (error) => error?.details?.code === "jobber_refresh_outcome_unknown",
  );
  assert.equal(calls, 1);
});

test("verifies a refresh checkpoint whose D1 response was lost after commit", async () => {
  const database = new TokenAuthorityD1({
    row: authRow(),
    checkpointMode: "commit_then_throw",
  });
  const calls = { count: 0 };
  globalThis.fetch = successfulTokenFetch(calls);

  const result = await leads.refreshJobberAccessToken(
    envFor(database),
    leads.MARKET_ROUTES.ut,
  );
  assert.equal(result.accessToken, "access-v8");
  assert.equal(database.row.refresh_status, "ready");
  assert.equal(calls.count, 1);
});

test("an unverified checkpoint becomes unknown and cannot replay the old token", async () => {
  const database = new TokenAuthorityD1({
    row: authRow(),
    checkpointMode: "zero",
  });
  const calls = { count: 0 };
  globalThis.fetch = successfulTokenFetch(calls);

  await assert.rejects(
    leads.refreshJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut),
    (error) => error?.details?.code === "jobber_refresh_checkpoint_unknown",
  );
  assert.equal(database.row.refresh_status, "refresh_outcome_unknown");

  await assert.rejects(
    leads.refreshJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut),
    (error) => error?.details?.code === "jobber_refresh_outcome_unknown",
  );
  assert.equal(calls.count, 1);
});

test("a stale refresh cannot overwrite a newer OAuth reauthorization", async () => {
  const database = new TokenAuthorityD1({
    row: authRow(),
    beforeCheckpoint(instance) {
      instance.row = authRow({
        access_token: "reauthorized-access",
        access_expires_at: Date.now() + 3_600_000,
        refresh_token: "reauthorized-refresh",
        refresh_revision: 9,
        refresh_status: "ready",
        refresh_lease_token: null,
        refresh_lease_expires_at: null,
      });
    },
  });
  const calls = { count: 0 };
  globalThis.fetch = successfulTokenFetch(calls);

  await assert.rejects(
    leads.refreshJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut),
    (error) => error?.details?.code === "jobber_refresh_checkpoint_unknown",
  );
  assert.equal(database.row.access_token, "reauthorized-access");
  assert.equal(database.row.refresh_token, "reauthorized-refresh");
  assert.equal(database.row.refresh_status, "ready");

  const cached = await leads.refreshJobberAccessToken(
    envFor(database),
    leads.MARKET_ROUTES.ut,
  );
  assert.equal(cached.accessToken, "reauthorized-access");
  assert.equal(calls.count, 1);
});

test("an expired in-flight refresh is fenced without another provider call", async () => {
  const database = new TokenAuthorityD1({
    row: authRow({
      refresh_revision: 8,
      refresh_status: "in_flight",
      refresh_lease_token: "abandoned-lease",
      refresh_lease_expires_at: Date.now() - 1,
    }),
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("must not run");
  };

  await assert.rejects(
    leads.refreshJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut),
    (error) => error?.details?.code === "jobber_refresh_lease_expired",
  );
  assert.equal(database.row.refresh_status, "refresh_outcome_unknown");
  assert.equal(database.row.last_error_code, "refresh_lease_expired");
  assert.equal(calls, 0);
});

test("missing authoritative D1 fails closed without touching Jobber", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("must not run");
  };
  await assert.rejects(
    leads.refreshJobberAccessToken({}, leads.MARKET_ROUTES.ut),
    (error) => error?.details?.code === "jobber_authoritative_database_unavailable",
  );
  assert.equal(calls, 0);
});

test("an unauthorized Jobber response fences the cached access token", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "live-access", access_expires_at: Date.now() + 3_600_000,
  }) });
  assert.equal(await leads.fenceJobberAccessToken(
    envFor(database), leads.MARKET_ROUTES.ut, "jobber_http_401",
    { accessToken: "live-access", refreshRevision: 7 },
  ), true);
  assert.equal(database.row.access_expires_at, 0);
  assert.equal(database.row.refresh_status, "ready");
  assert.equal(database.row.last_error_code, "jobber_http_401");
});

test("a second unauthorized response marks the Jobber authorization broken", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "refreshed-access", access_expires_at: Date.now() + 3_600_000,
  }) });
  assert.equal(await leads.markJobberAuthorizationBroken(
    envFor(database), leads.MARKET_ROUTES.ut, "jobber_http_401_after_refresh",
    { accessToken: "refreshed-access", refreshRevision: 7 },
  ), true);
  assert.equal(database.row.access_expires_at, 0);
  assert.equal(database.row.refresh_status, "refresh_outcome_unknown");
  assert.equal(database.row.last_error_code, "jobber_http_401_after_refresh");
});

test("a stale 401 cannot fence or break a newer or in-flight token revision", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "new-access", access_expires_at: Date.now() + 3_600_000,
    refresh_revision: 8,
  }) });
  const old = { accessToken: "old-access", refreshRevision: 7 };
  assert.equal(await leads.fenceJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut, "jobber_http_401", old), false);
  assert.equal(await leads.markJobberAuthorizationBroken(envFor(database), leads.MARKET_ROUTES.ut, "jobber_http_401_after_refresh", old), false);
  assert.equal(database.row.access_token, "new-access");
  assert.equal(database.row.refresh_status, "ready");
  assert.ok(database.row.access_expires_at > Date.now());

  Object.assign(database.row, {
    access_token: "old-access", refresh_revision: 8, refresh_status: "in_flight",
    refresh_lease_token: "another-caller", refresh_lease_expires_at: Date.now() + 60_000,
  });
  assert.equal(await leads.fenceJobberAccessToken(envFor(database), leads.MARKET_ROUTES.ut, "jobber_http_401", old), false);
  assert.equal(await leads.markJobberAuthorizationBroken(envFor(database), leads.MARKET_ROUTES.ut, "jobber_http_401_after_refresh", old), false);
  assert.equal(database.row.refresh_status, "in_flight");
  assert.equal(database.row.refresh_lease_token, "another-caller");
});

test("failed website intake is durably queued with sanitized diagnostics", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  const lead = intakeLead("queue-submission");
  const error = new leads.LeadSubmissionError("Jobber failed", 401, { code: "jobber_http_401_after_refresh" });
  assert.equal(await leads.recordWebsiteLeadIntakeFailure(envFor(database), lead, error), true);
  const failure = database.failures.get("queue-submission");
  assert.equal(failure.market, "ut");
  assert.equal(failure.code, "jobber_http_401_after_refresh");
  assert.equal(failure.status, 401);
  assert.equal(failure.payload.phone, lead.phone);
  assert.equal(failure.payload.submission_id, lead.submission_id);
  assert.equal(failure.attempts, 1);
  assert.ok(Date.parse(failure.expiresAt) - Date.parse(failure.nextRetryAt) >= 13 * 24 * 60 * 60 * 1000);
});

test("the 0011 recovery table persists failed intake and counts a same-ID retry", async () => {
  const raw = new DatabaseSync(":memory:");
  try {
    raw.exec(fs.readFileSync(new URL("../migrations/0011_website_lead_intake_failures.sql", import.meta.url), "utf8"));
    const database = {
      prepare(sql) {
        return {
          bind(...bindings) {
            return {
              run() {
                const result = raw.prepare(sql).run(...bindings);
                return { meta: { changes: Number(result.changes) } };
              },
            };
          },
        };
      },
    };
    const lead = intakeLead("queue-schema-retry");
    const error = new leads.LeadSubmissionError("Jobber failed", 401, { code: "jobber_http_401_after_refresh" });
    assert.equal(await leads.recordWebsiteLeadIntakeFailure({ ANGI_ROUTER_DB: database }, lead, error), true);
    assert.equal(await leads.recordWebsiteLeadIntakeFailure({ ANGI_ROUTER_DB: database }, lead, error), true);
    const row = raw.prepare("SELECT market_key, source_key, payload_json, error_code, state, attempt_count, expires_at FROM website_lead_intake_failures WHERE submission_id = ?").get(lead.submission_id);
    assert.equal(row.market_key, "ut");
    assert.equal(row.source_key, lead.source_key);
    assert.equal(JSON.parse(row.payload_json).phone, lead.phone);
    assert.equal(row.error_code, "jobber_http_401_after_refresh");
    assert.equal(row.state, "pending");
    assert.equal(row.attempt_count, 2);
    assert.ok(Date.parse(row.expires_at) > Date.now());
  } finally {
    raw.close();
  }
});

function intakeLead(submissionId = "submission-flow-1") {
  return leads.buildLead({
    first_name: "Flow", last_name: "Test", phone: "8015550123",
    email: "flow@example.test", street_address: "1 Main St", city: "Sandy",
    state: "UT", zip: "84070", message: "Please call",
  }, submissionId);
}

function intakeRequest(submissionId) {
  return new Request("https://goodattic.energy/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      submission_id: submissionId, first_name: "Flow", last_name: "Test",
      phone: "8015550123", email: "flow@example.test", street_address: "1 Main St",
      city: "Sandy", state: "UT", zip: "84070", message: "Please call",
    }),
  });
}

function flowFetch({ clientUnauthorizedOnce = false, clientUnauthorizedTwice = false, requestUnauthorizedOnce = false, unexpectedClientError = false } = {}) {
  const calls = { client: 0, request: 0, token: 0, authorizations: [] };
  return {
    calls,
    fetch: async (url, options) => {
      if (String(url).includes("/oauth/token")) {
        calls.token += 1;
        return Response.json({ access_token: `access-${calls.token}`, refresh_token: `refresh-${calls.token}`, expires_in: 3600 });
      }
      const body = JSON.parse(options.body);
      calls.authorizations.push(options.headers.Authorization);
      if (body.query.includes("GoodAtticClientCreate")) {
        calls.client += 1;
        if (unexpectedClientError) throw new Error("network interrupted");
        if (clientUnauthorizedTwice || (clientUnauthorizedOnce && calls.client === 1)) {
          return new Response("unauthorized", { status: 401 });
        }
        return Response.json({ data: { clientCreate: { client: {
          id: "client-flow", jobberWebUri: "https://secure.getjobber.com/clients/1",
          clientProperties: { nodes: [{ id: "property-flow", jobberWebUri: "https://secure.getjobber.com/properties/1" }] },
        }, userErrors: [] } } });
      }
      if (body.query.includes("GoodAtticRequestCreate")) {
        calls.request += 1;
        if (requestUnauthorizedOnce && calls.request === 1) return new Response("unauthorized", { status: 401 });
        assert.equal(body.variables.input.clientId, "client-flow");
        return Response.json({ data: { requestCreate: { request: {
          id: "request-flow", jobberWebUri: "https://secure.getjobber.com/requests/1",
          property: { id: "property-flow", jobberWebUri: "https://secure.getjobber.com/properties/1" },
        }, userErrors: [] } } });
      }
      throw new Error("Unexpected Jobber operation");
    },
  };
}

function envWithAlerts(database, alerts, status = 202) {
  return {
    ...envFor(database),
    CONTACT_SYNC_BROKER_SECRET: "test-broker-secret",
    CONTACT_SYNC_SERVICE: {
      async fetch(request) {
        assert.equal(new URL(request.url).pathname, "/internal/website-lead-failure");
        assert.equal(request.headers.get("authorization"), "Bearer test-broker-secret");
        alerts.push(await request.json());
        return new Response(null, { status });
      },
    },
    EXTERNAL_API_WRITES_ENABLED: "false",
  };
}

test("website failure alert builder preserves the exact worker contract for every market", () => {
  const occurredAt = new Date("2026-10-02T12:34:56.000Z");
  const submissionId = "f559167d-4b0a-4a2c-9e35-8980f67feae2";
  for (const market of ["ut", "mo_stl", "mo_kc", "general"]) {
    const lead = { ...intakeLead(submissionId), market_key: market };
    assert.deepEqual(leads.buildWebsiteLeadIntakeFailureAlert(
      lead, new leads.LeadSubmissionError("Failed", 503, { code: "jobber_unavailable" }), occurredAt,
    ), {
      id: submissionId,
      market,
      occurred_at: "2026-10-02T12:34:56.000Z",
      reason: "jobber_unavailable",
      contact_name: "Flow Test",
      phone: "8015550123",
      email: "flow@example.test",
      message: "Please call",
    });
  }
});

test("website failure alert sends the builder's payload to the worker route", async () => {
  const lead = intakeLead("failure-alert-delivery");
  let delivered;
  const env = envWithAlerts(null, []);
  env.CONTACT_SYNC_SERVICE = {
    async fetch(request) {
      assert.equal(new URL(request.url).pathname, "/internal/website-lead-failure");
      assert.equal(request.headers.get("authorization"), "Bearer test-broker-secret");
      delivered = await request.json();
      return new Response(null, { status: 202 });
    },
  };
  const before = Date.now();
  const sent = await leads.notifyWebsiteLeadIntakeFailure(env, lead, new Error("network interrupted"));
  const after = Date.now();
  assert.equal(sent, true);
  assert.ok(Date.parse(delivered.occurred_at) >= before);
  assert.ok(Date.parse(delivered.occurred_at) <= after);
  assert.deepEqual({ ...delivered, occurred_at: "2026-10-02T12:34:56.000Z" },
    leads.buildWebsiteLeadIntakeFailureAlert(lead, new Error("network interrupted"),
      new Date("2026-10-02T12:34:56.000Z")));
});

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

test("an expired token refreshes before client and Request creation", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  const plan = flowFetch();
  globalThis.fetch = plan.fetch;
  const result = await leads.submitLeadToJobber(envFor(database), intakeLead());
  assert.equal(result.request_id, "request-flow");
  assert.equal(plan.calls.token, 1);
  assert.equal(plan.calls.client, 1);
  assert.equal(plan.calls.request, 1);
  assert.deepEqual(plan.calls.authorizations, ["bearer access-1", "bearer access-1"]);
});

test("a client 401 refreshes once and creates one client and Request", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "cached-access", access_expires_at: Date.now() + 3_600_000,
  }) });
  const plan = flowFetch({ clientUnauthorizedOnce: true });
  globalThis.fetch = plan.fetch;
  const result = await leads.submitLeadToJobber(envFor(database), intakeLead());
  assert.equal(result.client_id, "client-flow");
  assert.equal(result.request_id, "request-flow");
  assert.equal(plan.calls.token, 1);
  assert.equal(plan.calls.client, 2);
  assert.equal(plan.calls.request, 1);
  assert.deepEqual(plan.calls.authorizations, ["bearer cached-access", "bearer access-1", "bearer access-1"]);
});

test("simultaneous stale 401s share one in-flight refresh and each create only one Client and Request", async () => {
  const refreshStarted = deferred();
  const finishRefresh = deferred();
  const secondFenceObserved = deferred();
  const fences = [];
  const database = new TokenAuthorityD1({
    row: authRow({ access_token: "old-access", access_expires_at: Date.now() + 3_600_000 }),
    onFence(result) {
      fences.push(result);
      if (!result.changed && result.row?.refresh_status === "in_flight") secondFenceObserved.resolve();
    },
  });
  const calls = { oldClient: 0, newClient: 0, request: 0, token: 0 };
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/oauth/token")) {
      calls.token += 1;
      refreshStarted.resolve();
      await finishRefresh.promise;
      return Response.json({ access_token: "new-access", refresh_token: "refresh-v8", expires_in: 3600 });
    }
    const body = JSON.parse(options.body);
    const authorization = options.headers.Authorization;
    if (body.query.includes("GoodAtticClientCreate")) {
      if (authorization === "bearer old-access") {
        calls.oldClient += 1;
        if (calls.oldClient === 2) await refreshStarted.promise;
        return new Response("unauthorized", { status: 401 });
      }
      assert.equal(authorization, "bearer new-access");
      calls.newClient += 1;
      return Response.json({ data: { clientCreate: { client: {
        id: `client-${calls.newClient}`, clientProperties: { nodes: [] },
      }, userErrors: [] } } });
    }
    assert.ok(body.query.includes("GoodAtticRequestCreate"));
    assert.equal(authorization, "bearer new-access");
    calls.request += 1;
    return Response.json({ data: { requestCreate: { request: {
      id: `request-for-${body.variables.input.clientId}`, property: null,
    }, userErrors: [] } } });
  };

  const first = leads.submitLeadToJobber(envFor(database), intakeLead("simultaneous-a"));
  const second = leads.submitLeadToJobber(envFor(database), intakeLead("simultaneous-b"));
  try {
    await secondFenceObserved.promise;
    assert.equal(database.row.refresh_status, "in_flight");
    assert.equal(database.row.refresh_revision, 8);
    assert.equal(database.row.refresh_lease_token !== null, true);
    finishRefresh.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(calls.token, 1);
    assert.equal(calls.oldClient, 2);
    assert.equal(calls.newClient, 2);
    assert.equal(calls.request, 2);
    assert.equal(new Set(results.map(result => result.client_id)).size, 2);
    assert.equal(new Set(results.map(result => result.request_id)).size, 2);
    assert.equal(database.row.refresh_status, "ready");
    assert.equal(database.row.access_token, "new-access");
    assert.equal(fences.filter(result => result.changed).length, 1);
    assert.equal(fences.filter(result => !result.changed).length, 1);
  } finally {
    finishRefresh.resolve();
  }
});

test("a Request 401 retries only that Request with the existing client and transaction callback", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "cached-access", access_expires_at: Date.now() + 3_600_000,
  }) });
  const plan = flowFetch({ requestUnauthorizedOnce: true });
  globalThis.fetch = plan.fetch;
  const observed = { writes: 0, clients: [] };
  const result = await leads.submitLeadToJobber(envFor(database), intakeLead(), {
    onWriteAttempt: () => { observed.writes += 1; },
    onClientCreated: client => { observed.clients.push(client); },
  });
  assert.equal(result.request_id, "request-flow");
  assert.equal(plan.calls.token, 1);
  assert.equal(plan.calls.client, 1);
  assert.equal(plan.calls.request, 2);
  assert.equal(observed.writes, 1);
  assert.deepEqual(observed.clients, [{ client_id: "client-flow", account_id: leads.MARKET_ROUTES.ut.expectedAccountId }]);
  assert.deepEqual(plan.calls.authorizations, ["bearer cached-access", "bearer cached-access", "bearer access-1"]);
});

test("two client 401s break authorization and queue and alert the failed lead", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "cached-access", access_expires_at: Date.now() + 3_600_000,
  }) });
  const plan = flowFetch({ clientUnauthorizedTwice: true });
  globalThis.fetch = plan.fetch;
  const alerts = [];
  const response = await onRequestPost({
    env: envWithAlerts(database, alerts),
    request: intakeRequest("24b761db-5719-47ec-b3ae-33ca59309fb5"),
  });
  assert.equal(response.status, 401);
  assert.equal(database.row.refresh_status, "refresh_outcome_unknown");
  assert.equal(database.row.last_error_code, "jobber_http_401_after_refresh");
  assert.equal(plan.calls.client, 2);
  assert.equal(plan.calls.request, 0);
  assert.equal(database.failures.size, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].market, "ut");
  assert.equal(alerts[0].id, "24b761db-5719-47ec-b3ae-33ca59309fb5");
});

test("the next lead after broken authorization is queued and alerted without another Jobber call", async () => {
  const database = new TokenAuthorityD1({ row: authRow({ refresh_status: "refresh_outcome_unknown" }) });
  const alerts = [];
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Jobber must not be called"); };
  const env = envWithAlerts(database, alerts);
  for (const id of ["cc806437-ce4a-4a10-904a-e103d36a5ae1", "acf5c675-b579-4d4f-b296-536629c9cc61"]) {
    const response = await onRequestPost({ env, request: intakeRequest(id) });
    assert.equal(response.status, 503);
    assert.equal(database.failures.get(id).code, "jobber_refresh_outcome_unknown");
  }
  assert.equal(calls, 0);
  assert.equal(database.failures.size, 2);
  assert.deepEqual(alerts.map(alert => alert.id), [
    "cc806437-ce4a-4a10-904a-e103d36a5ae1", "acf5c675-b579-4d4f-b296-536629c9cc61",
  ]);
});

test("an unexpected Jobber network error is queued and alerted", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "cached-access", access_expires_at: Date.now() + 3_600_000,
  }) });
  const plan = flowFetch({ unexpectedClientError: true });
  globalThis.fetch = plan.fetch;
  const alerts = [];
  const id = "28cd5319-3dd3-41c9-8979-72af70e7dd20";
  const response = await onRequestPost({ env: envWithAlerts(database, alerts), request: intakeRequest(id) });
  assert.equal(response.status, 500);
  assert.equal(database.failures.get(id).code, "jobber_lead_intake_failed");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, id);
  assert.equal(plan.calls.client, 1);
  assert.equal(plan.calls.request, 0);
});

test("a successful same-submission retry clears its pending failed-lead queue entry", async () => {
  const database = new TokenAuthorityD1({ row: authRow({
    access_token: "cached-access", access_expires_at: Date.now() + 3_600_000,
  }) });
  const alerts = [];
  const env = envWithAlerts(database, alerts);
  const id = "9be84424-8c19-455c-81e8-0f7457edbda1";
  const previousError = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = flowFetch({ unexpectedClientError: true }).fetch;
    const failed = await onRequestPost({ env, request: intakeRequest(id) });
    assert.equal(failed.status, 500);
    assert.equal(database.failures.has(id), true);
    assert.equal(alerts.length, 1);

    const plan = flowFetch();
    globalThis.fetch = plan.fetch;
    const recovered = await onRequestPost({ env, request: intakeRequest(id) });
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).jobber.request_id, "request-flow");
    assert.equal(plan.calls.client, 1);
    assert.equal(plan.calls.request, 1);
    assert.equal(database.failures.has(id), false);
  } finally {
    console.error = previousError;
  }
});

test("a recovery-queue write failure still sends the lead failure alert", async () => {
  const database = new TokenAuthorityD1({
    row: authRow({ refresh_status: "refresh_outcome_unknown" }),
    failureWriteMode: "throw",
  });
  const alerts = [];
  const errors = [];
  const previousError = console.error;
  console.error = (message, fields) => { errors.push({ message, fields }); };
  try {
    const response = await onRequestPost({
      env: envWithAlerts(database, alerts),
      request: intakeRequest("7da25359-7295-4f96-93dd-d5982418d6e5"),
    });
    assert.equal(response.status, 503);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].id, "7da25359-7295-4f96-93dd-d5982418d6e5");
    assert.ok(errors.some(entry => entry.message === "Website lead recovery queue write failed"));
  } finally {
    console.error = previousError;
  }
});

test("a stalled failed-lead queue cannot block the alert or customer error response", async () => {
  const database = new TokenAuthorityD1({
    row: authRow({ refresh_status: "refresh_outcome_unknown" }),
    failureWriteMode: "hang",
  });
  const alerts = [];
  const env = { ...envWithAlerts(database, alerts), LEAD_INTAKE_RECOVERY_TIMEOUT_MS: 5 };
  const previousError = console.error;
  console.error = () => {};
  try {
    const started = Date.now();
    const response = await onRequestPost({
      env, request: intakeRequest("7fb44af3-5215-4e1f-ad9c-f3027b1085b1"),
    });
    assert.equal(response.status, 503);
    assert.ok(Date.now() - started < 500);
    assert.equal(alerts.length, 1);
  } finally {
    console.error = previousError;
  }
});

test("a stalled failure-alert service cannot block a queued lead's error response", async () => {
  const database = new TokenAuthorityD1({ row: authRow({ refresh_status: "refresh_outcome_unknown" }) });
  const env = {
    ...envWithAlerts(database, []),
    LEAD_INTAKE_RECOVERY_TIMEOUT_MS: 5,
    CONTACT_SYNC_SERVICE: { fetch: () => new Promise(() => {}) },
  };
  const previousError = console.error;
  console.error = () => {};
  try {
    const started = Date.now();
    const response = await onRequestPost({
      env, request: intakeRequest("f559167d-4b0a-4a2c-9e35-8980f67feae2"),
    });
    assert.equal(response.status, 503);
    assert.ok(Date.now() - started < 500);
    assert.equal(database.failures.size, 1);
  } finally {
    console.error = previousError;
  }
});

test("a non-202 failure alert response is logged with its status", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  const errors = [];
  const previousError = console.error;
  console.error = (message, fields) => { errors.push({ message, fields }); };
  try {
    const sent = await leads.notifyWebsiteLeadIntakeFailure(
      envWithAlerts(database, [], 503), intakeLead(),
      new leads.LeadSubmissionError("Failed", 503, { code: "jobber_refresh_outcome_unknown" }),
    );
    assert.equal(sent, false);
    assert.ok(errors.some(entry => entry.message === "Website lead failure alert was not accepted" && entry.fields.status === 503));
    assert.ok(errors.every(entry => !JSON.stringify(entry).includes("8015550123")));
  } finally {
    console.error = previousError;
  }
});

test("a complete D1 outage blocks Jobber intake but still alerts and returns a visible failure", async () => {
  const alerts = [];
  let jobberCalls = 0;
  globalThis.fetch = async () => { jobberCalls += 1; throw new Error("Jobber must not be called without authoritative D1"); };
  const env = {
    CONTACT_SYNC_BROKER_SECRET: "test-broker-secret",
    CONTACT_SYNC_SERVICE: {
      async fetch(request) {
        alerts.push(await request.json());
        return new Response(null, { status: 202 });
      },
    },
  };
  const priorError = console.error;
  console.error = () => {};
  try {
    const response = await onRequestPost({
      env,
      request: intakeRequest("87a09e19-5847-4a36-a789-83575b29cc97"),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.details.code, "jobber_authoritative_database_unavailable");
    assert.equal(jobberCalls, 0);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].id, "87a09e19-5847-4a36-a789-83575b29cc97");
  } finally {
    console.error = priorError;
  }
});
