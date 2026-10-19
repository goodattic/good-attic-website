import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { reconcileMissingKcPaidWebsiteLeads } from '../server/fieldflow-attribution.js';
import { pollKcPaidLineage } from '../server/kc-paid-lineage-poller.js';

const ACCOUNT = 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==';
const AT = '2026-10-19T17:00:00.000Z';
const UUID = '31534eaa-e6cb-4a2a-ac68-07bed5877c90';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0005_closed_loop_tracking.sql', '0006_closed_loop_quote_attribution.sql',
    '0007_atomic_quote_attribution_claims.sql', '0026_quote_google_call_replay.sql',
    '0017_website_form_transaction_ids.sql', '0005_acknowledgement_sources.sql',
    '0029_kc_google_website_source_proofs.sql',
    '0030_kc_proven_website_closed_loop.sql', '0031_kc_paid_website_lineage.sql',
  ]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  const database = {
    prepare(sql) {
      return { bind(...params) {
        return {
          first: async () => sqlite.prepare(sql).get(...params) || null,
          all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
          run: async () => ({ meta: sqlite.prepare(sql).run(...params) }),
          sql, params,
        };
      } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(item => sqlite.prepare(item.sql).run(...item.params));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, database };
}

function completedChain(sqlite, { uuid = UUID, request = 'r1', client = 'c1',
  click = 'abc123456', proofClick = click, campaign = 'KC paid',
  formState = 'completed', receipt = true } = {}) {
  const evidence = JSON.stringify({ schema_version: 1, source_key: 'google',
    source_detail: 'google_ads', source_reason: 'gclid',
    verified_signals: { gclid: proofClick },
    attribution: { attribution_captured_at: AT,
      ad_landing_page: `https://goodattic.energy/kansas-city-mo/?gclid=${click}&utm_campaign=${encodeURIComponent(campaign)}` } });
  sqlite.prepare(`INSERT INTO website_google_source_proofs (
    submission_id, source_lead_id, market_key, account_id, source_key,
    source_detail, source_reason, evidence_json, state, jobber_source_app,
    jobber_request_id, jobber_client_id, created_at, updated_at)
    VALUES (?, ?, 'mo_kc', ?, 'google', 'google_ads', 'gclid', ?,
      'completed', 'website', ?, ?, ?, ?)`)
    .run(uuid, `website:${uuid}`, ACCOUNT, evidence, request, client, AT, AT);
  sqlite.prepare(`INSERT INTO website_form_conversions (
    submission_id, transaction_id, market_key, jobber_account_id,
    jobber_request_id, jobber_client_id, state, conversion_at, created_at, updated_at)
    VALUES (?, ?, 'mo_kc', ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid, uuid, ACCOUNT, request, client, formState, AT, AT, AT);
  if (receipt) sqlite.prepare(`INSERT INTO acknowledgement_sources (
    account_id, request_id, market_key, client_id, source_kind,
    source_lead_id, source_created_at, recorded_at)
    VALUES (?, ?, 'mo_kc', ?, 'website', ?, ?, ?)`)
    .run(ACCOUNT, request, client, `website:${uuid}`, AT, AT);
}

function emptyGraph() {
  const page = { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } };
  return async document => {
    assert.doesNotMatch(document, /mutation/i);
    if (document.includes('KcPaidLineageRequestQuotes')) {
      return { data: { account: { id: ACCOUNT }, request: {
        id: 'r1', client: { id: 'c1' }, quotes: page } } };
    }
    if (document.includes('KcPaidLineageRequestJobs')) {
      return { data: { account: { id: ACCOUNT }, request: {
        id: 'r1', client: { id: 'c1' }, jobs: page } } };
    }
    return { data: { account: { id: ACCOUNT }, request: {
      id: 'r1', client: { id: 'c1' }, assessment: null } } };
  };
}

test('scheduled poll repairs a completed paid form before selecting lineage, without a Jobber write', async () => {
  const { sqlite, database } = fixture();
  try {
    completedChain(sqlite);
    const result = await pollKcPaidLineage({ ANGI_ROUTER_DB: database }, {
      limit: 1, query: emptyGraph(), now: () => AT,
    });
    assert.equal(result.reconciliation.recovered, 1);
    assert.equal(result.linked, 1);
    const lead = sqlite.prepare('SELECT * FROM closed_loop_leads').get();
    assert.equal(lead.submission_id, UUID);
    assert.equal(lead.jobber_request_id, 'r1');
    assert.equal(lead.jobber_client_id, 'c1');
    assert.equal(lead.campaign, 'KC paid');
    assert.equal(lead.gclid, 'abc123456');
    assert.equal(lead.gbraid, null);
    assert.equal(lead.wbraid, null);
    assert.equal(lead.consent_state, null, 'lost consent is not inferred');
    assert.equal(sqlite.prepare('SELECT status FROM kc_paid_ledger_reconciliations').get().status,
      'recovered');
    const repeat = await reconcileMissingKcPaidWebsiteLeads(database);
    assert.equal(repeat.examined, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM closed_loop_leads').get().count, 1);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { sqlite.close(); }
});

test('mismatched click proof is held and does not starve the next valid completed form', async () => {
  const { sqlite, database } = fixture();
  try {
    completedChain(sqlite, { proofClick: 'wrong123456' });
    const first = await reconcileMissingKcPaidWebsiteLeads(database, { limit: 1,
      now: () => AT });
    assert.equal(first.held, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM closed_loop_leads').get().count, 0);
    const secondUuid = '41534eaa-e6cb-4a2a-ac68-07bed5877c90';
    completedChain(sqlite, { uuid: secondUuid, request: 'r2', client: 'c2' });
    const second = await reconcileMissingKcPaidWebsiteLeads(database, { limit: 1,
      now: () => AT });
    assert.equal(second.recovered, 1);
    assert.equal(sqlite.prepare('SELECT submission_id FROM closed_loop_leads').get().submission_id,
      secondUuid);
    assert.equal(sqlite.prepare(`SELECT status FROM kc_paid_ledger_reconciliations
      WHERE submission_id = ?`).get(UUID).status, 'held');
  } finally { sqlite.close(); }
});

test('partial source chain and conflicting existing Request cannot create a repaired lead', async () => {
  const { sqlite, database } = fixture();
  try {
    completedChain(sqlite, { receipt: false });
    assert.equal((await reconcileMissingKcPaidWebsiteLeads(database)).examined, 0);
    sqlite.prepare(`INSERT INTO acknowledgement_sources (
      account_id, request_id, market_key, client_id, source_kind,
      source_lead_id, source_created_at, recorded_at)
      VALUES (?, 'r1', 'mo_kc', 'c1', 'website', ?, ?, ?)`)
      .run(ACCOUNT, `website:${UUID}`, AT, AT);
    sqlite.prepare(`INSERT INTO closed_loop_leads (
      lead_id, submission_id, market_key, jobber_account_id, jobber_request_id,
      jobber_client_id, original_source, inquiry_at, created_at, updated_at)
      VALUES ('jobber-request:r1', 'different-submission', 'mo_kc', ?, 'r1',
        'c1', 'Google Ads', ?, ?, ?)`)
      .run(ACCOUNT, AT, AT, AT);
    const result = await reconcileMissingKcPaidWebsiteLeads(database);
    assert.equal(result.held, 1);
    assert.equal(sqlite.prepare('SELECT submission_id FROM closed_loop_leads').get().submission_id,
      'different-submission');
    assert.equal(sqlite.prepare('SELECT reason FROM kc_paid_ledger_reconciliations').get().reason,
      'ledger_identity_conflict');
  } finally { sqlite.close(); }
});

test('an existing exact paid lead is verified once without a second write', async () => {
  const { sqlite, database } = fixture();
  try {
    completedChain(sqlite);
    sqlite.prepare(`INSERT INTO closed_loop_leads (
      lead_id, submission_id, market_key, jobber_account_id, jobber_request_id,
      jobber_client_id, original_source, source_detail, campaign, gclid,
      inquiry_at, created_at, updated_at)
      VALUES ('jobber-request:r1', ?, 'mo_kc', ?, 'r1', 'c1', 'Google Ads',
        'google_ads', 'KC paid', 'abc123456', ?, ?, ?)`)
      .run(UUID, ACCOUNT, AT, AT, AT);
    const result = await reconcileMissingKcPaidWebsiteLeads(database);
    assert.equal(result.recovered, 0);
    assert.equal(result.verified, 1);
    assert.equal(sqlite.prepare('SELECT status FROM kc_paid_ledger_reconciliations').get().status,
      'verified');
    assert.equal((await reconcileMissingKcPaidWebsiteLeads(database)).examined, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM closed_loop_leads').get().count, 1);
  } finally { sqlite.close(); }
});

test('a same-identity row with wrong lead ID, source, or click is held visibly', async () => {
  for (const variant of ['lead_id', 'source', 'click']) {
    const { sqlite, database } = fixture();
    try {
      completedChain(sqlite);
      const leadId = variant === 'lead_id' ? 'other-lead:r1' : 'jobber-request:r1';
      const source = variant === 'source' ? 'Organic Online' : 'Google Ads';
      const click = variant === 'click' ? 'wrong123456' : 'abc123456';
      sqlite.prepare(`INSERT INTO closed_loop_leads (
        lead_id, submission_id, market_key, jobber_account_id, jobber_request_id,
        jobber_client_id, original_source, source_detail, campaign, gclid,
        inquiry_at, created_at, updated_at)
        VALUES (?, ?, 'mo_kc', ?, 'r1', 'c1', ?, 'google_ads', 'KC paid', ?, ?, ?, ?)`)
        .run(leadId, UUID, ACCOUNT, source, click, AT, AT, AT);
      const result = await reconcileMissingKcPaidWebsiteLeads(database);
      assert.equal(result.held, 1, variant);
      assert.equal(result.verified, 0, variant);
      assert.equal(result.recovered, 0, variant);
      assert.equal(sqlite.prepare('SELECT lead_id FROM closed_loop_leads').get().lead_id,
        leadId, variant);
      assert.equal(sqlite.prepare('SELECT reason FROM kc_paid_ledger_reconciliations').get().reason,
        'ledger_identity_conflict', variant);
    } finally { sqlite.close(); }
  }
});
