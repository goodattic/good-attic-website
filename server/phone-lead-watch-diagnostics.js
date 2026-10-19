// Watch-only diagnostics. Never persist provider response bodies, SQL values,
// URLs, arbitrary exception messages, credentials or customer content.
const CODES = new Set(`watch_external_write_blocked watch_jobber_auth_unavailable watch_jobber_read_failed watch_quo_read_failed watch_account_mismatch watch_clients_incomplete watch_client_cursor_invalid watch_contacts_incomplete watch_contact_cursor_invalid watch_client_disappeared watch_history_incomplete watch_history_cursor_invalid scope_record_disappeared scope_intake_incomplete scope_object_type_invalid scope_account_mismatch scope_client_mismatch scope_items_incomplete scope_items_cursor_invalid scope_account_or_client_mismatch scope_catalog_incomplete scope_catalog_cursor_invalid alias_account_or_client_mismatch alias_incomplete_history alias_repeated_cursor alias_invoice_time_missing alias_object_time_missing ADS_REFRESH_TOKEN_MISSING ADS_TOKEN_REFRESH_FAILED GOOGLE_CALL_READ_INVALID invalid_timestamp invalid_google_call_time`.split(' '));
const NATIVE_MESSAGES = new Set([
  'Invalid redirect value, must be one of "follow" or "manual" ("error" won\'t be implemented since it does not make sense at the edge; use "manual" and check the response status code).',
  'Too many subrequests.', 'Too many subrequests', 'Too many API requests by single worker invocation.',
  'The operation was aborted due to timeout', 'The operation was aborted.', 'This operation was aborted',
  'fetch failed', 'Network connection lost.', 'Internal error', 'Failed to fetch',
  'D1_ERROR: too many SQL variables: SQLITE_ERROR', 'D1_ERROR: database is locked: SQLITE_BUSY',
]);
const CLASSES = new Set(['Error','TypeError','SyntaxError','RangeError','ReferenceError','DOMException','AbortError','TimeoutError']);
const APIS = new Set(['google_oauth','google_ads','jobber','quo','d1']);
const TABLES = new Set(`angi_router_jobber_auth phone_lead_watch_runs phone_lead_watch_sources phone_lead_watch_results quo_call_attributions quo_call_capture_stage closed_loop_stage1_objects closed_loop_stage1_leads closed_loop_leads quo_intake_operations closed_loop_lead_dispositions closed_loop_google_uploads google_ads_outcome_outbox qualified_phone_calls call_request_lineage`.split(' '));
export function watchFailure(error, context = {}) {
  if (error?.watchDiagnostic) return error;
  const raw = String(error?.message || ''), inner = String(error?.cause?.message || '');
  const safeMessage = value => CODES.has(value) || value==='watch_external_redirect_blocked' || NATIVE_MESSAGES.has(value) || /^GOOGLE_CALL_READ_HTTP_[1-5]\d\d$/.test(value)
    ? value : 'Unrecognized error message withheld (customer-data protection)';
  const diagnostic = {
    step: /^[a-z_\.]{1,80}$/.test(context.step || '') ? context.step : 'unknown',
    error_class: CLASSES.has(error?.name) ? error.name : 'Error',
    error_message: safeMessage(raw),
    api: APIS.has(context.api) ? context.api : null,
    table: TABLES.has(context.table) ? context.table : null,
    http_status: Number.isInteger(context.http_status??error?.watchHttpStatus) && (context.http_status??error.watchHttpStatus) >= 100 && (context.http_status??error.watchHttpStatus) <= 599 ? (context.http_status??error.watchHttpStatus) : null,
    ...(inner ? {cause_message:safeMessage(inner)} : {}),
  };
  const wrapped = new Error(diagnostic.error_message);
  wrapped.watchDiagnostic = diagnostic;
  return wrapped;
}
export async function watchStep(context, fn) {
  try { return await fn(); } catch(error) { throw watchFailure(error, context); }
}
export function watchTable(sql) { return sql.match(/\b(?:FROM|INTO|UPDATE)\s+(\w+)/i)?.[1]; }
export function watchApi(url) {
  const u = new URL(url);
  return ({'oauth2.googleapis.com':'google_oauth','googleads.googleapis.com':'google_ads','api.getjobber.com':'jobber','api.quo.com':'quo'})[u.hostname];
}
