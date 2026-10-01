import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeChatQuota } from '../lib/chat-quota.mjs';
import { ChatQuotaIndex } from '../lib/chat-quota.mjs';
import { QuotaHistory } from '../lib/quota-history.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const start = Date.parse('2026-10-01T00:00:00Z'), reset = (start + 7 * 86400000) / 1000;
const current = used => ({bucketId:'codex', resetsAt:reset, at:start + 3600000, used});
const row = (minute, threadId, used, weight) => ({bucketId:'codex', resetsAt:reset, at:start + minute * 60000, threadId, used, weight, activeMs:minute * 60000});

test('18 percent is attributed as A 16 and B 2 instead of duplicated into both chats', () => {
  const result=attributeChatQuota([row(0,'A',0,0),row(10,'A',16,10),row(20,'B',18,5)],current(18));
  assert.equal(result.chats.A.used,16);assert.equal(result.chats.B.used,2);
  assert.equal(result.allocated,18);assert.equal(result.unclassified,0);
});
test('overlapping requests split a single observed increase without changing account totals', () => {
  const result=attributeChatQuota([row(0,'A',0,0),row(10,'A',0,8),row(11,'B',18,1)],current(18));
  assert.equal(result.chats.A.used,16);assert.equal(result.chats.B.used,2);
  assert.equal(result.allocated,18);
});
test('opening an idle chat cannot assign somebody else\'s usage to that chat', () => {
  const result=attributeChatQuota([row(0,'A',80,0),row(10,'B',82,2),row(20,'A',84,0)],current(84));
  assert.equal(result.chats.A.used,0);assert.equal(result.chats.A.hasRequests,false);
  assert.equal(result.chats.B.used,2);assert.equal(result.unclassified,82);
});
test('missing weights and copied fork history stay unclassified rather than double charged', () => {
  const first=row(10,'A',0,1),fork={...first,threadId:'fork'};
  const result=attributeChatQuota([row(0,'A',0,0),first,fork,row(11,'B',18,1)],current(18));
  assert.equal(result.allocated,0);assert.equal(result.unclassified,18);
  const missing=attributeChatQuota([row(0,'A',0,0),row(10,'A',0,null),row(11,'B',18,1)],current(18));
  assert.equal(missing.allocated,0);
});
test('previous weeks are not billed to the selected weekly cycle', () => {
  const previous={...row(10,'A',90,5),resetsAt:reset-7*86400};
  const result=attributeChatQuota([previous,row(0,'B',0,0),row(10,'B',2,1)],current(2));
  assert.equal(result.chats.A,undefined);assert.equal(result.chats.B.used,2);
});
test('the file index gives each selected chat its own percentage across repeated reads', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hud-chat-quota-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const a='11111111-2222-3333-4444-555555555555',b='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const context={type:'turn_context',timestamp:new Date(start).toISOString(),payload:{model:'gpt-6.1-sol',service_tier:'standard'}};
  const token=(minute,used,input)=>({type:'event_msg',timestamp:new Date(start+minute*60000).toISOString(),payload:{type:'token_count',rate_limits:{limit_id:'codex',secondary:{window_minutes:10080,used_percent:used,resets_at:reset}},info:{total_token_usage:{input_tokens:input,cached_input_tokens:0,output_tokens:0}}}});
  await fs.writeFile(path.join(root,`rollout-${a}.jsonl`),[context,token(0,0,0),token(10,16,100)].map(JSON.stringify).join('\n')+'\n');
  await fs.writeFile(path.join(root,`rollout-${b}.jsonl`),[context,token(20,18,100)].map(JSON.stringify).join('\n')+'\n');
  const index=new ChatQuotaIndex([root],new QuotaHistory());
  assert.equal((await index.read(a,current(18))).used,16);
  assert.equal((await index.read(b,current(18))).used,2);
  assert.equal((await index.read(a,current(18))).used,16);
});
