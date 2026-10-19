// Never persist provider bodies, URLs, query variables, customer text or secrets.
const messages=new Set(['reader_external_redirect_blocked','quo_calls_read_failed','quo_transcript_read_failed','scope_read_only','scope_jobber_read_failed','scope_quo_key_missing','scope_quo_read_failed','scope_call_id_invalid','scope_intake_incomplete','scope_object_type_invalid','scope_account_mismatch','scope_client_mismatch','scope_items_incomplete','scope_items_cursor_invalid','scope_account_or_client_mismatch','scope_catalog_incomplete','scope_catalog_cursor_invalid','scope_record_disappeared','fetch failed','Failed to fetch','Network connection lost.','The operation was aborted due to timeout','The operation was aborted.','This operation was aborted','Too many subrequests.']);
const classes=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','DOMException']);
const steps=new Set(['quo_calls','quo_transcript','scope_inquiry','scope_quo_summary','scope_quo_transcript','scope_jobber_work','scope_read_history','scope_persist_history','scope_decision']);
export function qualifiedReaderFailure(error,context={}) {
 const failure={step:steps.has(context.step)?context.step:'unknown',error_class:classes.has(error?.name)?error.name:'Error',
  error_message:messages.has(error?.message)?error.message:'Unrecognized error message withheld (customer-data protection)',
  api:['quo','jobber','d1'].includes(context.api)?context.api:null,table:context.table==='qualified_phone_scope_work'?context.table:null,
  http_status:Number.isInteger(context.http_status)&&context.http_status>=100&&context.http_status<=599?context.http_status:null,completed_at:new Date().toISOString()};
 console.error(JSON.stringify({qualified_phone_reader_failure:failure}));return failure;
}
