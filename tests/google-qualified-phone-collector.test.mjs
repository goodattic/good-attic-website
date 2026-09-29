import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQualifiedPhoneCandidate,
  collectQualifiedPhoneCalls,
  googleCallEligible,
  googleCallKey,
  matchJobberLead,
  matchQuoCallToGoogleCall,
  marketForDestination,
} from "../server/google-qualified-phone-collector.js";

const googleCall = {
  campaign_id: "utah-search",
  market_key: "ut",
  destination_number: "+13853364442",
  start_call_date_time: "2026-09-25 08:30:19-06:00",
  call_duration_seconds: 20,
  caller_area_code: "801",
};
const quoCall = {
  quo_call_id: "quo-tara",
  market_key: "ut",
  destination_number: "+13853364442",
  caller_phone: "+18015551234",
  call_started_at_utc: "2026-09-25T14:30:20Z",
  direction: "incoming",
  final_status: "no-answer",
};

test("maps only the configured market lines", () => {
  assert.equal(marketForDestination("+1 (385) 336-4442"), "ut");
  assert.equal(marketForDestination("+13149312620"), "mo_stl");
  assert.equal(marketForDestination("+18164340308"), "mo_kc");
});

test("matches the Google call to the nearest Quo call by market, time, and area code", () => {
  const result = matchQuoCallToGoogleCall(googleCall, [quoCall, { ...quoCall, quo_call_id: "wrong-area", caller_phone: "+16175551234" }]);
  assert.equal(result.ok, true);
  assert.equal(result.call.quo_call_id, "quo-tara");
  assert.equal(result.delta_seconds, 1);
});

test("does not match a non-ad Quo call or a different market", () => {
  assert.equal(matchQuoCallToGoogleCall(googleCall, [{ ...quoCall, destination_number: "+13149312620" }]).reason, "no_matching_quo_call");
  assert.equal(matchQuoCallToGoogleCall(googleCall, [{ ...quoCall, caller_phone: "+18015551234", call_started_at_utc: "2026-09-25T14:40:20Z" }]).reason, "no_matching_quo_call");
});

test("holds answered Google calls at the normal call-counting threshold", () => {
  assert.equal(googleCallEligible({ call_status: "answered", call_duration_seconds: 59 }), true);
  assert.equal(googleCallEligible({ call_status: "answered", call_duration_seconds: 60 }), false);
  assert.equal(googleCallEligible({ call_status: "missed", call_duration_seconds: 300 }), true);
});

test("matches only a new Jobber lead in the one-hour-before/seven-day-after window", () => {
  const matched = matchJobberLead({ callerPhone: quoCall.caller_phone, googleCallAt: googleCall.start_call_date_time, marketKey: "ut", records: [{ id: "request-1", market_key: "ut", phone: quoCall.caller_phone, created_at: "2026-09-25T15:00:00Z" }] });
  assert.equal(matched.ok, true);
  assert.equal(matched.record.id, "request-1");
  assert.equal(matchJobberLead({ callerPhone: quoCall.caller_phone, googleCallAt: googleCall.start_call_date_time, marketKey: "ut", records: [{ id: "old", phone: quoCall.caller_phone, created_at: "2026-09-20T15:00:00Z", prior_completed_work: true }] }).reason, "no_new_jobber_lead");
});

test("Tara-shaped match creates a shadow-only qualified call candidate with stable call id", () => {
  const result = buildQualifiedPhoneCandidate({ googleCall, quoCall, jobberRecord: { id: "request-tara", client_id: "client-tara", created_at: "2026-09-25T15:02:00Z" } });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.event_name, "qualified_lead");
  assert.equal(result.candidate.google_conversion_action, "7742989654");
  assert.equal(result.candidate.upload_state, "held");
  assert.equal(result.candidate.diagnostic_code, "shadow_only");
  assert.match(result.candidate.outcome_id, /^google-call:/);
  assert.equal(result.candidate.value_micros, 0);
  assert.equal(googleCallKey(googleCall, quoCall.caller_phone), googleCallKey(googleCall, quoCall.caller_phone));
});

test("Kansas City uses its own line and Jobber account without enabling other outcome stages", () => {
  const result = buildQualifiedPhoneCandidate({
    googleCall: { ...googleCall, market_key: "mo_kc", destination_number: "+18164340308" },
    quoCall: { ...quoCall, market_key: "mo_kc", destination_number: "+18164340308" },
    jobberRecord: { id: "request-kc", client_id: "client-kc", created_at: "2026-09-25T15:02:00Z" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.market_key, "mo_kc");
  assert.equal(result.candidate.google_conversion_action, "7742989654");
});

test("collector writes no rows for unmatched calls and is upload-disabled", async () => {
  const result = await collectQualifiedPhoneCalls({ googleCalls: [googleCall], quoCalls: [], jobberRecordsByMarket: {} });
  assert.equal(result.upload_enabled, false);
  assert.equal(result.rows[0].matched_quo, false);
  assert.equal(result.rows[0].reason, "no_matching_quo_call");
});
