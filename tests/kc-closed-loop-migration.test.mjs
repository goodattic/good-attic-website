import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

function apply(sqlite, name) {
  sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}

test('KC ledger migration preserves UT/STL lead, event, reconciliation, Quote claim, and indexes', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys = ON');
    for (const name of [
      '0005_closed_loop_tracking.sql',
      '0006_closed_loop_quote_attribution.sql',
      '0007_atomic_quote_attribution_claims.sql',
      '0026_quote_google_call_replay.sql',
    ]) apply(sqlite, name);
    const at = '2026-10-19T12:00:00.000Z';
    for (const [market, suffix] of [['ut', 'ut'], ['mo_stl', 'stl']]) {
      sqlite.prepare(`INSERT INTO closed_loop_leads
        (lead_id, submission_id, market_key, jobber_account_id, jobber_request_id,
         jobber_client_id, original_source, source_detail, campaign, service,
         landing_page, gclid, gbraid, wbraid, consent_state, inquiry_at,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`jobber-request:${suffix}`, `submission-${suffix}`, market,
          `account-${suffix}`, `request-${suffix}`, `client-${suffix}`,
          'Google Ads', 'google_ads', `campaign-${suffix}`, 'insulation',
          `https://goodattic.energy/${suffix}/`, `click-${suffix}`, null, null,
          'granted', at, at, at);
      sqlite.prepare(`INSERT INTO closed_loop_events
        (event_id, lead_id, market_key, event_name, jobber_object_type,
         jobber_object_id, occurred_at, value_micros, currency_code,
         google_conversion_action, upload_status, upload_attempts,
         google_upload_at, google_error_code, created_at, updated_at)
        VALUES (?, ?, ?, 'qualified_lead', 'Request', ?, ?, 1000000, 'USD',
          'conversion-action', 'held', 2, NULL, 'test_code', ?, ?)`)
        .run(`event-${suffix}`, `jobber-request:${suffix}`, market,
          `request-${suffix}`, at, at, at);
      sqlite.prepare(`INSERT INTO closed_loop_reconciliation
        (reconciliation_date, market_key, metric_name, source_count,
         destination_count, difference_count, difference_rate, alert_status,
         created_at) VALUES ('2026-10-19', ?, 'qualified_lead', 3, 2, 1,
          0.333333, 'critical', ?)`)
        .run(market, at);
      sqlite.prepare(`INSERT INTO closed_loop_quote_attributions
        (quote_id, lead_id, market_key, jobber_request_id, status,
         attempt_count, last_error_code, created_at, updated_at,
         completed_at, claim_token, claim_expires_at)
        VALUES (?, ?, ?, ?, 'retryable', 3, 'transient', ?, ?, NULL, ?, 12345)`)
        .run(`quote-${suffix}`, `jobber-request:${suffix}`, market,
          `request-${suffix}`, at, at, `claim-${suffix}`);
    }

    const tables = ['closed_loop_leads', 'closed_loop_events',
      'closed_loop_reconciliation', 'closed_loop_quote_attributions'];
    const before = Object.fromEntries(tables.map(name => [name,
      sqlite.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]));
    apply(sqlite, '0030_kc_proven_website_closed_loop.sql');
    for (const name of tables) {
      assert.deepEqual(sqlite.prepare(`SELECT * FROM ${name} ORDER BY 1`).all(),
        before[name], `${name} existing rows remain unchanged`);
    }
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    const eventForeignKey = sqlite.prepare('PRAGMA foreign_key_list(closed_loop_events)').all();
    assert.equal(eventForeignKey[0].table, 'closed_loop_leads');
    const indexes = new Set(sqlite.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'index'`).all().map(row => row.name));
    for (const name of [
      'closed_loop_leads_market_source', 'closed_loop_leads_gclid',
      'closed_loop_events_upload_queue', 'closed_loop_events_lead',
      'closed_loop_quote_attributions_status_idx',
      'closed_loop_quote_attributions_claim_idx',
      'closed_loop_quote_attributions_call_lead_idx',
    ]) assert.ok(indexes.has(name), `${name} was recreated`);

    sqlite.prepare(`INSERT INTO closed_loop_leads
      (lead_id, submission_id, market_key, jobber_request_id,
       original_source, inquiry_at, created_at, updated_at)
      VALUES ('jobber-request:kc', 'submission-kc', 'mo_kc', 'request-kc',
        'Google Ads', ?, ?, ?)`).run(at, at, at);
    sqlite.prepare(`INSERT INTO closed_loop_events
      (event_id, lead_id, market_key, event_name, occurred_at, created_at, updated_at)
      VALUES ('event-kc', 'jobber-request:kc', 'mo_kc', 'qualified_lead', ?, ?, ?)`)
      .run(at, at, at);
    sqlite.prepare(`INSERT INTO closed_loop_reconciliation
      (reconciliation_date, market_key, metric_name, source_count,
       destination_count, difference_count, difference_rate, alert_status,
       created_at) VALUES ('2026-10-19', 'mo_kc', 'qualified_lead',
        1, 1, 0, 0, 'ok', ?)`)
      .run(at);
    sqlite.prepare(`INSERT INTO closed_loop_quote_attributions
      (quote_id, lead_id, market_key, jobber_request_id, created_at, updated_at)
      VALUES ('quote-kc', 'jobber-request:kc', 'mo_kc', 'request-kc', ?, ?)`)
      .run(at, at);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => sqlite.prepare(`INSERT INTO closed_loop_leads
      (lead_id, submission_id, market_key, jobber_request_id,
       original_source, inquiry_at, created_at, updated_at)
      VALUES ('bad', 'bad', 'unknown', 'bad', 'Google Ads', ?, ?, ?)`)
      .run(at, at, at), /CHECK constraint failed/);
    assert.throws(() => sqlite.prepare(`INSERT INTO closed_loop_leads
      (lead_id, submission_id, market_key, jobber_request_id,
       original_source, inquiry_at, created_at, updated_at)
      VALUES ('duplicate', 'different', 'mo_kc', 'request-kc',
        'Google Ads', ?, ?, ?)`)
      .run(at, at, at), /UNIQUE constraint failed/);
  } finally { sqlite.close(); }
});
