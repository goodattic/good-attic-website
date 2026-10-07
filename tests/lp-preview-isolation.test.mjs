import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../preview/worker.js';
test('preview refuses every API request while locked, without storage or external access',async()=>{
 for(const path of ['/api/leads','/api/leads/conversion-signal','/api/jobber/quo-intake']) {
 const result=await worker.fetch(new Request('https://preview.invalid'+path,{method:'POST',body:'{}'}),{PREVIEW_SUBMISSIONS_ENABLED:'false'},{});
 assert.equal(result.status,403);
 }
});
test('preview requires test authorization even when enabled',async()=>{
 assert.equal((await worker.fetch(new Request('https://preview.invalid/api/leads',{method:'POST',body:'{}'}),{PREVIEW_SUBMISSIONS_ENABLED:'true'},{})).status,403);
});
