import fs from 'node:fs/promises';
import path from 'node:path';
import { QuotaHistory } from './quota-history.mjs';
import { ChatQuotaIndex } from './chat-quota.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK = 1024 * 1024;
export function normalizeUsage(info) {
  if (!info) return null;
  const read = source => Object.fromEntries(['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'].map(key => [key, Number.isFinite(source?.[key]) ? source[key] : null]));
  return { last: read(info.last_token_usage), total: read(info.total_token_usage), modelContextWindow: Number.isFinite(info.model_context_window) ? info.model_context_window : null };
}
export function consumeRows(state, text) {
  for (const line of text.split('\n')) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.type !== 'event_msg') continue;
    const event = row.payload;
    if (event?.type === 'token_count' && event.info) { state.usage = normalizeUsage(event.info); state.updatedAt = row.timestamp; }
    if (event?.type === 'task_started') { state.startedAt = row.timestamp; state.activityAt = row.timestamp; }
    if (['task_complete', 'turn_aborted'].includes(event?.type)) { state.startedAt = null; state.activityAt = row.timestamp; }
  }
  return state;
}
export class SessionReader {
  constructor(codexHome) {
    this.roots = ['sessions', 'archived_sessions'].map(name => path.resolve(codexHome, name));
    this.cache = new Map();
    this.quotaHistory = new QuotaHistory();
    this.chatQuotaIndex = new ChatQuotaIndex(this.roots, this.quotaHistory);
  }
  async validate(file, threadId) {
    if (!UUID.test(threadId) || !file || !path.isAbsolute(file)) throw new Error('Invalid session reference');
    const actual = await fs.realpath(file);
    if (!path.basename(actual).toLowerCase().endsWith(`${threadId.toLowerCase()}.jsonl`)) throw new Error('Session ID mismatch');
    let allowed = false;
    for (const root of this.roots) {
      let resolved; try { resolved = await fs.realpath(root); } catch { continue; }
      const relative = path.relative(resolved, actual);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) allowed = true;
    }
    if (!allowed) throw new Error('Session is outside the Codex log directories');
    return actual;
  }
  async read({ path: file, threadId, hostId = 'local', quota = null }) {
    if (hostId !== 'local') return { threadId, hostId, error: '원격 채팅은 새 토큰 이벤트를 기다립니다.' };
    try {
      const actual = await this.validate(file, threadId);
      const stat = await fs.stat(actual);
      let state = this.cache.get(actual);
      if (!state || stat.size < state.offset || (stat.size === state.offset && stat.mtimeMs !== state.mtimeMs)) {
        state = { offset: 0, usage: null, updatedAt: null, startedAt: null, carry: Buffer.alloc(0) };
        const handle = await fs.open(actual, 'r');
        try {
          // Read backwards only until the newest token record is found. Never scan all chats.
          let start = stat.size; let bytes = Buffer.alloc(0);
          while (start > 0 && bytes.length < 32 * BLOCK) {
            const length = Math.min(BLOCK, start); start -= length;
            const chunk = Buffer.alloc(length); await handle.read(chunk, 0, length, start);
            bytes = Buffer.concat([chunk, bytes]);
            const first = start ? bytes.indexOf(10) + 1 : 0;
            const last = bytes.lastIndexOf(10);
            const candidate = { usage: null, updatedAt: null, startedAt: null };
            if (last >= first) consumeRows(candidate, bytes.subarray(first, last).toString('utf8'));
            if ((candidate.usage && candidate.activityAt) || start === 0 || bytes.length >= 32 * BLOCK) {
              Object.assign(state, candidate);
              state.carry = bytes.subarray(last + 1); break;
            }
          }
          state.offset = stat.size;
        } finally { await handle.close(); }
      } else if (stat.size > state.offset) {
        const handle = await fs.open(actual, 'r');
        try {
          while (state.offset < stat.size) {
            const length = Math.min(BLOCK, stat.size - state.offset);
            const chunk = Buffer.alloc(length); const { bytesRead } = await handle.read(chunk, 0, length, state.offset);
            if (!bytesRead) break;
            state.offset += bytesRead;
            const bytes = Buffer.concat([state.carry, chunk.subarray(0, bytesRead)]);
            const last = bytes.lastIndexOf(10);
            if (last >= 0) consumeRows(state, bytes.subarray(0, last).toString('utf8'));
            state.carry = bytes.subarray(last + 1);
          }
        } finally { await handle.close(); }
      }
      state.mtimeMs = stat.mtimeMs; this.cache.set(actual, state);
      if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
      let quotaHistory, quotaHistoryError;
      try { quotaHistory = await this.quotaHistory.read(actual, stat, quota); }
      catch { quotaHistoryError = '세션 한도 기록을 읽을 수 없습니다.'; }
      let chatQuota, chatQuotaError;
      try { chatQuota = await this.chatQuotaIndex.read(threadId, quota, stat.mtimeMs); }
      catch { chatQuotaError = '채팅별 한도 기록을 확인할 수 없습니다.'; }
      return { threadId, hostId, usage: state.usage, updatedAt: state.updatedAt, startedAt: state.startedAt, activityAt: state.activityAt, quotaHistory, quotaHistoryError, chatQuota, chatQuotaError, error: state.usage ? null : '아직 기록된 토큰 사용량이 없습니다.' };
    } catch (error) {
      return { threadId, hostId, error: error.code === 'ENOENT' ? '로컬 세션 기록을 찾을 수 없습니다.' : '세션 기록을 읽을 수 없습니다.' };
    }
  }
}
