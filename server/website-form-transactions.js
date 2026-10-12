const MARKETS = new Set(["ut", "mo_stl", "mo_kc", "general"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validSubmissionId(value) {
  return typeof value === "string" && UUID.test(value);
}

export async function reserveFormTransaction(database, submissionId, marketKey) {
  if (!database?.prepare || !validSubmissionId(submissionId) || !MARKETS.has(marketKey)) {
    throw new Error("form_transaction_unavailable");
  }
  const at = new Date().toISOString();
  const insert = await database.prepare(`
    INSERT OR IGNORE INTO website_form_conversions
      (submission_id, transaction_id, market_key, state, conversion_state, created_at, updated_at)
    VALUES (?, ?, ?, 'processing', 'not_confirmed', ?, ?)
  `).bind(submissionId, submissionId, marketKey, at, at).run();
  const row = await database.prepare(
    "SELECT * FROM website_form_conversions WHERE submission_id = ?"
  ).bind(submissionId).first();
  if (!row || row.transaction_id !== submissionId || row.market_key !== marketKey) {
    throw new Error("form_transaction_conflict");
  }
  return { ...row, claimed: Number(insert?.meta?.changes ?? insert?.changes ?? 0) === 1 };
}

export async function completeFormTransaction(database, submissionId, jobber) {
  if (!database?.prepare || !validSubmissionId(submissionId) || !jobber?.request_id || !jobber?.client_id) {
    throw new Error("form_transaction_incomplete");
  }
  const at = new Date().toISOString();
  const result = await database.prepare(`
    UPDATE website_form_conversions
    SET state = 'completed', jobber_request_id = ?, jobber_client_id = ?,
        jobber_account_id = ?, conversion_at = ?, updated_at = ?
    WHERE submission_id = ? AND state = 'processing' AND jobber_request_id IS NULL
  `).bind(jobber.request_id, jobber.client_id, jobber.account_id || null, at, at, submissionId).run();
  if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) {
    throw new Error("form_transaction_completion_uncertain");
  }
  return await database.prepare(
    "SELECT * FROM website_form_conversions WHERE submission_id = ?"
  ).bind(submissionId).first();
}

export async function releaseUnstartedFormTransaction(database, submissionId) {
  if (!database?.prepare || !validSubmissionId(submissionId)) return false;
  const result = await database.prepare(`
    DELETE FROM website_form_conversions
    WHERE submission_id = ? AND state = 'processing'
      AND reconciliation_required = 0
      AND jobber_request_id IS NULL AND jobber_client_id IS NULL
  `).bind(submissionId).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) === 1;
}

export async function flagFormTransactionForReconciliation(database, submissionId, reason) {
  if (!database?.prepare || !validSubmissionId(submissionId) || !reason) return false;
  const result = await database.prepare(`
    UPDATE website_form_conversions
    SET reconciliation_required = 1,
        reconciliation_reason = COALESCE(reconciliation_reason, ?),
        reconciliation_retry_count = reconciliation_retry_count + 1,
        updated_at = ?
    WHERE submission_id = ?
  `).bind(reason, new Date().toISOString(), submissionId).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) === 1;
}

export async function recordFormReconciliationAttempt(database, { attemptId, submissionId, marketKey, reason, jobber }) {
  if (!database?.prepare || !validSubmissionId(attemptId) || !validSubmissionId(submissionId)
    || !MARKETS.has(marketKey) || !reason || !jobber?.request_id) {
    throw new Error("form_reconciliation_attempt_invalid");
  }
  const result = await database.prepare(`
    INSERT OR IGNORE INTO website_form_reconciliation_attempts
      (attempt_id, submission_id, market_key, reason, jobber_account_id,
       jobber_request_id, jobber_client_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    attemptId, submissionId, marketKey, reason, jobber.account_id || null,
    jobber.request_id, jobber.client_id || null, new Date().toISOString(),
  ).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) === 1;
}

export async function markFormDeliveryUncertain(database, submissionId, jobber = null) {
  if (!database?.prepare || !validSubmissionId(submissionId)) return false;
  const result = await database.prepare(`
    UPDATE website_form_conversions
    SET state = 'delivery_uncertain',
        jobber_request_id = COALESCE(jobber_request_id, ?),
        jobber_client_id = COALESCE(jobber_client_id, ?),
        jobber_account_id = COALESCE(jobber_account_id, ?),
        updated_at = ?
    WHERE submission_id = ? AND state = 'processing'
  `).bind(
    jobber?.request_id || null,
    jobber?.client_id || null,
    jobber?.account_id || null,
    new Date().toISOString(),
    submissionId,
  ).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) === 1;
}

export async function markFormConversionSignaled(database, submissionId, transactionId) {
  if (!database?.prepare || !validSubmissionId(submissionId) || submissionId !== transactionId) return false;
  const result = await database.prepare(`
    UPDATE website_form_conversions
    SET conversion_state = 'client_signaled', updated_at = ?
    WHERE submission_id = ? AND transaction_id = ?
      AND state IN ('processing', 'completed', 'delivery_uncertain')
  `).bind(new Date().toISOString(), submissionId, transactionId).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) === 1;
}
