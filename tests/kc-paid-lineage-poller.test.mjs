import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { collectKcPaidLineage, pollKcPaidLineage,
  _private as poller } from "../server/kc-paid-lineage-poller.js";
import { onRequestPost } from "../functions/api/jobber/kc-paid-lineage-poll.js";
import quoteWorker, { _private as worker } from "../workers/jobber-quote-consumer.js";

const ACCOUNT = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==";
const AT = "2026-10-19T17:00:00.000Z";
const context = (id = "r1", client = "c1") => ({ id, client: { id: client } });
const page = (nodes, next = false, cursor = null, totalCount = nodes.length) => ({
  nodes, totalCount, pageInfo: { hasNextPage: next, endCursor: cursor },
});

function lead() {
  return {
    lead_id: "jobber-request:r1", submission_id: "submission-1",
    market_key: "mo_kc", jobber_account_id: ACCOUNT,
    jobber_request_id: "r1", jobber_client_id: "c1",
    original_source: "Google Ads", source_detail: "google_ads",
    campaign: "KC paid", gclid: "abc123456", gbraid: null, wbraid: null,
    inquiry_at: AT, proof_account_id: ACCOUNT, proof_request_id: "r1",
    proof_client_id: "c1", source_lead_id: "website:submission-1",
    source_created_at: AT, source_reason: "gclid",
    proof_state: "completed", proof_source_key: "google",
    proof_source_detail: "google_ads", form_state: "completed",
    form_transaction_id: "submission-1", form_reconciliation_required: 0,
    receipt_source_kind: "website",
    evidence_json: JSON.stringify({
      schema_version: 1, source_key: "google", source_detail: "google_ads",
      source_reason: "gclid", verified_signals: { gclid: "abc123456" },
      attribution: { attribution_captured_at: AT, utm_campaign: "KC paid" },
    }),
  };
}

function graph({ mixedInvoice = false, brokenPagination = false,
  quoteMissingInverse = false, invoiceDisappears = false } = {}) {
  const calls = [];
  const q1 = { ...context(), id: "q1", createdAt: AT, quoteStatus: "APPROVED", request: context() };
  const q2 = { ...context(), id: "q2", createdAt: AT, quoteStatus: "DRAFT", request: context() };
  const j1 = { ...context(), id: "j1", createdAt: AT, jobStatus: "ACTIVE",
    request: context(), quote: { id: "q1", request: context() } };
  const j2 = { ...context(), id: "j2", createdAt: AT, jobStatus: "ACTIVE",
    request: context(), quote: { id: "q2", request: context() } };
  const invoice = { id: "i1", createdAt: AT, invoiceStatus: "SENT", client: { id: "c1" } };
  const query = async (document, variables) => {
    assert.doesNotMatch(document, /mutation/i);
    const name = document.match(/query\s+(KcPaidLineage\w+)/)?.[1];
    calls.push({ name, ...variables });
    let record;
    if (name === "KcPaidLineageRequest") {
      record = { request: { ...context(), assessment: {
        id: "a1", startAt: AT, completedAt: AT, request: { id: "r1" }, client: { id: "c1" },
      } } };
    } else if (name === "KcPaidLineageRequestQuotes") {
      record = { request: { ...context(), quotes: variables.after
        ? page([q2], false, null, 2)
        : page([q1], true, brokenPagination ? null : "q-cursor", 2) } };
    } else if (name === "KcPaidLineageRequestJobs") {
      record = { request: { ...context(), jobs: variables.after
        ? page([j2], false, null, 2) : page([j1], true, "j-cursor", 2) } };
    } else if (name === "KcPaidLineageQuoteJobs") {
      record = { quote: { ...context(variables.id), request: context(),
        jobs: page(quoteMissingInverse && variables.id === "q1" ? []
          : [{ id: variables.id === "q1" ? "j1" : "j2" }]) } };
    } else if (name === "KcPaidLineageJobInvoices") {
      const job = variables.id === "j1" ? j1 : j2;
      record = { job: { ...job, invoices: page(job.id === "j1" && !invoiceDisappears
        ? [invoice] : []) } };
    } else if (name === "KcPaidLineageInvoiceJobs") {
      record = { invoice: { id: "i1", client: { id: "c1" }, jobs: page([
        mixedInvoice ? { ...j1, request: context("other-request", "c1") } : j1,
      ]) } };
    } else if (name === "KcPaidLineageInvoiceArchivedJobs") {
      record = { invoice: { id: "i1", client: { id: "c1" }, archivedJobs: page([]) } };
    } else throw new Error(`unexpected ${name}`);
    return { data: { account: { id: ACCOUNT }, ...record } };
  };
  return { query, calls };
}

test("collects the complete exact Request to assessment, Quotes, Jobs and Invoice chain", async () => {
  const { query, calls } = graph();
  const objects = await collectKcPaidLineage(lead(), query);
  assert.deepEqual(objects.map((item) => `${item.object_type}:${item.object_id}`),
    ["assessment:a1", "quote:q1", "quote:q2", "job:j1", "job:j2", "invoice:i1"]);
  assert.equal(objects.at(-1).parent_job_ids_json, '["j1"]');
  assert.equal(calls.filter((item) => item.name === "KcPaidLineageRequestQuotes").length, 2);
  assert.equal(calls.filter((item) => item.name === "KcPaidLineageRequestJobs").length, 2);
});

test("holds a mixed-Request Invoice and an incomplete cursor without writing a lineage", async () => {
  await assert.rejects(collectKcPaidLineage(lead(), graph({ mixedInvoice: true }).query),
    { code: "invoice_mixed_request_or_client", retryable: false });
  await assert.rejects(collectKcPaidLineage(lead(), graph({ brokenPagination: true }).query),
    { code: "jobber_pagination_invalid", retryable: true });
  await assert.rejects(poller.collectStableKcPaidLineage(lead(), graph({ quoteMissingInverse: true }).query),
    { code: "quote_job_inverse_mismatch", retryable: true });
});

test("retries a Quote-to-Job race, but holds a stable mixed Invoice", async () => {
  const cleanGraph = graph();
  let round = 0;
  const changingQuery = async (document, variables) => {
    if (document.includes("query KcPaidLineageRequest(")) round += 1;
    if (round === 1 && document.includes("query KcPaidLineageRequestQuotes(")) {
      return { data: { account: { id: ACCOUNT }, request: {
        ...context(), quotes: page([{
          ...context(), id: "q1", createdAt: AT, quoteStatus: "APPROVED", request: context(),
        }]),
      } } };
    }
    return cleanGraph.query(document, variables);
  };
  const recovered = await poller.collectStableKcPaidLineage(lead(), changingQuery);
  assert.equal(round, 2);
  assert.equal(recovered.length, 6);

  const mixed = graph({ mixedInvoice: true });
  await assert.rejects(poller.collectStableKcPaidLineage(lead(), mixed.query),
    { code: "invoice_mixed_request_or_client", retryable: false });
  assert.equal(mixed.calls.filter((item) => item.name === "KcPaidLineageRequest").length, 2);
});

function databaseAdapter(sqlite) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => sqlite.prepare(sql).get(...params) || null,
            all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
            run: async () => ({ meta: sqlite.prepare(sql).run(...params) }),
            sql, params,
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => sqlite.prepare(item.sql).run(...item.params));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("same-lead parent changes refresh, and a collision atomically holds both full chains", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of [
      "0005_closed_loop_tracking.sql", "0006_closed_loop_quote_attribution.sql",
      "0007_atomic_quote_attribution_claims.sql", "0026_quote_google_call_replay.sql",
      "0030_kc_proven_website_closed_loop.sql", "0031_kc_paid_website_lineage.sql",
    ]) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    const database = databaseAdapter(sqlite);
    const leads = [
      { lead_id: "jobber-request:r1", jobber_account_id: ACCOUNT,
        jobber_request_id: "r1", jobber_client_id: "c1" },
      { lead_id: "jobber-request:r2", jobber_account_id: ACCOUNT,
        jobber_request_id: "r2", jobber_client_id: "c2" },
    ];
    for (const [index, item] of leads.entries()) {
      sqlite.prepare(`INSERT INTO closed_loop_leads (
        lead_id, submission_id, market_key, jobber_account_id, jobber_request_id,
        jobber_client_id, original_source, inquiry_at, created_at, updated_at
      ) VALUES (?, ?, 'mo_kc', ?, ?, ?, 'Google Ads', ?, ?, ?)`).run(
        item.lead_id, `submission-${index}`, ACCOUNT, item.jobber_request_id,
        item.jobber_client_id, AT, AT, AT,
      );
    }
    const entry = (type, id, item, parentQuote = null, jobIds = null) => ({
      object_type: type, object_id: id, request_id: item.jobber_request_id,
      client_id: item.jobber_client_id, source_created_at: AT,
      jobber_status: "ACTIVE", parent_quote_id: parentQuote,
      parent_job_ids_json: jobIds,
    });
    const first = leads[0];
    const initial = [entry("assessment", "a1", first), entry("quote", "q1", first),
      entry("job", "shared-job", first, "q1"),
      entry("invoice", "i1", first, null, '["shared-job"]')];
    assert.equal(await poller.persistPoll(database, first, initial, "linked", null, AT), "linked");
    const rescheduledAt = new Date(Date.parse(AT) + 60 * 60_000).toISOString();
    const updated = [{ ...entry("assessment", "a1", first), source_created_at: rescheduledAt },
      entry("quote", "q1", first), entry("job", "shared-job", first, "q2"),
      entry("invoice", "i1", first, null, '["shared-job","another-job"]')];
    assert.equal(await poller.persistPoll(database, first, updated, "linked", null, AT), "linked");
    assert.equal(sqlite.prepare("SELECT source_created_at FROM kc_paid_lineage_objects WHERE object_id='a1'").get().source_created_at,
      rescheduledAt, "rescheduling refreshes the verified assessment time");
    assert.equal(sqlite.prepare("SELECT parent_quote_id FROM kc_paid_lineage_objects WHERE object_id='shared-job'").get().parent_quote_id,
      "q2");
    assert.equal(sqlite.prepare("SELECT parent_job_ids_json FROM kc_paid_lineage_objects WHERE object_id='i1'").get().parent_job_ids_json,
      '["shared-job","another-job"]');

    const second = leads[1];
    const conflicting = [entry("quote", "q-other", second),
      entry("job", "shared-job", second, "q-other"), entry("invoice", "i-other", second)];
    assert.equal(await poller.persistPoll(database, second, conflicting, "linked", null, AT), "held");
    assert.deepEqual(sqlite.prepare(`SELECT DISTINCT status FROM kc_paid_lineage_objects
      WHERE lead_id = ?`).all(first.lead_id).map((row) => row.status), ["held"]);
    assert.deepEqual(sqlite.prepare(`SELECT DISTINCT status FROM kc_paid_lineage_objects
      WHERE lead_id = ?`).all(second.lead_id).map((row) => row.status), ["held"]);
    assert.deepEqual(sqlite.prepare(`SELECT status FROM kc_paid_lineage_polls ORDER BY lead_id`).all()
      .map((row) => row.status), ["held", "held"]);
    assert.equal(sqlite.prepare("SELECT parent_quote_id FROM kc_paid_lineage_objects WHERE object_id='shared-job'").get().parent_quote_id,
      "q2", "the foreign lead cannot overwrite verified parent metadata");

    const third = { lead_id: "jobber-request:r3", jobber_account_id: ACCOUNT,
      jobber_request_id: "r3", jobber_client_id: "c3" };
    sqlite.prepare(`INSERT INTO closed_loop_leads (
      lead_id, submission_id, market_key, jobber_account_id, jobber_request_id,
      jobber_client_id, original_source, inquiry_at, created_at, updated_at
    ) VALUES (?, 'submission-3', 'mo_kc', ?, 'r3', 'c3', 'Google Ads', ?, ?, ?)`).run(
      third.lead_id, ACCOUNT, AT, AT, AT,
    );
    const atMinute1 = new Date(Date.parse(AT) + 60_000).toISOString();
    const atMinute30 = new Date(Date.parse(AT) + 30 * 60_000).toISOString();
    assert.equal(await poller.persistPoll(database, third, [], "retryable", "job_quote_identity_conflict", AT), "retryable");
    assert.equal(await poller.persistPoll(database, third, [], "retryable", "job_quote_identity_conflict", atMinute1), "retryable");
    assert.equal(await poller.persistPoll(database, third, [], "retryable", "job_quote_identity_conflict", atMinute30), "held");

    const firstLease = await poller.claimPoll(database);
    assert.ok(firstLease);
    assert.equal(await poller.claimPoll(database), null);
    await poller.releasePoll(database, firstLease);
    assert.ok(await poller.claimPoll(database));
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});

test("migration and poll persist only proof-backed linked objects, idempotently", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of [
      "0005_closed_loop_tracking.sql", "0006_closed_loop_quote_attribution.sql",
      "0007_atomic_quote_attribution_claims.sql", "0026_quote_google_call_replay.sql",
      "0017_website_form_transaction_ids.sql", "0005_acknowledgement_sources.sql",
      "0029_kc_google_website_source_proofs.sql", "0030_kc_proven_website_closed_loop.sql",
      "0031_kc_paid_website_lineage.sql",
    ]) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    sqlite.prepare(`INSERT INTO closed_loop_leads (
      lead_id, submission_id, market_key, jobber_account_id, jobber_request_id,
      jobber_client_id, original_source, source_detail, campaign, gclid,
      inquiry_at, created_at, updated_at
    ) VALUES (?, ?, 'mo_kc', ?, 'r1', 'c1', 'Google Ads', 'google_ads', 'KC paid',
      'abc123456', ?, ?, ?)`).run("jobber-request:r1", "submission-1", ACCOUNT, AT, AT, AT);
    sqlite.prepare(`INSERT INTO website_google_source_proofs (
      submission_id, source_lead_id, market_key, account_id, source_key,
      source_detail, source_reason, evidence_json, state, jobber_source_app,
      jobber_request_id, jobber_client_id, created_at, updated_at
    ) VALUES ('submission-1', 'website:submission-1', 'mo_kc', ?, 'google',
      'google_ads', 'gclid', ?, 'completed', 'website', 'r1', 'c1', ?, ?)`)
      .run(ACCOUNT, lead().evidence_json, AT, AT);
    sqlite.prepare(`INSERT INTO website_form_conversions (
      submission_id, transaction_id, market_key, jobber_account_id,
      jobber_request_id, jobber_client_id, state, created_at, updated_at
    ) VALUES ('submission-1', 'submission-1', 'mo_kc', ?, 'r1', 'c1',
      'completed', ?, ?)`).run(ACCOUNT, AT, AT);
    sqlite.prepare(`INSERT INTO acknowledgement_sources (
      account_id, request_id, market_key, client_id, source_kind,
      source_lead_id, source_created_at, recorded_at
    ) VALUES (?, 'r1', 'mo_kc', 'c1', 'website', 'website:submission-1', ?, ?)`)
      .run(ACCOUNT, AT, AT);
    const env = { ANGI_ROUTER_DB: databaseAdapter(sqlite) };
    const first = await pollKcPaidLineage(env, { limit: 1, query: graph().query, now: () => AT });
    assert.deepEqual(first, { ok: true, examined: 1, linked: 1, held: 0, retryable: 0,
      reconciliation: { ok: true, examined: 0, recovered: 0, held: 0, retryable: 0 } });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects WHERE status='linked'").get().count, 6);
    const second = await pollKcPaidLineage(env, { limit: 1, query: graph().query, now: () => AT });
    assert.equal(second.linked, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects").get().count, 6);
    assert.equal(sqlite.prepare("SELECT attempt_count FROM kc_paid_lineage_polls WHERE lead_id='jobber-request:r1'").get().attempt_count, 2);
    const disappearing = await pollKcPaidLineage(env, {
      limit: 1, query: graph({ invoiceDisappears: true }).query, now: () => AT,
    });
    assert.equal(disappearing.retryable, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects").get().count, 6);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects WHERE status='unverified'").get().count, 6);
    const reappeared = await pollKcPaidLineage(env, { limit: 1, query: graph().query, now: () => AT });
    assert.equal(reappeared.linked, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects WHERE status='linked'").get().count, 6);
    const interrupted = await pollKcPaidLineage(env, {
      limit: 1, query: graph({ brokenPagination: true }).query, now: () => AT,
    });
    assert.equal(interrupted.retryable, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects WHERE status='unverified'").get().count, 6);
    const recovered = await pollKcPaidLineage(env, { limit: 1, query: graph().query, now: () => AT });
    assert.equal(recovered.linked, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects WHERE status='linked'").get().count, 6);
    sqlite.exec("UPDATE website_google_source_proofs SET state='prepared' WHERE submission_id='submission-1'");
    const revoked = await pollKcPaidLineage(env, { limit: 1, query: graph().query, now: () => AT });
    assert.equal(revoked.held, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM kc_paid_lineage_objects WHERE status='held'").get().count, 6);
    assert.equal(sqlite.prepare("SELECT hold_code FROM kc_paid_lineage_polls WHERE lead_id='jobber-request:r1'").get().hold_code,
      "paid_source_proof_invalid");
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});

test("the scheduled worker calls the protected KC poll endpoint when enabled", async () => {
  const original = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async (url, options) => {
      urls.push(url);
      if (url.endsWith("kc-paid-lineage-poll")) {
        assert.equal(options.headers.Authorization, "Bearer broker-secret");
        return Response.json({ ok: true, examined: 0, linked: 0, held: 0, retryable: 0 });
      }
      return Response.json({ ok: true, results: [] });
    };
    await quoteWorker.scheduled({}, {
      JOBBER_AUTH_HEALTH_SECRET: "health-secret", JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
      KC_PAID_LINEAGE_POLL_ENABLED: "true",
    });
    assert.deepEqual(urls, ["https://goodattic.energy/api/jobber/oauth/health-check",
      worker.DEFAULT_KC_LINEAGE_POLL_URL]);
  } finally { globalThis.fetch = original; }
});

test("the Pages poll endpoint requires the existing broker secret", async () => {
  const request = new Request("https://goodattic.energy/api/jobber/kc-paid-lineage-poll", { method: "POST" });
  assert.equal((await onRequestPost({ request, env: { JOBBER_QUOTE_BROKER_SECRET: "secret" } })).status, 401);
  const authorized = new Request(request.url, { method: "POST", headers: { Authorization: "Bearer secret" } });
  assert.equal((await onRequestPost({ request: authorized,
    env: { JOBBER_QUOTE_BROKER_SECRET: "secret" } })).status, 503);
});
