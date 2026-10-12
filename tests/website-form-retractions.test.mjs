import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  FORM_CONVERSION_ACTION,
  previewWebsiteFormRetractions,
  requestDispositionFromTags,
  retractionPayload,
} from "../server/website-form-retractions.js";

const gid = (type, id) => btoa(`gid://Jobber/${type}/${id}`);
const requestId = gid("Request", "90000001");
const clientId = gid("Client", "152947247");
const accountId = gid("Account", "2498432");

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0017_website_form_transaction_ids.sql", import.meta.url), "utf8"));
  const adapter = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { throw new Error("shadow_preview_must_not_write"); },
      };
    },
  };
  return { sqlite, adapter };
}

function insert(sqlite, fields = {}) {
  const row = {
    submission_id: crypto.randomUUID(), market_key: "ut", jobber_account_id: accountId,
    jobber_request_id: requestId, jobber_client_id: clientId,
    conversion_at: "2026-09-30T12:00:00Z", state: "completed",
    conversion_state: "client_signaled", ...fields,
  };
  row.transaction_id ??= row.submission_id;
  sqlite.prepare(`INSERT INTO website_form_conversions
    (submission_id,transaction_id,market_key,jobber_account_id,jobber_request_id,jobber_client_id,
      conversion_at,state,conversion_state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.submission_id, row.transaction_id, row.market_key, row.jobber_account_id,
    row.jobber_request_id, row.jobber_client_id, row.conversion_at,
    row.state, row.conversion_state, "2026-09-30T12:00:00Z", "2026-09-30T12:00:00Z",
  );
  return row;
}

const requests = (...nodes) => ({ nodes, pageInfo: { hasNextPage: false } });
const website = id => ({ id, source: "website_form", source_verified: true });
const other = id => ({ id, source: "non_website", source_verified: true });

const proof = (tags, clientRequests = null) => ({
  account_id: accountId,
  request: { id: requestId, client: { id: clientId, tags: { nodes: tags.map(name => ({ name })), pageInfo: { hasNextPage: false } }, requests: clientRequests } },
});

test("the additive ledger has one transaction per submission across all three markets", () => {
  const { sqlite } = database();
  assert.doesNotThrow(() => sqlite.exec(readFileSync(new URL("../migrations/0017_website_form_transaction_ids.sql", import.meta.url), "utf8")));
  const row = insert(sqlite, { market_key: "mo_kc" });
  assert.equal(sqlite.prepare("SELECT transaction_id FROM website_form_conversions WHERE market_key='mo_kc'").get().transaction_id, row.submission_id);
  assert.throws(() => insert(sqlite, { submission_id: row.submission_id, jobber_request_id: gid("Request", "90000002") }), /UNIQUE/);
  assert.throws(() => insert(sqlite, { jobber_request_id: gid("Request", "90000002"), transaction_id: "different" }), /CHECK/);
});

test("shadow preview verifies the actual Jobber account separately for each market", async () => {
  for (const [market_key, numericAccount] of [
    ["ut", "2498432"], ["mo_stl", "2498453"], ["mo_kc", "1919824"],
  ]) {
    const { sqlite, adapter } = database();
    const expectedAccount = gid("Account", numericAccount);
    insert(sqlite, { market_key, jobber_account_id: expectedAccount });
    const { candidates } = await previewWebsiteFormRetractions({ database: adapter,
      readJobberEvidence: async () => ({ ...proof(["GAE:JUNK:90000001"]), account_id: expectedAccount }),
      now: () => "2026-09-30T15:00:00Z" });
    assert.equal(candidates[0].would_retract, true, market_key);
  }
});

test("an exact request-specific client tag marks only that Request", () => {
  assert.deepEqual(requestDispositionFromTags({ nodes: [{ name: "GAE:JUNK:90000001" }] }, requestId), { marker: "junk", reason: null });
  assert.deepEqual(requestDispositionFromTags(["GAE:DUPLICATE:90000002"], requestId), { marker: null, reason: "no_explicit_disposition_tag" });
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK:90000001", "GAE:DUPLICATE:90000001"], requestId), { marker: null, reason: "conflicting_disposition_tags" });
  assert.deepEqual(requestDispositionFromTags(["Junk", "Archived"], requestId), { marker: null, reason: "no_explicit_disposition_tag" });
});

test("plain client markers require a complete read proving one website Request", () => {
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK"], requestId, requests(website(requestId))),
    { marker: "junk", reason: null });
  assert.deepEqual(requestDispositionFromTags(["GAE:DUPLICATE"], requestId,
    requests(website(requestId), other(gid("Request", "90000002")))),
    { marker: "duplicate", reason: null });
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK"], requestId,
    requests(website(requestId), website(gid("Request", "90000002")))),
    { marker: null, reason: "multiple_website_requests_require_specific_tag" });
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK"], requestId,
    requests(website(requestId), { id: gid("Request", "90000002") })),
    { marker: null, reason: "jobber_client_request_source_unverified" });
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK"], requestId,
    { nodes: [website(requestId)], pageInfo: { hasNextPage: true } }),
    { marker: null, reason: "jobber_client_requests_incomplete" });
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK"], requestId,
    requests(other(gid("Request", "90000002")))),
    { marker: null, reason: "jobber_client_request_link_mismatch" });
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK:90000001"], requestId,
    requests(website(requestId), website(gid("Request", "90000002")))),
    { marker: "junk", reason: null });
  assert.deepEqual(requestDispositionFromTags(["GAE:JUNK", "GAE:DUPLICATE:90000001"], requestId,
    requests(website(requestId))),
    { marker: null, reason: "conflicting_disposition_tags" });
});

test("shadow preview applies plain marker only to a verified sole website Request", async () => {
  for (const [clientRequests, expected] of [
    [requests(website(requestId)), { would_retract: true, reason: "browser_signaled_google_acceptance_unverified" }],
    [requests(website(requestId), other(gid("Request", "90000002"))), { would_retract: true, reason: "browser_signaled_google_acceptance_unverified" }],
    [requests(website(requestId), website(gid("Request", "90000002"))), { would_retract: false, reason: "multiple_website_requests_require_specific_tag" }],
    [null, { would_retract: false, reason: "jobber_client_requests_incomplete" }],
  ]) {
    const { sqlite, adapter } = database();
    insert(sqlite);
    const result = await previewWebsiteFormRetractions({ database: adapter,
      readJobberEvidence: async () => proof(["GAE:JUNK"], clientRequests),
      now: () => "2026-09-30T15:00:00Z" });
    assert.deepEqual({ would_retract: result.candidates[0].would_retract, reason: result.candidates[0].reason }, expected);
    assert.equal(result.google_requests, 0);
  }
});

test("a fail-open retry requiring transaction reconciliation cannot preview a retraction", async () => {
  const { sqlite, adapter } = database();
  const row = insert(sqlite);
  sqlite.prepare("UPDATE website_form_conversions SET reconciliation_required=1 WHERE submission_id=?").run(row.submission_id);
  const result = await previewWebsiteFormRetractions({ database: adapter,
    readJobberEvidence: async () => { throw new Error("must_hold_before_jobber_read"); } });
  assert.equal(result.candidates[0].would_retract, false);
  assert.equal(result.candidates[0].reason, "transaction_reconciliation_required");
  assert.equal(result.google_requests, 0);
});

test("shadow preview shows one exact RETRACTION and sends or writes nothing", async () => {
  const { sqlite, adapter } = database();
  const row = insert(sqlite);
  const result = await previewWebsiteFormRetractions({ database: adapter,
    readJobberEvidence: async () => proof(["GAE:JUNK:90000001"]),
    now: () => "2026-09-30T15:00:00Z" });
  assert.equal(result.mode, "shadow");
  assert.equal(result.google_requests, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].would_retract, true);
  assert.equal(result.candidates[0].marker, "junk");
  assert.equal(result.candidates[0].reason, "browser_signaled_google_acceptance_unverified");
  assert.deepEqual(result.candidates[0].payload, {
    partialFailure: true,
    conversionAdjustments: [{ conversionAction: FORM_CONVERSION_ACTION, adjustmentType: "RETRACTION",
      orderId: row.transaction_id, adjustmentDateTime: "2026-09-30 15:00:00+00:00" }],
  });
  assert.ok(!JSON.stringify(result).includes("gclid"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM website_form_retraction_outbox").get().count, 0);
});

test("unknown Google receipt, incomplete tags, wrong market, and prior claim all hold", async () => {
  for (const [change, evidence, expected] of [
    [{ conversion_state: "not_confirmed" }, proof(["GAE:JUNK:90000001"]), "signal_unverified"],
    [{}, { ...proof(["GAE:JUNK:90000001"]), account_id: gid("Account", "2498453") }, "jobber_market_or_link_mismatch"],
    [{}, { ...proof(["GAE:JUNK:90000001"]), request: { ...proof(["GAE:JUNK:90000001"]).request, client: { ...proof(["GAE:JUNK:90000001"]).request.client, tags: { nodes: [{ name: "GAE:JUNK:90000001" }] } } } }, "jobber_tags_incomplete"],
    [{}, { ...proof(["GAE:JUNK:90000001"]), request: { ...proof(["GAE:JUNK:90000001"]).request, client: { ...proof(["GAE:JUNK:90000001"]).request.client, tags: { nodes: [{ name: "GAE:JUNK:90000001" }], pageInfo: { hasNextPage: true } } } } }, "jobber_tags_incomplete"],
  ]) {
    const { sqlite, adapter } = database();
    insert(sqlite, change);
    const { candidates } = await previewWebsiteFormRetractions({ database: adapter,
      readJobberEvidence: async () => evidence, now: () => "2026-09-30T15:00:00Z" });
    assert.equal(candidates[0].would_retract, false);
    assert.equal(candidates[0].reason, expected);
  }
  const { sqlite, adapter } = database();
  const row = insert(sqlite);
  sqlite.prepare(`INSERT INTO website_form_retraction_outbox
    (transaction_id,market_key,jobber_request_id,marker,state,created_at,updated_at)
    VALUES (?,?,?,'junk','submitted','2026-09-30T15:00:00Z','2026-09-30T15:00:00Z')`)
    .run(row.transaction_id, "ut", requestId);
  const { candidates } = await previewWebsiteFormRetractions({ database: adapter,
    readJobberEvidence: async () => { throw new Error("should_not_read"); } });
  assert.equal(candidates[0].reason, "retraction_already_claimed");
});

test("retraction shape requires order ID and contains no restatement or click identifiers", () => {
  const payload = retractionPayload("uuid", "2026-09-30T15:00:00Z");
  assert.deepEqual(Object.keys(payload.conversionAdjustments[0]).sort(),
    ["conversionAction", "adjustmentDateTime", "adjustmentType", "orderId"].sort());
  assert.throws(() => retractionPayload("", "2026-09-30T15:00:00Z"), /invalid_retraction/);
});
