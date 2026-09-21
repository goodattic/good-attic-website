import test from "node:test";
import assert from "node:assert/strict";
import { buildOutcomeCandidate, classifyAttribution, outcomeId, persistOutcomeCandidate, qualifiedLeadEligibility } from "../server/google-ads-outcome-watcher.js";

class MemoryD1 {
  constructor() { this.calls = []; }
  prepare(sql) { return { bind: (...args) => ({ run: async () => { this.calls.push({ sql, args }); return { meta: { changes: this.calls.length === 1 ? 1 : 0 } }; } }) }; }
}

test("holds a qualified website outcome until Google attribution and consent are verified", () => {
  const result = buildOutcomeCandidate({
    event_name: "qualified_lead", market_key: "ut", milestone_at: "2026-09-21T18:00:00Z",
    homeowner: true, service_area_valid: true, installed_service: true, expected_value_usd: 2500,
    lead: { lead_id: "jobber-request:r1", submission_id: "s1", gclid: "gclid-1", service: "Attic Insulation", consent_state: "unknown", jobber_request_id: "r1" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.attribution_status, "pending");
  assert.equal(result.candidate.upload_state, "held");
  assert.equal(result.candidate.consent_status, "unknown");
});

test("keeps distinct Quo calls separate while producing deterministic IDs", () => {
  const first = outcomeId({ event_name: "appointment_set", attribution_path: "quo_call", quo_call_id: "c1", jobber_request_id: "r1", milestone_at: "2026-09-21T18:00:00Z" });
  const second = outcomeId({ event_name: "appointment_set", attribution_path: "quo_call", quo_call_id: "c2", jobber_request_id: "r1", milestone_at: "2026-09-21T18:00:00Z" });
  assert.notEqual(first, second);
  assert.equal(first, outcomeId({ event_name: "appointment_set", attribution_path: "quo_call", quo_call_id: "c1", jobber_request_id: "r1", milestone_at: "2026-09-21T18:00:00Z" }));
});

test("excludes Kansas City and does not infer Google attribution from Jobber alone", () => {
  assert.equal(buildOutcomeCandidate({ event_name: "sold_job", market_key: "mo_kc", milestone_at: "2026-09-21T18:00:00Z" }).reason, "market_not_enabled");
  assert.deepEqual(classifyAttribution({ lead: { source_label: "Google Ads" } }), { attribution_path: "website", attribution_status: "pending", evidence: "unverified_pending_match" });
});

test("requires every structured qualification field and the minimum expected value", () => {
  assert.equal(qualifiedLeadEligibility({ homeowner: true, service_area_valid: true, installed_service: true, expected_value_usd: 1999 }).reason, "expected_value_below_threshold");
  assert.equal(qualifiedLeadEligibility({ homeowner: true, expected_value_usd: 3000 }).reason, "required_qualification_fields_missing");
});

test("persists idempotently with INSERT OR IGNORE", async () => {
  const db = new MemoryD1();
  const { candidate } = buildOutcomeCandidate({ event_name: "appointment_set", market_key: "mo_stl", milestone_at: "2026-09-21T18:00:00Z", jobber_request_id: "r1", jobber_appointment_id: "a1" });
  assert.equal((await persistOutcomeCandidate(db, candidate)).inserted, true);
  assert.equal((await persistOutcomeCandidate(db, candidate)).inserted, false);
  assert.match(db.calls[0].sql, /INSERT OR IGNORE/);
});
