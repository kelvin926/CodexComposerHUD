import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createQuotaState, consumeQuotaRow, QuotaHistory } from '../lib/quota-history.mjs';
import '../ui/metrics.js';
const { cacheHit, quotaForecast, creditEstimate } = globalThis.__codexHUDMetrics;
const start = Date.parse('2026-10-01T01:00:00Z'), reset = (start + 7 * 86400000) / 1000;
function event(state, seconds, type, used, resetsAt = reset) {
  consumeQuotaRow(state, { type: 'event_msg', timestamp: new Date(start + seconds * 1000).toISOString(), payload: { type, rate_limits: used === undefined ? null : { limit_id: 'codex', primary: { window_minutes: 10080, used_percent: used, resets_at: resetsAt } } } });
}
test('cache ratio uses only input and never invents a zero for missing data', () => {
  assert.equal(cacheHit({input_tokens:100,cached_input_tokens:80,output_tokens:999}),80);
  assert.equal(cacheHit({input_tokens:100,cached_input_tokens:0}),0);
  assert.equal(cacheHit({input_tokens:0,cached_input_tokens:0}),null);
  assert.equal(cacheHit({input_tokens:10,cached_input_tokens:11}),null);
});
test('one second reset jitter preserves the session baseline and idle time is excluded', () => {
  const state=createQuotaState();event(state,0,'task_started');event(state,0,'token_count',84);event(state,1800,'task_complete');event(state,5400,'task_started');event(state,7200,'token_count',86,reset+1);
  const forecast=quotaForecast(state,{bucketId:'codex',used:86,remaining:14,resetsAt:reset},start+7200000);
  assert.equal(forecast.used,2);assert.equal(forecast.shareOfInitial,12.5);assert.equal(forecast.rate,2);assert.equal(forecast.remainingAfterHour,12);assert.equal(forecast.exhaustsAt,start+9*3600000);
});
test('unchanged coarse quotas have no exhaustion forecast', () => {
  const state=createQuotaState();event(state,0,'task_started');event(state,0,'token_count',84);event(state,3600,'token_count',84);
  const forecast=quotaForecast(state,{bucketId:'codex',used:84,remaining:16,resetsAt:reset},start+3600000);
  assert.equal(forecast.used,0);assert.equal(forecast.rate,null);assert.equal(forecast.reason,'insufficient-change');
});
test('new quota cycle resets the baseline and a reset before depletion is reported', () => {
  const state=createQuotaState();event(state,0,'task_started');event(state,0,'token_count',84);event(state,3600,'token_count',86);event(state,3601,'token_count',0);event(state,7201,'token_count',1);
  const forecast=quotaForecast(state,{bucketId:'codex',used:1,remaining:99,resetsAt:reset},start+7201000);
  assert.equal(forecast.used,1);assert.equal(forecast.restarted,true);
  assert.equal(quotaForecast(state,{bucketId:'codex',used:1,remaining:99,resetsAt:reset+86400}).reason,'cycle-changed');
  const slow=createQuotaState();event(slow,0,'task_started');event(slow,0,'token_count',0);event(slow,3600,'token_count',.1);
  assert.equal(quotaForecast(slow,{bucketId:'codex',used:.1,remaining:99.9,resetsAt:reset},start+3600000).resetsFirst,true);
});
test('history reader backfills a session and extends only complete JSONL records', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hud-quota-'));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});});
  const file=path.join(directory,'history.jsonl');const row=(second,used)=>JSON.stringify({type:'event_msg',timestamp:new Date(start+second*1000).toISOString(),payload:{type:'token_count',rate_limits:{limit_id:'codex',primary:{window_minutes:10080,used_percent:used,resets_at:reset}}}});
  await fs.writeFile(file,row(0,84)+'\n');const reader=new QuotaHistory();let history=await reader.read(file,await fs.stat(file));assert.equal(history.buckets.codex.points.length,1);
  const next=row(100,85);await fs.appendFile(file,next.slice(0,30));history=await reader.read(file,await fs.stat(file));assert.equal(history.buckets.codex.points.length,1);
  await fs.appendFile(file,next.slice(30)+'\n');history=await reader.read(file,await fs.stat(file));assert.equal(history.buckets.codex.points.length,2);
});
test('credit conversion uses Codex rates without API long-context or cache-write surcharges', () => {
  const usage={input_tokens:1000000,cached_input_tokens:800000,output_tokens:20000};
  assert.equal(creditEstimate('gpt-6.1-sol',usage),17);
  assert.equal(creditEstimate('gpt-6.1-sol',usage,'priority'),34);
});
test('credit totals deduplicate repeated counters and distinguish account balance debits', () => {
  const state=createQuotaState();consumeQuotaRow(state,{type:'turn_context',timestamp:new Date(start).toISOString(),payload:{model:'gpt-6.1-sol',service_tier:'priority'}});
  const record=(seconds,balance)=>({type:'event_msg',timestamp:new Date(start+seconds*1000).toISOString(),payload:{type:'token_count',rate_limits:{limit_id:'codex',primary:{window_minutes:10080,used_percent:84,resets_at:reset},credits:{balance:String(balance)}},info:{total_token_usage:{input_tokens:1000000,cached_input_tokens:800000,output_tokens:20000}}}});
  consumeQuotaRow(state,record(1,100));consumeQuotaRow(state,record(2,90));
  assert.equal(state.estimatedCredits,34);assert.equal(state.creditRecords,1);assert.equal(state.creditsDebited,10);
});
test('missing speed is a range instead of an assumed actual credit charge', () => {
  const state=createQuotaState();consumeQuotaRow(state,{type:'turn_context',timestamp:new Date(start).toISOString(),payload:{model:'gpt-6.1-sol'}});
  consumeQuotaRow(state,{type:'event_msg',timestamp:new Date(start+1000).toISOString(),payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000000,cached_input_tokens:800000,output_tokens:20000}}}});
  assert.equal(state.estimatedCredits,17);assert.equal(state.estimatedCreditsHigh,34);
});
