import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionReader, normalizeUsage } from '../lib/sessions.mjs';
import { CDP } from '../lib/cdp.mjs';

const id = '11111111-2222-3333-4444-555555555555';
const row = (input = 1234) => JSON.stringify({ type: 'event_msg', timestamp: '2026-10-01T12:00:00Z', payload: { type: 'token_count', info: { model_context_window: 828400, last_token_usage: { input_tokens: input, output_tokens: 200, cached_input_tokens: 100, reasoning_output_tokens: 50, total_tokens: input + 200 }, total_token_usage: { total_tokens: 900000 } } } });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-hud-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'sessions'); await fs.mkdir(dir);
  const file = path.join(dir, `rollout-${id}.jsonl`);
  return { root, file, reader: new SessionReader(root) };
}
test('context uses current input and preserves actual model limit', () => {
  const info = JSON.parse(row()).payload.info; const usage = normalizeUsage(info);
  assert.equal(usage.last.input_tokens, 1234); assert.equal(usage.modelContextWindow, 828400);
  assert.equal(usage.total.total_tokens, 900000); assert.equal(normalizeUsage({}).last.input_tokens, null);
});
test('reads incrementally and ignores a partial UTF-8 JSONL row until complete', async t => {
  const { file, reader } = await fixture(t); await fs.writeFile(file, row() + '\n');
  assert.equal((await reader.read({ path: file, threadId: id })).usage.last.input_tokens, 1234);
  const korean = JSON.stringify({ type: 'response_item', payload: { text: '한글 테스트' } });
  await fs.appendFile(file, korean + '\n' + row(4567).slice(0, 100));
  assert.equal((await reader.read({ path: file, threadId: id })).usage.last.input_tokens, 1234);
  await fs.appendFile(file, row(4567).slice(100) + '\n');
  assert.equal((await reader.read({ path: file, threadId: id })).usage.last.input_tokens, 4567);
});
test('rejects reads outside session roots and an ID mismatch', async t => {
  const { root, file, reader } = await fixture(t); const outside = path.join(root, `outside-${id}.jsonl`);
  await fs.writeFile(outside, row() + '\n'); await fs.writeFile(file, row() + '\n');
  assert.ok((await reader.read({ path: outside, threadId: id })).error);
  assert.ok((await reader.read({ path: file, threadId: 'aaaaaaaa-2222-3333-4444-555555555555' })).error);
});
test('reset after truncation and keep missing records visible', async t => {
  const { file, reader } = await fixture(t); await fs.writeFile(file, row() + '\n'); await reader.read({ path: file, threadId: id });
  await fs.writeFile(file, '{}\n'); const snapshot = await reader.read({ path: file, threadId: id });
  assert.equal(snapshot.usage, null); assert.ok(snapshot.error);
  assert.ok((await reader.read({ path: file, threadId: id, hostId: 'remote-ssh:example' })).error);
});
test('CDP cannot connect to a remote debugging server', () => {
  assert.throws(() => new CDP('ws://example.com:9222/devtools/page/a'), /loopback/);
});
test('reads back to an active turn start before enabling context compaction', async t => {
  const { file, reader } = await fixture(t);
  await fs.writeFile(file, JSON.stringify({type:'event_msg',timestamp:'2026-10-01T11:00:00Z',payload:{type:'task_started'}})+'\n'+JSON.stringify({type:'response_item',payload:{text:'x'.repeat(1100000)}})+'\n'+row()+'\n');
  assert.equal((await reader.read({path:file,threadId:id})).startedAt,'2026-10-01T11:00:00Z');
});
