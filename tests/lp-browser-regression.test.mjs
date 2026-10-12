import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
// Run scripts/serve-lp-browser-tests.mjs and open its URL in a real browser first.
// Stale browser evidence fails this gate whenever the built pages/script change.
const evidence=JSON.parse(fs.readFileSync(new URL('../release-evidence/lp-browser-results.json',import.meta.url)));
test('browser regression evidence belongs to this exact built candidate',()=>{
 assert.equal(evidence.results.length,7);
 for(const [file,hash] of Object.entries(evidence.fingerprint))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),hash,file+' changed: rerun browser harness');
 assert.equal(evidence.fingerprint['dist/script.e0b6cf2323b054a8.js'],'e0b6cf2323b054a829fabc791fa4ae35c634461c7a2655fa0d303663a0659726');
});
const paths=['salt-lake-city-ut','st-louis-mo','kansas-city-mo'].flatMap(m=>['attic-insulation','insulation-removal'].map(s=>`/${m}/lp/${s}/`));paths.push('/salt-lake-city-ut/lp/attic-insulation/?utm_location=1026920');
for(const path of paths)test('complete real-browser flow: '+path,()=>{
 const result=evidence.results.find(r=>r.path===path);assert.ok(result,'missing real-browser case');assert.equal(result.pass,true,result.failure);assert.deepEqual(result.errors,[]);assert.equal(result.requests.length,1);assert.equal(result.signals.length,1);assert.equal(result.requests[0].submission_id,result.signals[0].transaction_id);
});
