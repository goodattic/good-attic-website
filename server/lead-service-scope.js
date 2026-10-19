// Shared by watch matching and the independently gated qualified-call screen.
// Inspect text in memory; return only service codes and evidence references.
export const SERVICE_SCOPE_POLICY = 'attic_scope_v2';
const offPatterns = {
  spray_foam:/\bspray(?:ed|ing)?[ -]*(?:foam|insulation)|\b(?:open|closed)[ -]cell\b/i,
  attic_fan:/\b(?:attic|whole[ -]house) fans?\b/i,
  ventilation:/\bventilation\b|\bventing\b|\b(?:roof|ridge|soffit|attic) vents?\b/i,
  mold:/\bmou?ld\b/i,
  wall_insulation:/\bwall insulation\b|\bbasement walls?\b|\binsulat\w*\b[^.!?\n]{0,35}\bwalls?\b|\bwalls?\b[^.!?\n]{0,35}\binsulat\w*\b/i,
};
const inPatterns = {
  attic_insulation:/\battic\b[^.!?\n]{0,45}\binsulat\w*\b|\binsulat\w*\b[^.!?\n]{0,45}\battic\b|\bblow(?:n)?[ -]in\b|\bcellulose\b|\bfiber[ -]?glass\b/i,
  insulation_removal_replacement:/\binsulation (?:remov\w*|replac\w*)\b|\b(?:remov\w*|replac\w*|vacuum\w*)\b[^.!?\n]{0,45}\binsulation\b/i,
  attic_restoration_sanitation:/\battic\b[^.!?\n]{0,45}\b(?:restor\w*|sanit\w*|clean\w*)\b|\b(?:restor\w*|sanit\w*|clean\w*)\b[^.!?\n]{0,45}\battic\b/i,
  air_sealing:/\bair[ -]seal\w*\b/i,
  baffles:/\bbaffles?\b/i,
};
const uniq = values => [...new Set(values.filter(Boolean))];
export function serviceScopeFromText(value, ref=null, {record=false}={}) {
  const text=String(value||'').replace(/\bgood\s*attic(?:\s+insulation)?\b/gi,'');
  const requested=text.replace(/\b(?:not|don't|do not|no)\b[^.!?\n]{0,20}\bspray[ -]foam\b/gi,'');
  const off=Object.entries(offPatterns).filter(([,r])=>r.test(requested)).map(([k])=>k);
  const included=new Set();
  // Separate services keep an add-on from vetoing attic work. Spray foam
  // insulation in an attic remains off-scope unless other attic work exists.
  for(const segment of text.split(/[.!?\n]|\b(?:and|plus|also|as well as)\b/i)) {
    const foam=offPatterns.spray_foam.test(segment),walls=offPatterns.wall_insulation.test(segment);
    const negated=/\b(?:no|not|don't|do not|without)\b[^.!?\n]{0,40}(?:attic|insulat|restor|sanit|seal|baffle)/i.test(segment);
    if(negated)continue;
    for(const [code,re] of Object.entries(inPatterns)) {
      if((foam||walls)&&['attic_insulation','insulation_removal_replacement'].includes(code))continue;
      if(re.test(segment))included.add(code);
    }
  }
  if(included.size && /\b(?:rodent|pest)\b[^.!?\n]{0,35}\b(?:exclu\w*|proof\w*|seal\w*)\b/i.test(text))included.add('pest_exclusion_with_attic_work');
  const usable=included.size>0||off.length>0||/\b(?:insulat\w*|attic|estimate|quote|bid|clean\w*|restor\w*|rodent|pest|wrong number|vendor)\b/i.test(text);
  return {policy:SERVICE_SCOPE_POLICY,state:included.size?'in_scope':off.length?'off_scope_only':usable||record?'not_excluded':'unknown',
    in_scope_evidence:included.size>0,in_scope_services:[...included],off_scope_services:off,
    usable_inquiry:usable,has_work_record:record,evidence_refs:ref?[ref]:[]};
}
export function combineServiceScopes(...scopes) {
  const all=scopes.filter(Boolean),inside=all.some(s=>s.in_scope_evidence),off=uniq(all.flatMap(s=>s.off_scope_services||[]));
  const usable=all.some(s=>s.usable_inquiry),work=all.some(s=>s.has_work_record);
  return {policy:SERVICE_SCOPE_POLICY,state:inside?'in_scope':off.length?'off_scope_only':usable||work?'not_excluded':'unknown',
    in_scope_evidence:inside,in_scope_services:uniq(all.flatMap(s=>s.in_scope_services||[])),off_scope_services:off,
    usable_inquiry:usable,has_work_record:work,evidence_refs:uniq(all.flatMap(s=>s.evidence_refs||[]))};
}
export function scopeForPerson(inquiry, workScopes=[]) {
  // Same-person, same-market quoted/sold attic work is positive evidence.
  // An unspecific quote proves a record exists, not that attic work was quoted.
  const combined=combineServiceScopes(inquiry,...workScopes);
  if(!combined.in_scope_evidence)combined.state=inquiry?.off_scope_services?.length?'off_scope_only':
    combined.usable_inquiry||combined.has_work_record?'not_excluded':'unknown';
  return combined;
}
export function scopeAllowsCredit(scope) {return ['in_scope','not_excluded'].includes(scope?.state);}
