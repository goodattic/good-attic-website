import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { reserveFormTransaction, completeFormTransaction, markFormDeliveryUncertain } from "../server/website-form-transactions.js";
import { onRequestPost } from "../functions/api/leads.js";
import { onRequestPost as signal } from "../functions/api/leads/conversion-signal.js";

const ID = "0f40f4de-ef72-4b76-a45e-2028dd594081";
const REQUEST = "Z2lkOi8vSm9iYmVyL1JlcXVlc3QvOTk=";

function database({ authRow = null } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(fs.readFileSync(new URL("../migrations/0017_website_form_transaction_ids.sql", import.meta.url), "utf8"));
  return {
    raw,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const result = raw.prepare(sql).run(...args);
              return { meta: { changes: Number(result.changes) } };
            },
            async first() {
              if (sql.includes("jobber_token_authority:select_auth")) return authRow;
              return raw.prepare(sql).get(...args) || null;
            },
          };
        },
      };
    },
  };
}

test("one submission reserves one transaction across market and national forms; duplicate delivery never claims another", async () => {
  for (const market of ["ut", "mo_stl", "mo_kc", "general"]) {
    const db = database();
    const first = await reserveFormTransaction(db, ID, market);
    const again = await reserveFormTransaction(db, ID, market);
    assert.equal(first.claimed, true);
    assert.equal(again.claimed, false);
    assert.equal(first.transaction_id, ID);
    const complete = await completeFormTransaction(db, ID, {
      request_id: REQUEST,
      client_id: "client-1",
      account_id: "account-1",
    });
    assert.equal(complete.state, "completed");
    assert.equal((await reserveFormTransaction(db, ID, market)).jobber_request_id, REQUEST);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM website_form_conversions").get().n, 1);
    await assert.rejects(reserveFormTransaction(db, ID, market === "ut" ? "mo_stl" : "ut"));
  }
});

test("Jobber Request IDs remain separate across market accounts", async () => {
  const db = database();
  const otherSubmission = "9eacefda-b3aa-498b-893a-a9f032460567";
  await reserveFormTransaction(db, ID, "ut");
  await completeFormTransaction(db, ID, { request_id: REQUEST, client_id: "ut-client", account_id: "ut-account" });
  await reserveFormTransaction(db, otherSubmission, "mo_stl");
  await completeFormTransaction(db, otherSubmission, { request_id: REQUEST, client_id: "stl-client", account_id: "stl-account" });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM website_form_conversions").get().n, 2);
});

function leadRequest(submissionId = ID) {
  return new Request("https://goodattic.energy/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submission_id: submissionId, first_name: "First", last_name: "Last", phone: "8015550101",
      email: "fixture@example.test", street_address: "123 Example St", city: "Salt Lake City",
      state: "UT", zip: "84101", project_type: "Attic insulation",
    }),
  });
}

test("an invalid tracking ID is replaced without rejecting a valid lead", async () => {
  const db = database({ authRow: readyAuth() });
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = successfulJobberFetch(calls);
  try {
    const response = await onRequestPost({
      env: { ANGI_ROUTER_DB: db, EXTERNAL_API_WRITES_ENABLED: "false" },
      request: leadRequest("not-a-uuid"),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.match(result.transaction_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.deepEqual(calls, ["clientCreate", "requestCreate"]);
  } finally { globalThis.fetch = previousFetch; }
});

const readyAuth = () => ({
  refresh_status: "ready", access_token: "fixture-access", access_expires_at: Date.now() + 3_600_000,
});

function successfulJobberFetch(calls) {
  return async (url, init) => {
    assert.equal(url, "https://api.getjobber.com/api/graphql");
    const { query } = JSON.parse(init.body);
    if (query.includes("GoodAtticClientCreate")) {
      calls.push("clientCreate");
      return Response.json({ data: { clientCreate: {
        client: { id: "client-new", clientProperties: { nodes: [] } }, userErrors: [],
      } } });
    }
    if (query.includes("GoodAtticRequestCreate")) {
      calls.push("requestCreate");
      return Response.json({ data: { requestCreate: {
        request: { id: "request-new", property: null }, userErrors: [],
      } } });
    }
    throw new Error("Unexpected Jobber query");
  };
}

function delayFormReservation(db) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes("INSERT OR IGNORE INTO website_form_conversions")) return statement;
    return {
      bind(...args) {
        const bound = statement.bind(...args);
        return { run: async () => { await gate; return bound.run(); } };
      },
    };
  };
  return release;
}

test("transaction D1 failure or timeout never blocks an otherwise successful Jobber lead", async () => {
  for (const failure of ["throw", "timeout"]) {
    const db = database({ authRow: readyAuth() });
    const prepare = db.prepare.bind(db);
    db.prepare = sql => {
      if (sql.includes("INSERT OR IGNORE INTO website_form_conversions")) {
        if (failure === "throw") throw new Error("D1 transaction table unavailable");
        return { bind: () => ({ run: () => new Promise(() => {}) }) };
      }
      return prepare(sql);
    };
    const calls = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = successfulJobberFetch(calls);
    try {
      const response = await onRequestPost({
        env: { ANGI_ROUTER_DB: db, FORM_TRANSACTION_TIMEOUT_MS: 5, EXTERNAL_API_WRITES_ENABLED: "false" },
        request: leadRequest(),
      });
      assert.equal(response.status, 200, failure);
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.equal(result.transaction_id, ID);
      assert.equal(result.jobber.request_id, "request-new");
      assert.deepEqual(calls, ["clientCreate", "requestCreate"]);
    } finally { globalThis.fetch = previousFetch; }
  }
});

test("a reservation that commits after the fail-open deadline links the accepted Jobber Request", async () => {
  const db = database({ authRow: readyAuth() });
  const releaseReservation = delayFormReservation(db);
  const background = [];
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = successfulJobberFetch(calls);
  try {
    const response = await onRequestPost({
      env: { ANGI_ROUTER_DB: db, FORM_TRANSACTION_TIMEOUT_MS: 5, EXTERNAL_API_WRITES_ENABLED: "false" },
      request: leadRequest(),
      waitUntil(promise) { background.push(promise); },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).jobber.request_id, "request-new");
    assert.deepEqual(calls, ["clientCreate", "requestCreate"]);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM website_form_conversions").get().n, 0);
    assert.equal(background.length, 1);

    releaseReservation();
    await Promise.all(background);
    const row = db.raw.prepare(
      "SELECT state, transaction_id, jobber_request_id, reconciliation_required FROM website_form_conversions"
    ).get();
    assert.deepEqual({ ...row }, {
      state: "completed", transaction_id: ID, jobber_request_id: "request-new", reconciliation_required: 0,
    });
  } finally { globalThis.fetch = previousFetch; releaseReservation(); }
});

test("a reservation that commits after failed Jobber auth is released for a later retry", async () => {
  const db = database({ authRow: { refresh_status: "refresh_outcome_unknown" } });
  const releaseReservation = delayFormReservation(db);
  const background = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No Jobber mutation expected"); };
  try {
    const response = await onRequestPost({
      env: { ANGI_ROUTER_DB: db, FORM_TRANSACTION_TIMEOUT_MS: 5 },
      request: leadRequest(),
      waitUntil(promise) { background.push(promise); },
    });
    assert.equal(response.status, 503);
    assert.equal(background.length, 1);
    releaseReservation();
    await Promise.all(background);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM website_form_conversions").get().n, 0);
  } finally { globalThis.fetch = previousFetch; releaseReservation(); }
});

test("a late reservation after an uncertain Jobber write remains held for reconciliation", async () => {
  const db = database({ authRow: readyAuth() });
  const releaseReservation = delayFormReservation(db);
  const background = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Jobber write outcome unknown"); };
  try {
    const response = await onRequestPost({
      env: { ANGI_ROUTER_DB: db, FORM_TRANSACTION_TIMEOUT_MS: 5 },
      request: leadRequest(),
      waitUntil(promise) { background.push(promise); },
    });
    assert.equal(response.status, 500);
    assert.equal(background.length, 1);
    releaseReservation();
    await Promise.all(background);
    const row = db.raw.prepare("SELECT state, jobber_request_id FROM website_form_conversions").get();
    assert.deepEqual({ ...row }, { state: "delivery_uncertain", jobber_request_id: null });
  } finally { globalThis.fetch = previousFetch; releaseReservation(); }
});

test("a transaction completion failure after Jobber accepts still returns success", async () => {
  const db = database({ authRow: readyAuth() });
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    if (sql.includes("UPDATE website_form_conversions") && sql.includes("SET state = 'completed'")) {
      throw new Error("D1 completion unavailable");
    }
    return prepare(sql);
  };
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = successfulJobberFetch(calls);
  try {
    const response = await onRequestPost({
      env: { ANGI_ROUTER_DB: db, EXTERNAL_API_WRITES_ENABLED: "false" }, request: leadRequest(),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.transaction_id, ID);
    assert.equal(result.jobber.request_id, "request-new");
    assert.deepEqual(calls, ["clientCreate", "requestCreate"]);
    assert.equal(db.raw.prepare("SELECT state FROM website_form_conversions").get().state, "delivery_uncertain");
  } finally { globalThis.fetch = previousFetch; }
});

test("authorization failure before a Jobber write releases the reservation for the same-ID retry", async () => {
  const db = database({ authRow: { refresh_status: "refresh_outcome_unknown" } });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No Jobber mutation expected"); };
  try {
    const first = await onRequestPost({ env: { ANGI_ROUTER_DB: db }, request: leadRequest() });
    assert.equal(first.status, 503);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM website_form_conversions").get().n, 0);
    const retry = await onRequestPost({ env: { ANGI_ROUTER_DB: db }, request: leadRequest() });
    assert.equal(retry.status, 503);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM website_form_conversions").get().n, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("an uncertain Jobber mutation allows the same-ID retry and records reconciliation evidence", async () => {
  const db = database({ authRow: readyAuth() });
  const previousFetch = globalThis.fetch;
  let mutations = 0;
  globalThis.fetch = async () => { mutations += 1; throw new Error("connection lost after request"); };
  try {
    const first = await onRequestPost({ env: { ANGI_ROUTER_DB: db }, request: leadRequest() });
    assert.equal(first.status, 500);
    assert.equal(db.raw.prepare("SELECT state FROM website_form_conversions").get().state, "delivery_uncertain");
    const calls = [];
    globalThis.fetch = successfulJobberFetch(calls);
    const retry = await onRequestPost({
      env: { ANGI_ROUTER_DB: db, EXTERNAL_API_WRITES_ENABLED: "false" }, request: leadRequest(),
    });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).transaction_id, ID);
    assert.deepEqual(calls, ["clientCreate", "requestCreate"]);
    assert.equal(mutations, 1);
    const row = db.raw.prepare("SELECT state, reconciliation_required, reconciliation_retry_count FROM website_form_conversions").get();
    assert.equal(row.state, "delivery_uncertain");
    assert.equal(row.reconciliation_required, 1);
    assert.equal(row.reconciliation_retry_count, 1);
    const attempt = db.raw.prepare("SELECT jobber_request_id, reason FROM website_form_reconciliation_attempts").get();
    assert.equal(attempt.jobber_request_id, "request-new");
    assert.equal(attempt.reason, "delivery_uncertain_retry");
  } finally { globalThis.fetch = previousFetch; }
});

test("a still-processing submission retry creates a Request and flags the original row", async () => {
  const db = database({ authRow: readyAuth() });
  await reserveFormTransaction(db, ID, "ut");
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = successfulJobberFetch(calls);
  try {
    const response = await onRequestPost({
      env: { ANGI_ROUTER_DB: db, EXTERNAL_API_WRITES_ENABLED: "false" }, request: leadRequest(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["clientCreate", "requestCreate"]);
    assert.equal(db.raw.prepare("SELECT reconciliation_required FROM website_form_conversions").get().reconciliation_required, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM website_form_reconciliation_attempts").get().n, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("an uncertain Request delivery retains the known Jobber Client link", async () => {
  const db = database();
  await reserveFormTransaction(db, ID, "ut");
  assert.equal(await markFormDeliveryUncertain(db, ID, { client_id: "client-1", account_id: "account-ut" }), true);
  assert.deepEqual(
    { ...db.raw.prepare("SELECT state, jobber_client_id, jobber_account_id FROM website_form_conversions WHERE submission_id=?").get(ID) },
    { state: "delivery_uncertain", jobber_client_id: "client-1", jobber_account_id: "account-ut" },
  );
  assert.equal((await reserveFormTransaction(db, ID, "ut")).claimed, false);
});

test("an early browser signal is retained through Jobber completion but cannot prove a Request", async () => {
  const db = database();
  await reserveFormTransaction(db, ID, "mo_kc");
  const call = (submissionId, transactionId) => signal({
    env: { ANGI_ROUTER_DB: db },
    request: new Request("https://goodattic.energy/api/leads/conversion-signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: submissionId, transaction_id: transactionId }),
    }),
  });
  assert.equal((await call(ID, ID)).status, 204);
  assert.deepEqual({ ...db.raw.prepare(
    "SELECT state, jobber_request_id, conversion_state FROM website_form_conversions"
  ).get() }, { state: "processing", jobber_request_id: null, conversion_state: "client_signaled" });
  await completeFormTransaction(db, ID, { request_id: REQUEST, client_id: "client-1" });
  assert.equal((await call(ID, "9eacefda-b3aa-498b-893a-a9f032460567")).status, 404);
  assert.equal(db.raw.prepare("SELECT conversion_state FROM website_form_conversions").get().conversion_state, "client_signaled");
});

test("completed duplicate POST returns the original transaction and Request without another Jobber call", async () => {
  const db = database();
  await reserveFormTransaction(db, ID, "ut");
  await completeFormTransaction(db, ID, { request_id: REQUEST, client_id: "client-1", account_id: "account-ut" });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No downstream calls permitted"); };
  try {
    const response = await onRequestPost({
      env: { ANGI_ROUTER_DB: db },
      request: new Request("https://goodattic.energy/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: ID, first_name: "First", last_name: "Last", phone: "8015550101",
          email: "fixture@example.test", street_address: "123 Example St", city: "Salt Lake City",
          state: "UT", zip: "84101", project_type: "Attic insulation",
        }),
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.duplicate, true);
    assert.equal(result.transaction_id, ID);
    assert.equal(result.jobber.request_id, REQUEST);
  } finally { globalThis.fetch = previousFetch; }
});
