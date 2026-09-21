import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClosedLoopLead,
  lifecycleEventId,
  reconcileMetric,
  recordLifecycleEvent,
} from "../server/closed-loop-ledger.js";

class MemoryD1 {
  constructor() {
    this.calls = [];
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        run: async () => {
          this.calls.push({ sql, args });
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

test("builds a Utah website lead without storing personal contact data", () => {
  const record = buildClosedLoopLead(
    {
      ad_landing_page: "https://goodattic.energy/salt-lake-city-ut/?gclid=abc123&utm_campaign=ut_attic",
      gclid: "abc123",
      utm_campaign: "ut_attic",
    },
    {
      submission_id: "submission-1",
      market_key: "ut",
      source_label: "Google Ads",
      source_detail: "google_ads",
      service: "Attic Insulation",
      consent: "accepted",
      submitted_at: "2026-09-21T16:00:00Z",
    },
    {
      request_id: "request-1",
      client_id: "client-1",
    },
  );

  assert.equal(record.lead_id, "jobber-request:request-1");
  assert.equal(record.market_key, "ut");
  assert.equal(record.original_source, "Google Ads");
  assert.equal(record.campaign, "ut_attic");
  assert.equal(record.gclid, "abc123");
  assert.equal(record.landing_page, "https://goodattic.energy/salt-lake-city-ut/");
  assert.equal("email" in record, false);
  assert.equal("phone" in record, false);
  assert.equal("name" in record, false);
});

test("does not activate the first rollout for Kansas City", () => {
  assert.equal(buildClosedLoopLead({}, {
    submission_id: "submission-kc",
    market_key: "mo_kc",
  }, {
    request_id: "request-kc",
  }), null);
});

test("creates deterministic event IDs and inserts an event once", async () => {
  const database = new MemoryD1();
  const input = {
    lead_id: "jobber-request:request-1",
    market_key: "mo_stl",
    event_name: "appointment_set",
    jobber_object_type: "assessment",
    jobber_object_id: "assessment-1",
    occurred_at: "2026-09-22T15:00:00Z",
  };
  const expected = lifecycleEventId({
    leadId: input.lead_id,
    eventName: input.event_name,
    objectId: input.jobber_object_id,
    occurredAt: input.occurred_at,
  });
  const result = await recordLifecycleEvent(database, input);
  assert.equal(result.ok, true);
  assert.equal(result.inserted, true);
  assert.equal(result.event_id, expected);
  assert.match(database.calls[0].sql, /INSERT OR IGNORE/);
});

test("flags reconciliation differences above 15 percent", async () => {
  const database = new MemoryD1();
  const result = await reconcileMetric(database, {
    reconciliation_date: "2026-09-21",
    market_key: "ut",
    metric_name: "sold_job",
    source_count: 10,
    destination_count: 8,
  });
  assert.equal(result.alert_status, "critical");
  assert.equal(result.difference_rate, 0.2);
});
