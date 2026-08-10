import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import {
  handleJobberAppointmentWebhook,
} from "../server/jobber-appointment-webhook.js";
import {
  _private as resolverPrivate,
  buildAppointmentSignal,
  handleJobberAppointmentResolve,
} from "../server/jobber-appointment-resolver.js";
import appointmentConsumer, {
  _private as consumerPrivate,
} from "../workers/jobber-appointment-consumer.js";

const ACCOUNT_IDS = {
  ut: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==",
  mo_stl: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==",
  mo_kc: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function changed(count) {
  return { meta: { changes: count } };
}

async function hmacHeader(rawBody, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  return Buffer.from(signature).toString("base64");
}

function webhookBody({
  topic = "ASSESSMENT_UPDATE",
  accountId = ACCOUNT_IDS.mo_kc,
  itemId = "assessment-123",
} = {}) {
  return JSON.stringify({
    data: {
      webHookEvent: {
        topic,
        appId: "website-app",
        accountId,
        itemId,
        occurredAt: "2026-08-05T10:30:00-06:00",
      },
    },
  });
}

class QueueCapture {
  constructor() {
    this.messages = [];
  }

  async send(message) {
    this.messages.push(message);
  }
}

test("verifies a Jobber Assessment webhook and enqueues a PII-free market-pinned event", async () => {
  const secret = "website-jobber-client-secret";
  const rawBody = webhookBody();
  const queue = new QueueCapture();
  const response = await handleJobberAppointmentWebhook({
    request: new Request("https://goodattic.energy/api/jobber/webhooks/appointment-scheduled", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Jobber-Hmac-SHA256": await hmacHeader(rawBody, secret),
      },
      body: rawBody,
    }),
    env: {
      JOBBER_CLIENT_SECRET: secret,
      JOBBER_APPOINTMENT_QUEUE: queue,
    },
  });

  assert.equal(response.status, 202);
  assert.equal(queue.messages.length, 1);
  assert.deepEqual(
    {
      topic: queue.messages[0].topic,
      account_id: queue.messages[0].account_id,
      assessment_id: queue.messages[0].assessment_id,
      market_key: queue.messages[0].market_key,
      market_name: queue.messages[0].market_name,
    },
    {
      topic: "ASSESSMENT_UPDATE",
      account_id: ACCOUNT_IDS.mo_kc,
      assessment_id: "assessment-123",
      market_key: "mo_kc",
      market_name: "Kansas City",
    },
  );
  assert.equal("email" in queue.messages[0], false);
  assert.equal("phone" in queue.messages[0], false);
  assert.equal("contact_name" in queue.messages[0], false);
});

test("accepts a market-specific app signature and rejects an invalid signature", async () => {
  const rawBody = webhookBody({ accountId: ACCOUNT_IDS.ut });
  const queue = new QueueCapture();
  const valid = await handleJobberAppointmentWebhook({
    request: new Request("https://goodattic.energy/api/jobber/webhooks/appointment-scheduled", {
      method: "POST",
      headers: { "X-Jobber-Hmac-SHA256": await hmacHeader(rawBody, "slc-secret") },
      body: rawBody,
    }),
    env: {
      JOBBER_CLIENT_SECRET_SLC: "slc-secret",
      JOBBER_APPOINTMENT_QUEUE: queue,
    },
  });
  assert.equal(valid.status, 202);
  assert.equal(queue.messages.length, 1);

  const invalid = await handleJobberAppointmentWebhook({
    request: new Request("https://goodattic.energy/api/jobber/webhooks/appointment-scheduled", {
      method: "POST",
      headers: { "X-Jobber-Hmac-SHA256": await hmacHeader(rawBody, "wrong-secret") },
      body: rawBody,
    }),
    env: {
      JOBBER_CLIENT_SECRET_SLC: "slc-secret",
      JOBBER_APPOINTMENT_QUEUE: queue,
    },
  });
  assert.equal(invalid.status, 401);
  assert.equal(queue.messages.length, 1);
});

test("acknowledges but does not enqueue Visits or unapproved Jobber accounts", async () => {
  const secret = "website-jobber-client-secret";
  const queue = new QueueCapture();
  for (const rawBody of [
    webhookBody({ topic: "VISIT_CREATE" }),
    webhookBody({ accountId: "unknown-account" }),
  ]) {
    const response = await handleJobberAppointmentWebhook({
      request: new Request("https://goodattic.energy/api/jobber/webhooks/appointment-scheduled", {
        method: "POST",
        headers: { "X-Jobber-Hmac-SHA256": await hmacHeader(rawBody, secret) },
        body: rawBody,
      }),
      env: {
        JOBBER_CLIENT_SECRET: secret,
        JOBBER_APPOINTMENT_QUEUE: queue,
      },
    });
    assert.equal(response.status, 202);
  }
  assert.equal(queue.messages.length, 0);
});

test("builds the exact consumer event contract from an authoritative Assessment", () => {
  const route = resolverPrivate.ROUTES_BY_ACCOUNT_ID.get(ACCOUNT_IDS.mo_stl);
  const signal = buildAppointmentSignal({
    route,
    accountId: ACCOUNT_IDS.mo_stl,
    occurredAt: "2026-08-05T17:00:00Z",
    assessment: {
      id: "assessment-stl-1",
      startAt: "2026-08-08T16:00:00Z",
      endAt: "2026-08-08T17:00:00Z",
      title: "Attic assessment",
      client: {
        id: "client-1",
        name: "Customer Name",
        defaultEmails: ["customer@example.com"],
        defaultPhones: ["+13145550123"],
      },
      request: {
        id: "request-1",
        jobberWebUri: "https://secure.getjobber.com/requests/1",
      },
      property: { id: "property-1" },
    },
  });

  assert.deepEqual(signal, {
    event_name: "jobber.appointment_scheduled.v1",
    event_id: `jobber-assessment:${ACCOUNT_IDS.mo_stl}:assessment-stl-1`,
    event_occurred_at: "2026-08-05T17:00:00Z",
    route_to_sales_pipeline: true,
    market_key: "mo_stl",
    market_name: "St. Louis",
    appointment_type: "assessment",
    appointment_start_at: "2026-08-08T16:00:00Z",
    appointment_end_at: "2026-08-08T17:00:00Z",
    appointment_title: "Attic assessment",
    jobber_account_id: ACCOUNT_IDS.mo_stl,
    jobber_assessment_id: "assessment-stl-1",
    jobber_request_id: "request-1",
    jobber_client_id: "client-1",
    jobber_property_id: "property-1",
    jobber_request_url: "https://secure.getjobber.com/requests/1",
    contact_name: "Customer Name",
    email: "customer@example.com",
    phone: "+13145550123",
  });
});

test("the protected resolver rejects missing authorization before reading token storage", async () => {
  let databaseTouched = false;
  const response = await handleJobberAppointmentResolve({
    request: new Request("https://goodattic.energy/api/jobber/appointment-resolve", {
      method: "POST",
      body: "{}",
    }),
    env: {
      JOBBER_APPOINTMENT_BROKER_SECRET: "internal-secret",
      ANGI_ROUTER_DB: {
        prepare() {
          databaseTouched = true;
          throw new Error("must not run");
        },
      },
    },
  });
  assert.equal(response.status, 401);
  assert.equal(databaseTouched, false);
});

test("resolver reads the current Jobber Assessment through the existing website token row", async () => {
  const brokerSecret = "internal-broker-secret";
  const database = {
    prepare(sql) {
      assert.match(sql, /jobber_token_authority:select_auth/);
      return {
        bind(accountKey) {
          assert.equal(accountKey, "kc");
          return {
            async first() {
              return {
                access_token: "cached-website-access",
                access_expires_at: Date.now() + 3_600_000,
                refresh_token: "authoritative-refresh",
                refresh_revision: 4,
                refresh_status: "ready",
                refresh_lease_token: null,
                refresh_lease_expires_at: null,
                last_error_code: null,
              };
            },
          };
        },
      };
    },
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.getjobber.com/api/graphql");
    assert.equal(options.headers.Authorization, "bearer cached-website-access");
    const requestBody = JSON.parse(options.body);
    assert.match(requestBody.query, /assessment\(id: \$id\)/);
    assert.equal(requestBody.variables.id, "assessment-123");
    return Response.json({
      data: {
        assessment: {
          id: "assessment-123",
          startAt: "2026-08-08T16:00:00Z",
          endAt: "2026-08-08T17:00:00Z",
          title: "Attic assessment",
          client: {
            id: "client-1",
            name: "Customer Name",
            email: "customer@example.com",
            phone: "+18165550101",
            defaultEmails: [],
            defaultPhones: [],
          },
          request: {
            id: "request-1",
            jobberWebUri: "https://secure.getjobber.com/requests/1",
            contactName: "Customer Name",
            email: "customer@example.com",
            phone: "+18165550101",
          },
          property: { id: "property-1" },
        },
      },
    });
  };

  const response = await handleJobberAppointmentResolve({
    request: new Request("https://goodattic.energy/api/jobber/appointment-resolve", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${brokerSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_id: ACCOUNT_IDS.mo_kc,
        assessment_id: "assessment-123",
        market_key: "mo_kc",
        occurred_at: "2026-08-05T16:30:00Z",
      }),
    }),
    env: {
      JOBBER_APPOINTMENT_BROKER_SECRET: brokerSecret,
      ANGI_ROUTER_DB: database,
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "scheduled");
  assert.equal(body.signal.event_id, `jobber-assessment:${ACCOUNT_IDS.mo_kc}:assessment-123`);
  assert.equal(body.signal.market_key, "mo_kc");
  assert.equal(body.signal.jobber_client_id, "client-1");
});

class AppointmentLedgerD1 {
  constructor() {
    this.rows = new Map();
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
    if (!sql.includes("jobber_appointment_consumer:select")) {
      throw new Error("Unexpected first SQL");
    }
    const row = this.rows.get(bindings[0]);
    return row ? { ...row } : null;
  }

  async run(sql, bindings) {
    if (sql.includes("jobber_appointment_consumer:insert")) {
      const [eventId, accountId, assessmentId, marketKey, createdAt, updatedAt] = bindings;
      if (this.rows.has(eventId)) return changed(0);
      this.rows.set(eventId, {
        event_id: eventId,
        jobber_account_id: accountId,
        jobber_assessment_id: assessmentId,
        market_key: marketKey,
        status: "pending",
        attempt_count: 0,
        lease_token: null,
        lease_expires_at: null,
        last_error_code: null,
        created_at: createdAt,
        updated_at: updatedAt,
        delivered_at: null,
      });
      return changed(1);
    }
    if (sql.includes("jobber_appointment_consumer:claim")) {
      const [leaseToken, leaseExpiresAt, updatedAt, eventId, now] = bindings;
      const row = this.rows.get(eventId);
      const eligible = row
        && (
          ["pending", "not_scheduled", "failed_retryable"].includes(row.status)
          || (
            row.status === "processing"
            && (!row.lease_expires_at || row.lease_expires_at <= now)
          )
        );
      if (!eligible) return changed(0);
      Object.assign(row, {
        status: "processing",
        attempt_count: row.attempt_count + 1,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        last_error_code: null,
        updated_at: updatedAt,
      });
      return changed(1);
    }
    if (sql.includes("jobber_appointment_consumer:not_scheduled")) {
      const [updatedAt, eventId, leaseToken] = bindings;
      const row = this.rows.get(eventId);
      if (!row || row.status !== "processing" || row.lease_token !== leaseToken) return changed(0);
      Object.assign(row, {
        status: "not_scheduled",
        lease_token: null,
        lease_expires_at: null,
        last_error_code: null,
        updated_at: updatedAt,
      });
      return changed(1);
    }
    if (sql.includes("jobber_appointment_consumer:retryable")) {
      const [errorCode, updatedAt, eventId, leaseToken] = bindings;
      const row = this.rows.get(eventId);
      if (!row || row.status !== "processing" || row.lease_token !== leaseToken) return changed(0);
      Object.assign(row, {
        status: "failed_retryable",
        lease_token: null,
        lease_expires_at: null,
        last_error_code: errorCode,
        updated_at: updatedAt,
      });
      return changed(1);
    }
    if (sql.includes("jobber_appointment_consumer:manual_review")) {
      const [errorCode, updatedAt, eventId, leaseToken] = bindings;
      const row = this.rows.get(eventId);
      if (!row || row.status !== "processing" || row.lease_token !== leaseToken) return changed(0);
      Object.assign(row, {
        status: "manual_review",
        lease_token: null,
        lease_expires_at: null,
        last_error_code: errorCode,
        updated_at: updatedAt,
      });
      return changed(1);
    }
    if (sql.includes("jobber_appointment_consumer:delivered")) {
      const [deliveredAt, updatedAt, eventId, leaseToken] = bindings;
      const row = this.rows.get(eventId);
      if (!row || row.status !== "processing" || row.lease_token !== leaseToken) return changed(0);
      Object.assign(row, {
        status: "delivered",
        lease_token: null,
        lease_expires_at: null,
        last_error_code: null,
        delivered_at: deliveredAt,
        updated_at: updatedAt,
      });
      return changed(1);
    }
    throw new Error("Unexpected run SQL");
  }
}

function queueMessage(body) {
  return {
    body,
    actions: [],
    ack() {
      this.actions.push({ type: "ack" });
    },
    retry(options) {
      this.actions.push({ type: "retry", options });
    },
  };
}

function queuedAppointment(overrides = {}) {
  return {
    schema_version: 1,
    source: "jobber",
    topic: "ASSESSMENT_UPDATE",
    account_id: ACCOUNT_IDS.mo_kc,
    assessment_id: "assessment-123",
    occurred_at: "2026-08-05T16:30:00Z",
    market_key: "mo_kc",
    market_name: "Kansas City",
    auth_account_key: "kc",
    received_at: "2026-08-05T16:30:01Z",
    ...overrides,
  };
}

function resolvedSignal(message) {
  return {
    event_name: "jobber.appointment_scheduled.v1",
    event_id: `jobber-assessment:${message.account_id}:${message.assessment_id}`,
    event_occurred_at: message.occurred_at,
    route_to_sales_pipeline: true,
    market_key: message.market_key,
    market_name: message.market_name,
    appointment_type: "assessment",
    appointment_start_at: "2026-08-08T16:00:00Z",
    appointment_end_at: "2026-08-08T17:00:00Z",
    appointment_title: "Attic assessment",
    jobber_account_id: message.account_id,
    jobber_assessment_id: message.assessment_id,
    jobber_request_id: "request-1",
    jobber_client_id: "client-1",
    jobber_property_id: "property-1",
    jobber_request_url: "https://secure.getjobber.com/requests/1",
    contact_name: "Customer Name",
    email: "customer@example.com",
    phone: "+18165550101",
  };
}

function workerEnv(database) {
  return {
    APPOINTMENT_DB: database,
    JOBBER_APPOINTMENT_RESOLVER_URL: "https://goodattic.energy/api/jobber/appointment-resolve",
    JOBBER_APPOINTMENT_BROKER_SECRET: "broker-secret",
    JOBBER_APPOINTMENT_CONSUMER_URL: "https://partners.goodattic.energy/api/jobber-appointment-scheduled",
    JOBBER_APPOINTMENT_CONSUMER_SECRET: "consumer-secret",
  };
}

test("publishes one authenticated deterministic event to the Good Attic consumer", async () => {
  const database = new AppointmentLedgerD1();
  const body = queuedAppointment();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("appointment-resolve")) {
      return Response.json({ ok: true, status: "scheduled", signal: resolvedSignal(body) });
    }
    return Response.json({ ok: true });
  };

  const first = queueMessage(body);
  await appointmentConsumer.queue({ messages: [first] }, workerEnv(database));
  assert.deepEqual(first.actions, [{ type: "ack" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://partners.goodattic.energy/api/jobber-appointment-scheduled");
  assert.equal(calls[1].options.headers.Authorization, "Bearer consumer-secret");
  assert.equal(calls[1].options.headers["Content-Type"], "application/json");
  assert.equal(calls[1].options.headers["Idempotency-Key"], resolvedSignal(body).event_id);
  assert.equal(calls[1].options.headers["X-Good-Attic-Event"], "jobber.appointment_scheduled.v1");
  assert.deepEqual(JSON.parse(calls[1].options.body), resolvedSignal(body));
  assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "delivered");

  const duplicate = queueMessage(body);
  await appointmentConsumer.queue({ messages: [duplicate] }, workerEnv(database));
  assert.deepEqual(duplicate.actions, [{ type: "ack" }]);
  assert.equal(calls.length, 2);
});

test("treats a duplicate-safe 200 consumer response as delivered", async () => {
  const database = new AppointmentLedgerD1();
  const body = queuedAppointment();
  let consumerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("appointment-resolve")) {
      return Response.json({ ok: true, status: "scheduled", signal: resolvedSignal(body) });
    }
    consumerCalls += 1;
    return Response.json({ ok: true, alreadyApplied: true });
  };

  const message = queueMessage(body);
  await appointmentConsumer.queue({ messages: [message] }, workerEnv(database));

  assert.deepEqual(message.actions, [{ type: "ack" }]);
  assert.equal(consumerCalls, 1);
  assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "delivered");
});

test("an unscheduled Assessment remains eligible for its later scheduled update", async () => {
  const database = new AppointmentLedgerD1();
  const body = queuedAppointment();
  let resolverCalls = 0;
  let consumerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("appointment-resolve")) {
      resolverCalls += 1;
      if (resolverCalls === 1) return Response.json({ ok: true, status: "not_scheduled" });
      return Response.json({ ok: true, status: "scheduled", signal: resolvedSignal(body) });
    }
    consumerCalls += 1;
    return Response.json({ ok: true });
  };

  const createdUnscheduled = queueMessage({ ...body, topic: "ASSESSMENT_CREATE" });
  await appointmentConsumer.queue({ messages: [createdUnscheduled] }, workerEnv(database));
  assert.deepEqual(createdUnscheduled.actions, [{ type: "ack" }]);
  assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "not_scheduled");

  const scheduledUpdate = queueMessage(body);
  await appointmentConsumer.queue({ messages: [scheduledUpdate] }, workerEnv(database));
  assert.deepEqual(scheduledUpdate.actions, [{ type: "ack" }]);
  assert.equal(consumerCalls, 1);
  assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "delivered");
});

test("retries a transport failure with the same event id in the header and payload", async () => {
  const database = new AppointmentLedgerD1();
  const body = queuedAppointment();
  let consumerCalls = 0;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("appointment-resolve")) {
      return Response.json({ ok: true, status: "scheduled", signal: resolvedSignal(body) });
    }
    consumerCalls += 1;
    seen.push({
      header: options.headers["Idempotency-Key"],
      payload: JSON.parse(options.body).event_id,
    });
    if (consumerCalls === 1) throw new Error("response lost");
    return Response.json({ ok: true });
  };

  const first = queueMessage(body);
  await appointmentConsumer.queue({ messages: [first] }, workerEnv(database));
  assert.deepEqual(first.actions, [{ type: "retry", options: { delaySeconds: 60 } }]);
  assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "failed_retryable");

  const retry = queueMessage(body);
  await appointmentConsumer.queue({ messages: [retry] }, workerEnv(database));
  assert.deepEqual(retry.actions, [{ type: "ack" }]);
  assert.deepEqual(seen, [
    { header: resolvedSignal(body).event_id, payload: resolvedSignal(body).event_id },
    { header: resolvedSignal(body).event_id, payload: resolvedSignal(body).event_id },
  ]);
});

for (const status of [400, 401, 409]) {
  test(`consumer HTTP ${status} is checkpointed for manual review without retry`, async () => {
    const database = new AppointmentLedgerD1();
    const body = queuedAppointment();
    let consumerCalls = 0;
    const originalConsoleError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args);
    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes("appointment-resolve")) {
          return Response.json({ ok: true, status: "scheduled", signal: resolvedSignal(body) });
        }
        consumerCalls += 1;
        return Response.json({ ok: false, error: "manual_review_required" }, { status });
      };

      const first = queueMessage(body);
      await appointmentConsumer.queue({ messages: [first] }, workerEnv(database));
      assert.deepEqual(first.actions, [{ type: "ack" }]);
      assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "manual_review");
      assert.equal(
        database.rows.get(resolvedSignal(body).event_id)?.last_error_code,
        `consumer_http_${status}`,
      );
      assert.equal(logs.length, 1);

      const duplicate = queueMessage(body);
      await appointmentConsumer.queue({ messages: [duplicate] }, workerEnv(database));
      assert.deepEqual(duplicate.actions, [{ type: "ack" }]);
      assert.equal(consumerCalls, 1);
    } finally {
      console.error = originalConsoleError;
    }
  });
}

for (const status of [502, 503]) {
  test(`consumer HTTP ${status} retries with backoff and a stable event id`, async () => {
    const database = new AppointmentLedgerD1();
    const body = queuedAppointment();
    let consumerCalls = 0;
    const seen = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("appointment-resolve")) {
        return Response.json({ ok: true, status: "scheduled", signal: resolvedSignal(body) });
      }
      consumerCalls += 1;
      seen.push({
        header: options.headers["Idempotency-Key"],
        payload: JSON.parse(options.body).event_id,
      });
      if (consumerCalls === 1) {
        return Response.json({ ok: false, error: "upstream_failure" }, { status });
      }
      return Response.json({ ok: true });
    };

    const first = queueMessage(body);
    await appointmentConsumer.queue({ messages: [first] }, workerEnv(database));
    assert.deepEqual(first.actions, [{ type: "retry", options: { delaySeconds: 60 } }]);
    assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "failed_retryable");
    assert.equal(
      database.rows.get(resolvedSignal(body).event_id)?.last_error_code,
      `consumer_http_${status}`,
    );

    const retry = queueMessage(body);
    await appointmentConsumer.queue({ messages: [retry] }, workerEnv(database));
    assert.deepEqual(retry.actions, [{ type: "ack" }]);
    assert.deepEqual(seen, [
      { header: resolvedSignal(body).event_id, payload: resolvedSignal(body).event_id },
      { header: resolvedSignal(body).event_id, payload: resolvedSignal(body).event_id },
    ]);
    assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "delivered");
  });
}

test("does not publish without the dedicated consumer secret", async () => {
  const database = new AppointmentLedgerD1();
  const body = queuedAppointment();
  let consumerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("appointment-resolve")) {
      return Response.json({ ok: true, status: "scheduled", signal: resolvedSignal(body) });
    }
    consumerCalls += 1;
    return Response.json({ ok: true });
  };
  const env = workerEnv(database);
  delete env.JOBBER_APPOINTMENT_CONSUMER_SECRET;

  const message = queueMessage(body);
  await appointmentConsumer.queue({ messages: [message] }, env);

  assert.deepEqual(message.actions, [{ type: "retry", options: { delaySeconds: 60 } }]);
  assert.equal(consumerCalls, 0);
  assert.equal(database.rows.get(resolvedSignal(body).event_id)?.status, "failed_retryable");
  assert.equal(
    database.rows.get(resolvedSignal(body).event_id)?.last_error_code,
    "consumer_secret_not_configured",
  );
});

test("queue retries back off but remain within the one-hour cap", () => {
  assert.equal(consumerPrivate.retryDelaySeconds({ attempts: 1 }), 60);
  assert.equal(consumerPrivate.retryDelaySeconds({ attempts: 4 }), 480);
  assert.equal(consumerPrivate.retryDelaySeconds({ attempts: 7 }), 3600);
  assert.equal(consumerPrivate.retryDelaySeconds({ attempts: 50 }), 3600);
});

test("consumer code and configuration have no Jobber token authority, direct GHL destination, or Fieldflow access", async () => {
  const [source, config] = await Promise.all([
    readFile(new URL("../workers/jobber-appointment-consumer.js", import.meta.url), "utf8"),
    readFile(new URL("../workers/jobber-appointment-consumer.wrangler.toml", import.meta.url), "utf8"),
  ]);
  const combined = `${source}\n${config}`;
  assert.equal(combined.includes("JOBBER_CLIENT_SECRET"), false);
  assert.equal(combined.includes("JOBBER_REFRESH_TOKEN"), false);
  assert.equal(combined.includes("JOBBER_TOKEN_STORE"), false);
  assert.equal(combined.includes("ANGI_ROUTER_DB"), false);
  assert.equal(combined.includes("GHL_JOBBER_APPOINTMENT_WEBHOOK_URL"), false);
  assert.equal(combined.includes("services.leadconnectorhq.com"), false);
  assert.equal(combined.includes("deliverToGhl"), false);
  assert.equal(combined.toLowerCase().includes("fieldflow"), false);
});
