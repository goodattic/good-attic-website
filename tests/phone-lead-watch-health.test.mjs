import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneLeadWatchHealth} from '../server/phone-lead-watch-runtime.js';
function env(last,complete){return {PHONE_LEAD_WATCH_ENABLED:'true',ANGI_ROUTER_DB:{prepare(sql){assert.ok(sql.startsWith('SELECT '));return {async first(){return sql.includes('summary_json')?complete:last;}};}}};}
test('public watch health returns counts and times only, ignoring customer data in stored JSON',async()=>{
 const e=env({started_at:'2026-10-13T21:00:00Z',status:'completed',name:'PRIVATE_NAME'},
  {completed_at:'2026-10-13T21:01:00Z',summary_json:JSON.stringify({would_send:6,manual_review:17,pending:2,name:'PRIVATE_NAME',phone:'PRIVATE_PHONE',gclid:'PRIVATE_CLICK'})});
 const result=await phoneLeadWatchHealth(e);assert.equal(result.would_send_count,6);assert.equal(result.manual_review_count,17);assert.equal(result.pending_count,2);
 assert.equal(result.last_run_at,'2026-10-13T21:00:00Z');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 assert.deepEqual(Object.keys(result).sort(),['enabled','status','last_run_at','last_run_status','counts_as_of','would_send_count','manual_review_count','pending_count'].sort());
});
test('failed runs keep the last successful counts visibly dated; missing schema does not break health',async()=>{
 const e=env({started_at:'2026-10-14T00:00:00Z',status:'failed'}, {completed_at:'2026-10-13T21:01:00Z',summary_json:'{"would_send":5,"manual_review":17,"pending":2}'});
 const h=await phoneLeadWatchHealth(e);assert.equal(h.last_run_status,'failed');assert.equal(h.counts_as_of,'2026-10-13T21:01:00Z');assert.equal(h.would_send_count,5);
 assert.equal((await phoneLeadWatchHealth({})).status,'schema_unavailable');assert.equal((await phoneLeadWatchHealth(env(null,null))).status,'no_runs');
});
test('malformed or malicious health values cannot expose strings or masquerade as counts',async()=>{
 const h=await phoneLeadWatchHealth(env({started_at:'PRIVATE_DATE',status:'PRIVATE_STATUS'}, {completed_at:'PRIVATE_DATE',summary_json:'{"would_send":"PRIVATE_PHONE","manual_review":-1,"pending":1.5}'}));
 assert.equal(h.would_send_count,null);assert.equal(h.manual_review_count,null);assert.equal(h.pending_count,null);assert.doesNotMatch(JSON.stringify(h),/PRIVATE/);
});
