// Allowlist only: no provider bodies, query variables, customer data or secrets.
const messages=new Set(['alias_read_only','alias_external_redirect_blocked','alias_jobber_read_failed','alias_account_or_client_mismatch','alias_incomplete_history','alias_repeated_cursor','alias_invoice_time_missing','alias_object_time_missing','fetch failed','Failed to fetch','Network connection lost.','The operation was aborted due to timeout','The operation was aborted.','This operation was aborted','Too many subrequests.']);
const classes=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','DOMException']);
const steps=new Set(['jobber_candidates','jobber_history','jobber_identity','read_evidence','resolve_alias','persist_resolution']);
const tables=new Set(['quo_intake_operations','closed_loop_lead_dispositions','closed_loop_stage1_objects','qualified_phone_alias_resolutions']);
export function qualifiedAliasFailure(error,context={}) {
 return {step:steps.has(context.step)?context.step:'unknown',error_class:classes.has(error?.name)?error.name:'Error',
  error_message:messages.has(error?.message)?error.message:'Unrecognized error message withheld (customer-data protection)',
  api:['jobber','d1'].includes(context.api)?context.api:null,table:tables.has(context.table)?context.table:null,
  http_status:Number.isInteger(context.http_status)&&context.http_status>=100&&context.http_status<=599?context.http_status:null,
  completed_at:new Date().toISOString()};
}
