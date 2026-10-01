import test from 'node:test';
import assert from 'node:assert/strict';
import '../ui/metrics.js';
const {costRange, sessionCostRange, compactRemaining, canCompact}=globalThis.__codexHUDMetrics;
test('cache and reasoning subsets are not double charged',()=>{
  const result=costRange('gpt-6.1-sol',{input_tokens:1000000/10,cached_input_tokens:80000,output_tokens:1000,reasoning_output_tokens:900});
  assert.equal(result.low,0.058); assert.equal(result.high,0.068);
});
test('long requests use the full-request pricing tier, unknown models stay unavailable',()=>{
  const result=costRange('gpt-6.1-sol',{input_tokens:300000,cached_input_tokens:200000,output_tokens:1000});
  assert.equal(result.low,0.455);assert.equal(result.high,0.555);assert.equal(costRange('unknown',{input_tokens:1,cached_input_tokens:0,output_tokens:1}),null);
});
test('compaction estimate uses the configured total threshold and guards active work',()=>{
  assert.equal(compactRemaining({compactLimit:740000,scope:'total'},{last:{total_tokens:250000}}),490000);
  assert.equal(compactRemaining({compactLimit:740000,scope:'body_after_prefix'},{last:{total_tokens:250000}}),null);
  assert.equal(canCompact({threadId:'a'},{startedAt:'now'}),false);assert.equal(canCompact({threadId:'a'},{compacting:true}),false);assert.equal(canCompact({threadId:'a'},{}),true);
  assert.equal(canCompact({threadId:'a'},{active:true}),false);
});
test('session totals are bounded rather than priced as a single long request',()=>{
  const estimate=sessionCostRange('gpt-6.1-sol',{input_tokens:1000000,cached_input_tokens:800000,output_tokens:20000});
  assert.equal(estimate.low,0.68);assert.equal(estimate.high,1.46);
});
