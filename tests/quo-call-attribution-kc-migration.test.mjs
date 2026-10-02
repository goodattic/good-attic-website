import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');

test('capture staging is additive, one row per call, and independent of the live broker ledger', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration('0008_quo_call_attributions'));
  db.exec(migration('0018_quo_call_capture_stage'));
  const columns = db.prepare('PRAGMA table_info(quo_call_capture_stage)').all().map(row => row.name);
  assert.equal(columns.includes('attribution_id'), false);
  assert.equal(columns.includes('jobber_request_id'), false);
  assert.equal(columns.includes('google_upload_status'), false);
  assert.ok(columns.includes('answered_at'));
  assert.ok(columns.includes('merged_at'));
  assert.ok(columns.includes('hold_reason'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='quo_call_capture_stage_caller_idx'").get());

  const staged = {
    account_id:'account-ut', quo_call_id:'ACstage', market:'utah', phone_number_id:'PNutah',
    caller_phone:'+18015550100', call_started_at_original:'2026-10-02T08:30:19-06:00',
    call_started_at_utc:'2026-10-02T14:30:19.000Z', destination_number:'+13853364442',
    direction:'incoming', final_status:'missed', duration_seconds:0, answered_at:null,
    first_time_caller_status:null, source_event_id:'EVcanonical1', conversation_id:'CNstage',
    created_at:'2026-10-02T14:31:00.000Z', updated_at:'2026-10-02T14:31:00.000Z',
  };
  const insert = db.prepare(`INSERT OR IGNORE INTO quo_call_capture_stage (${Object.keys(staged).join(',')})
    VALUES (${Object.keys(staged).map(() => '?').join(',')})`);
  assert.equal(insert.run(...Object.values(staged)).changes, 1);
  assert.equal(insert.run(...Object.values(staged)).changes, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quo_call_capture_stage').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quo_call_attributions').get().n, 0);

  const broker = {
    attribution_id:'quo-call:account-ut:ACstage', account_id:'account-ut', market:'utah',
    phone_number_id:'PNutah', quo_call_id:'ACstage', caller_phone:'+18015550100',
    call_started_at_original:'2026-10-02T08:30:19-06:00',
    call_started_at_utc:'2026-10-02T14:30:19.000Z', destination_number:'+13853364442',
    direction:'incoming', final_status:'ringing', source_event_id:'EVbroker',
    conversation_id:'CNstage', created_at:'2026-10-02T14:30:20.000Z', updated_at:'2026-10-02T14:30:20.000Z',
  };
  db.prepare(`INSERT INTO quo_call_attributions (${Object.keys(broker).join(',')})
    VALUES (${Object.keys(broker).map(() => '?').join(',')})`).run(...Object.values(broker));
  db.prepare(`UPDATE quo_call_capture_stage SET final_status=?,duration_seconds=?,answered_at=?,source_event_id=?,updated_at=?
    WHERE account_id=? AND quo_call_id=? AND caller_phone=? AND call_started_at_utc=?`).run(
      'completed',64,'2026-10-02T14:30:25.000Z','EVcanonical2','2026-10-02T14:32:00.000Z',
      staged.account_id,staged.quo_call_id,staged.caller_phone,staged.call_started_at_utc);
  const stage = db.prepare('SELECT * FROM quo_call_capture_stage').get();
  assert.equal(stage.final_status,'completed');
  assert.equal(stage.duration_seconds,64);
  assert.equal(stage.answered_at,'2026-10-02T14:30:25.000Z');
  assert.equal(stage.source_event_id,'EVcanonical2');
  assert.equal(stage.created_at,staged.created_at);
  assert.equal(stage.merged_at,null);
  const live = db.prepare('SELECT final_status,source_event_id FROM quo_call_attributions').get();
  assert.equal(live.final_status,'ringing');
  assert.equal(live.source_event_id,'EVbroker');
  assert.throws(() => db.prepare('INSERT INTO quo_call_capture_stage(account_id,quo_call_id,market,phone_number_id,caller_phone,call_started_at_original,call_started_at_utc,destination_number,direction,final_status,source_event_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'account-ut','ACinvalid','unknown','PNutah','+18015550100','2026-10-02T08:30:19-06:00','2026-10-02T14:30:19.000Z','+13853364442','incoming','missed','EVinvalid','2026-10-02T14:31:00.000Z','2026-10-02T14:31:00.000Z'), /CHECK constraint/i);
  db.close();
});

test('KC ledger migration preserves linked calls and admits an unlinked KC call', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration('0008_quo_call_attributions'));
  const utah = {
    attribution_id: 'quo-call:utah:ACexisting', account_id: 'utah', market: 'utah',
    phone_number_id: 'PNutah', quo_call_id: 'ACexisting', caller_phone: '+18015550100',
    call_started_at_original: '2026-09-25T08:30:19-06:00',
    call_started_at_utc: '2026-09-25T14:30:19.000Z', destination_number: '+13853364442',
    direction: 'incoming', final_status: 'missed', jobber_request_id: 'RequestExisting',
    jobber_client_id: 'ClientExisting', source_event_id: 'EVexisting',
    created_at: '2026-09-25T14:30:19.000Z', updated_at: '2026-09-25T14:30:19.000Z',
  };
  db.prepare(`INSERT INTO quo_call_attributions (${Object.keys(utah).join(',')}) VALUES (${Object.keys(utah).map(() => '?').join(',')})`)
    .run(...Object.values(utah));

  db.exec(migration('0019_quo_call_attributions_kc'));
  const preserved = db.prepare('SELECT * FROM quo_call_attributions WHERE quo_call_id=?').get('ACexisting');
  assert.equal(preserved.jobber_request_id, 'RequestExisting');
  assert.equal(preserved.jobber_client_id, 'ClientExisting');
  assert.equal(preserved.google_upload_status, 'not_submitted');
  assert.equal(preserved.consent_status, 'unknown');
  assert.equal(preserved.call_started_at_original, utah.call_started_at_original);
  assert.equal(preserved.answered_at, null);
  assert.throws(() => db.prepare("UPDATE quo_call_attributions SET google_upload_status='accepted' WHERE quo_call_id='ACexisting'").run(), /CHECK constraint/i);
  assert.throws(() => db.prepare("UPDATE quo_call_attributions SET consent_status='granted' WHERE quo_call_id='ACexisting'").run(), /CHECK constraint/i);

  const kc = {
    attribution_id: 'quo-call:kc:ACnew', account_id: 'kc', market: 'kc',
    phone_number_id: 'PNkc', quo_call_id: 'ACnew', caller_phone: '+18165550100',
    call_started_at_original: '2026-09-25T08:30:19-05:00',
    call_started_at_utc: '2026-09-25T13:30:19.000Z', destination_number: '+18164340308',
    direction: 'incoming', final_status: 'missed', source_event_id: 'EVnew',
    created_at: '2026-09-25T13:30:19.000Z', updated_at: '2026-09-25T13:30:19.000Z',
  };
  db.prepare(`INSERT INTO quo_call_attributions (${Object.keys(kc).join(',')}) VALUES (${Object.keys(kc).map(() => '?').join(',')})`)
    .run(...Object.values(kc));
  const stored = db.prepare('SELECT * FROM quo_call_attributions WHERE quo_call_id=?').get('ACnew');
  assert.equal(stored.jobber_request_id, null);
  assert.equal(stored.market, 'kc');
  db.prepare('UPDATE quo_call_attributions SET answered_at=? WHERE quo_call_id=?')
    .run('2026-09-25T13:30:25.000Z','ACnew');
  assert.equal(db.prepare('SELECT answered_at FROM quo_call_attributions WHERE quo_call_id=?').get('ACnew').answered_at,
    '2026-09-25T13:30:25.000Z');
  assert.throws(() => db.prepare('UPDATE quo_call_attributions SET market=? WHERE quo_call_id=?').run('unknown', 'ACnew'), /CHECK constraint/i);
  db.close();
});
