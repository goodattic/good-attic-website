import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { _private as leads } from "../functions/api/leads.js";

function changed(count) {
  return { meta: { changes: count } };
}

class TokenAuthorityD1 {
  constructor({ row, checkpointMode = "ok", beforeCheckpoint = null } = {}) {
    this.row = row ? { ...row } : null;
    this.checkpointMode = checkpointMode;
    this.beforeCheckpoint = beforeCheckpoint;
    this.locks = new Map();
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
      this.failure = bindings;
      return changed(1);
    }
    if (sql.includes("jobber_token_authority:fence_unauthorized_access")) {
      const [errorCode, updatedAt, accountKey] = bindings;
      if (!this.row || this.row.account_key !== accountKey) return changed(0);
      Object.assign(this.row, {
        access_expires_at: 0,
        refresh_status: "ready",
        last_error_code: errorCode,
        updated_at: updatedAt,
      });
      return changed(1);
    }

    if (sql.includes("jobber_token_authority:mark_unauthorized_broken")) {
      const [errorCode, updatedAt, accountKey] = bindings;
      if (!this.row || this.row.account_key !== accountKey) return changed(0);
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
  const database = new TokenAuthorityD1({
    row: authRow({
      access_token: "live-access",
      access_expires_at: Date.now() + 3_600_000,
    }),
  });

  const changedRows = await leads.fenceJobberAccessToken(
    envFor(database),
    leads.MARKET_ROUTES.ut,
    "jobber_http_401",
  );

  assert.equal(changedRows, true);
  assert.equal(database.row.access_expires_at, 0);
  assert.equal(database.row.refresh_status, "ready");
  assert.equal(database.row.last_error_code, "jobber_http_401");
});

test("a second unauthorized response marks the Jobber authorization broken", async () => {
  const database = new TokenAuthorityD1({
    row: authRow({
      access_token: "refreshed-access",
      access_expires_at: Date.now() + 3_600_000,
    }),
  });

  const changedRows = await leads.markJobberAuthorizationBroken(
    envFor(database),
    leads.MARKET_ROUTES.ut,
    "jobber_http_401_after_refresh",
  );

  assert.equal(changedRows, true);
  assert.equal(database.row.access_expires_at, 0);
  assert.equal(database.row.refresh_status, "refresh_outcome_unknown");
  assert.equal(database.row.last_error_code, "jobber_http_401_after_refresh");
});

test("failed website intake is durably queued without exposing secrets in diagnostics", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  const lead = {
    submission_id: "submission-queue-1",
    market_key: "utah",
    source_key: "website",
    first_name: "Test",
    last_name: "Lead",
    full_name: "Test Lead",
    phone: "+18015550123",
    email: "test@example.com",
    address: "1 Main St",
    city: "Sandy",
    state: "UT",
    zip: "84070",
    message: "Please call",
  };
  const error = new leads.LeadSubmissionError("Jobber failed", 401, { code: "jobber_http_401_after_refresh" });
  assert.equal(await leads.recordWebsiteLeadIntakeFailure(envFor(database), lead, error), true);
  assert.equal(database.failure[0], lead.submission_id);
  assert.equal(database.failure[1], "utah");
  assert.equal(database.failure[4], "jobber_http_401_after_refresh");
  assert.equal(database.failure[5], 401);
  assert.match(database.failure[6], /^2026-/);
  assert.match(database.failure[7], /^2026-/);
  assert.match(database.failure[3], /submission-queue-1/);
});

function intakeLead() {
  return leads.buildLead({
    first_name: "Flow",
    last_name: "Test",
    phone: "8015550123",
    email: "flow@example.com",
    street_address: "1 Main St",
    city: "Sandy",
    state: "UT",
    zip: "84070",
    message: "Please call",
  }, "submission-flow-1");
}

function flowFetch({ requestUnauthorizedOnce = false, clientUnauthorizedTwice = false } = {}) {
  const calls = { client: 0, request: 0, token: 0 };
  return {
    calls,
    fetch: async (url, options) => {
      if (String(url).includes("/oauth/token")) {
        calls.token += 1;
        return Response.json({ access_token: `access-${calls.token}`, refresh_token: `refresh-${calls.token}`, expires_in: 3600 });
      }
      const body = JSON.parse(options.body);
      if (body.query.includes("ClientCreate")) {
        calls.client += 1;
        if (clientUnauthorizedTwice) return new Response("unauthorized", { status: 401 });
        return Response.json({ data: { clientCreate: { client: { id: "client-flow", firstName: "Flow", lastName: "Test", jobberWebUri: "https://secure.getjobber.com/clients/1", clientProperties: { nodes: [{ id: "property-flow", jobberWebUri: "https://secure.getjobber.com/properties/1" }] } }, userErrors: [] } } });
      }
      calls.request += 1;
      if (requestUnauthorizedOnce && calls.request === 1) return new Response("unauthorized", { status: 401 });
      return Response.json({ data: { requestCreate: { request: { id: "request-flow", jobberWebUri: "https://secure.getjobber.com/requests/1", property: { id: "property-flow", jobberWebUri: "https://secure.getjobber.com/properties/1" } }, userErrors: [] } } });
    },
  };
}

test("submitLeadToJobber refreshes after a Request 401 and reuses the created client", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  const plan = flowFetch({ requestUnauthorizedOnce: true });
  globalThis.fetch = plan.fetch;
  const result = await leads.submitLeadToJobber(envFor(database), intakeLead());
  assert.equal(result.client_id, "client-flow");
  assert.equal(result.request_id, "request-flow");
  assert.equal(plan.calls.client, 1);
  assert.equal(plan.calls.request, 2);
  assert.equal(database.row.last_error_code, null);
});

test("submitLeadToJobber marks authorization broken after two client 401s", async () => {
  const database = new TokenAuthorityD1({ row: authRow() });
  const plan = flowFetch({ clientUnauthorizedTwice: true });
  globalThis.fetch = plan.fetch;
  await assert.rejects(
    leads.submitLeadToJobber(envFor(database), intakeLead()),
    error => error?.status === 401,
  );
  assert.equal(plan.calls.client, 2);
  assert.equal(plan.calls.request, 0);
  assert.equal(database.row.refresh_status, "refresh_outcome_unknown");
  assert.equal(database.row.last_error_code, "jobber_http_401_after_refresh");
});
