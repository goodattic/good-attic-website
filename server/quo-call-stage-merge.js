const read = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
async function run(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).run();
  if (result?.success === false) throw Error('stage_merge_database_write_failed');
  return Number(result?.meta?.changes || 0);
}
const utc = value => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};

function sameIdentity(stage, live) {
  if (!stage || !live || !utc(stage.call_started_at_utc)
    || utc(stage.call_started_at_original) !== utc(stage.call_started_at_utc)
    || utc(live.call_started_at_original) !== utc(live.call_started_at_utc)
    || utc(stage.call_started_at_utc) !== utc(live.call_started_at_utc)) return false;
  for (const key of ['account_id', 'quo_call_id', 'market', 'phone_number_id',
    'caller_phone', 'destination_number', 'direction']) {
    if (stage[key] !== live[key]) return false;
  }
  return !(stage.conversation_id && live.conversation_id
    && stage.conversation_id !== live.conversation_id);
}

function validStage(stage) {
  return stage && stage.direction === 'incoming' && stage.account_id && stage.quo_call_id
    && stage.market && stage.phone_number_id && stage.caller_phone && stage.destination_number
    && stage.source_event_id && stage.final_status && utc(stage.call_started_at_utc)
    && utc(stage.call_started_at_original) === utc(stage.call_started_at_utc)
    && (!stage.answered_at || utc(stage.answered_at));
}

async function hold(db, stage, reason) {
  await run(db, 'UPDATE quo_call_capture_stage SET hold_reason=? WHERE account_id=? AND quo_call_id=?',
    reason, stage.account_id, stage.quo_call_id);
  return { ok: false, held: true, reason };
}

async function autoRequestOwnership(db, stage) {
  const owner = await read(db, `SELECT o.account_id,o.market,o.phone,o.phone_number_id,o.operation_state,
    o.request_id,o.client_id,o.uncertain,o.source_json
    FROM quo_intake_source_guards g JOIN quo_intake_operations o ON o.operation_id=g.operation_id
    WHERE g.account_id=? AND g.source_type='call' AND g.source_id=?`,
    stage.account_id, stage.quo_call_id);
  if (!owner) return { ok: true, requestId: null, clientId: null,
    sourceEventId: stage.source_event_id, original: stage.call_started_at_original };
  let source;
  try { source = JSON.parse(owner.source_json); } catch { return { ok: false, reason: 'auto_request_source_invalid' }; }
  const original = source?.occurred_at_original || source?.occurred_at;
  if (owner.account_id !== stage.account_id || owner.market !== stage.market
    || owner.phone !== stage.caller_phone || owner.phone_number_id !== stage.phone_number_id
    || source?.type !== 'call' || source.id !== stage.quo_call_id
    || source.from !== stage.caller_phone || source.to !== stage.destination_number
    || source.direction !== 'incoming' || utc(original) !== utc(stage.call_started_at_utc)
    || (source.conversation_id && stage.conversation_id
      && source.conversation_id !== stage.conversation_id)) {
    return { ok: false, reason: 'auto_request_source_conflict' };
  }
  if (owner.uncertain || !['completed', 'suppressed'].includes(owner.operation_state)) {
    return { ok: false, reason: 'auto_request_unresolved' };
  }
  if (owner.operation_state === 'suppressed') {
    return owner.request_id || owner.client_id
      ? { ok: false, reason: 'auto_request_link_conflict' }
      : { ok: true, requestId: null, clientId: null,
        sourceEventId: stage.source_event_id, original: stage.call_started_at_original };
  }
  if (!owner.request_id || !owner.client_id || typeof source.event_id !== 'string' || !source.event_id) {
    return { ok: false, reason: 'auto_request_link_incomplete' };
  }
  return { ok: true, requestId: owner.request_id, clientId: owner.client_id,
    sourceEventId: source.event_id, original };
}

/** Local-only merge. The caller must first verify both auto-Request flags off and zero in-flight broker writes. */
export async function mergeStagedQuoCall(db, { accountId, quoCallId, cutover, at = new Date().toISOString() }) {
  if (cutover?.workerAutoRequestsEnabled !== false || cutover?.pagesAutoRequestsEnabled !== false
    || cutover?.brokerWritesDrained !== true || cutover?.inFlightBrokerWrites !== 0) {
    return { ok: false, reason: 'cutover_not_ready' };
  }
  if (!accountId || !quoCallId || !utc(at)) return { ok: false, reason: 'merge_input_invalid' };
  const pending = await read(db, `SELECT COUNT(*) AS count FROM quo_intake_operations
    WHERE operation_kind='intake' AND operation_state NOT IN ('completed','suppressed','held')`);
  if (pending?.count !== 0) return { ok: false, reason: 'cutover_not_ready' };
  const stage = await read(db, 'SELECT * FROM quo_call_capture_stage WHERE account_id=? AND quo_call_id=?',
    accountId, quoCallId);
  if (!stage) return { ok: false, reason: 'stage_call_missing' };
  if (stage.hold_reason) return { ok: false, held: true, reason: stage.hold_reason };
  if (!validStage(stage)) return hold(db, stage, 'stage_identity_invalid');

  let live = await read(db, 'SELECT * FROM quo_call_attributions WHERE account_id=? AND quo_call_id=?',
    accountId, quoCallId);
  if (live && !sameIdentity(stage, live)) return hold(db, stage, 'ledger_identity_conflict');
  if (stage.merged_at) return live ? { ok: true, alreadyMerged: true } : hold(db, stage, 'merged_ledger_missing');

  if (!live) {
    const ownership = await autoRequestOwnership(db, stage);
    if (!ownership.ok) return hold(db, stage, ownership.reason);
    await run(db, `INSERT OR IGNORE INTO quo_call_attributions
      (attribution_id,account_id,market,phone_number_id,quo_call_id,caller_phone,
       call_started_at_original,call_started_at_utc,destination_number,direction,
       final_status,duration_seconds,answered_at,first_time_caller_status,
       jobber_request_id,jobber_client_id,source_event_id,conversation_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      `quo-call:${stage.account_id}:${stage.quo_call_id}`,stage.account_id,stage.market,
      stage.phone_number_id,stage.quo_call_id,stage.caller_phone,ownership.original,
      stage.call_started_at_utc,stage.destination_number,stage.direction,stage.final_status,
      stage.duration_seconds,stage.answered_at,stage.first_time_caller_status,
      ownership.requestId,ownership.clientId,ownership.sourceEventId,stage.conversation_id,
      stage.created_at,at);
    live = await read(db, 'SELECT * FROM quo_call_attributions WHERE account_id=? AND quo_call_id=?',
      accountId, quoCallId);
    if (!live) return hold(db, stage, 'ledger_insert_conflict');
    if (!sameIdentity(stage, live)) return hold(db, stage, 'ledger_identity_conflict');
  }

  const changed = await run(db, `UPDATE quo_call_attributions SET
    final_status=?,duration_seconds=COALESCE(?,duration_seconds),
    answered_at=COALESCE(?,answered_at),
    first_time_caller_status=COALESCE(?,first_time_caller_status),updated_at=?
    WHERE account_id=? AND quo_call_id=? AND source_event_id=?
      AND call_started_at_original=? AND jobber_request_id IS ? AND jobber_client_id IS ?
      AND google_upload_status=? AND consent_status=?`,
    stage.final_status,stage.duration_seconds,stage.answered_at,stage.first_time_caller_status,at,
    accountId,quoCallId,live.source_event_id,live.call_started_at_original,
    live.jobber_request_id,live.jobber_client_id,live.google_upload_status,live.consent_status);
  if (changed !== 1) return hold(db, stage, 'ledger_changed_during_merge');
  const verified = await read(db, 'SELECT * FROM quo_call_attributions WHERE account_id=? AND quo_call_id=?',
    accountId, quoCallId);
  if (!sameIdentity(stage, verified) || verified.final_status !== stage.final_status
    || (stage.duration_seconds != null && verified.duration_seconds !== stage.duration_seconds)
    || (stage.answered_at && verified.answered_at !== stage.answered_at)
    || verified.source_event_id !== live.source_event_id
    || verified.call_started_at_original !== live.call_started_at_original
    || verified.jobber_request_id !== live.jobber_request_id
    || verified.jobber_client_id !== live.jobber_client_id
    || verified.google_upload_status !== live.google_upload_status
    || verified.consent_status !== live.consent_status) {
    return hold(db, stage, 'ledger_proof_failed');
  }
  const marked = await run(db, `UPDATE quo_call_capture_stage SET merged_at=?,hold_reason=NULL
    WHERE account_id=? AND quo_call_id=? AND updated_at=? AND merged_at IS NULL AND hold_reason IS NULL`,
    at,accountId,quoCallId,stage.updated_at);
  return marked === 1 ? { ok: true, merged: true } : { ok: false, reason: 'stage_changed_retry' };
}
