// Reviewed, permanent event-level refusals. This is a local build guard, not a
// write to the live uploader ledger. A missing/error-only remote row must not
// make this event eligible again. Never invoke validation to recheck it.
export const WATCH_KNOWN_REFUSALS = Object.freeze([
  Object.freeze({event_id:'gae-slc-sold-67153691',status:'permanently_failed',
    error_category:'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY',
    evidence_date:'2026-10-13',evidence_kind:'validate_only',
    evidence_source:'Owner-confirmed Oct 13 Google validate-only response; requested permanent exclusion Oct 14'}),
]);
