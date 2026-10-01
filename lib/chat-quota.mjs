import fs from 'node:fs/promises';
import path from 'node:path';

const WEEK = 7 * 86400000;
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

// Allocate observed account changes once across chats, never once per open view.
// Credit-equivalent request weights are a proxy, not the provider's quota formula.
export function attributeChatQuota(events, current) {
  if (!current || !Number.isFinite(current.resetsAt) || !Number.isFinite(current.used)) return null;
  const cutoff = current.resetsAt * 1000 - WEEK;
  const rows = events.filter(e => e.at >= cutoff && e.at <= current.at && e.bucketId === current.bucketId && Math.abs(e.resetsAt - current.resetsAt) <= 120)
    .sort((a, b) => a.at - b.at || String(a.threadId || '').localeCompare(String(b.threadId || '')));
  const chats = {}, pending = new Map();
  let previous = null, baseline = null, unclassified = 0, ambiguous = false;
  const seen = new Set();
  for (const row of rows) {
    const signature = `${row.at}:${row.used}:${row.resetsAt}:${row.weight}`;
    // Copied fork history cannot be counted as another request.
    if (seen.has(signature) && row.weight > 0) { ambiguous = true; continue; }
    seen.add(signature);
    if (row.threadId) {
      chats[row.threadId] ||= { used: 0, points: [], hasRequests: false };
      const chat = chats[row.threadId];
      if (!chat.points.length) chat.points.push({at: row.at, used: 0, activeMs: row.activeMs || 0, resetsAt: row.resetsAt});
      if (row.weight === null) ambiguous = true;
      if (row.weight > 0) { chat.hasRequests = true; pending.set(row.threadId, (pending.get(row.threadId) || 0) + row.weight); }
    }
    if (previous === null) { baseline = row.used; previous = row.used; pending.clear(); ambiguous = false; continue; }
    if (row.used < previous - .01) { pending.clear(); ambiguous = true; continue; }
    const increase = row.used - previous;
    if (increase > .000001) {
      const total = [...pending.values()].reduce((a, b) => a + b, 0);
      if (!ambiguous && total > 0) {
        for (const [id, weight] of pending) {
          const chat = chats[id]; chat.used += increase * weight / total;
          const last = chat.points.at(-1);
          const activeMs = id === row.threadId ? row.activeMs || last.activeMs : last.activeMs;
          chat.points.push({at: row.at, used: chat.used, activeMs, resetsAt: row.resetsAt});
        }
      } else unclassified += increase;
      previous = row.used; pending.clear(); ambiguous = false;
    }
    if (row.threadId) {
      const chat = chats[row.threadId], last = chat.points.at(-1);
      if (last.at !== row.at) chat.points.push({at: row.at, used: chat.used, activeMs: row.activeMs || last.activeMs, resetsAt: row.resetsAt});
    }
  }
  const allocated = Object.values(chats).reduce((sum, chat) => sum + chat.used, 0);
  return { chats, allocated, unclassified: Math.max(0, current.used - allocated), baseline, observedUnclassified: unclassified, approximate: true };
}

export class ChatQuotaIndex {
  constructor(roots, history) { this.roots = roots; this.history = history; history.limit = 512; this.updatedAt = 0; this.files = new Map(); }
  async discover(current) {
    const cutoff = current.resetsAt * 1000 - WEEK;
    const found = new Map();
    for (const root of this.roots) {
      let resolved;
      try { resolved = await fs.realpath(root); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const walk = async directory => {
        for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
          if (entry.isSymbolicLink()) continue;
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) { await walk(file); continue; }
          const match = entry.name.match(UUID);
          if (!entry.isFile() || !match) continue;
          const stat = await fs.stat(file);
          if (stat.mtimeMs < cutoff) continue;
          const actual = await fs.realpath(file), relative = path.relative(resolved, actual);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
          found.set(actual, {threadId: match[1], stat});
        }
      };
      await walk(resolved);
    }
    if (found.size > this.history.limit) throw new Error('Too many recent chat logs for a complete attribution');
    this.files = found;
  }
  async refresh(current) {
    if (this.busy) return this.busy;
    if (Date.now() - this.updatedAt < 15000 && Math.abs((this.cycle || 0) - current.resetsAt) <= 120) return;
    this.busy = (async () => {
      await this.discover(current);
      for (const [file, {stat}] of this.files) await this.history.read(file, stat);
      this.updatedAt = Date.now(); this.cycle = current.resetsAt;
    })();
    try { await this.busy; } finally { this.busy = null; }
  }
  async read(threadId, current, sourceLastModified = null) {
    if (!current) return null;
    await this.refresh(current);
    const events = [];
    for (const [file, {threadId: id}] of this.files) {
      for (const event of this.history.cache.get(file)?.usageObservations || []) events.push({...event, threadId: id});
    }
    // A live account refresh has no chat owner, and cannot invent request weights.
    events.push({...current, threadId: null, weight: 0});
    const result = attributeChatQuota(events, current), chat = result?.chats[threadId];
    const old = Number.isFinite(sourceLastModified) && sourceLastModified < current.resetsAt * 1000 - WEEK;
    return result ? {used: chat ? chat.used : old ? 0 : null, points: chat?.points || [], allocated: result.allocated, unclassified: result.unclassified, approximate: true, chats: Object.values(result.chats).filter(c => c.hasRequests).length} : null;
  }
}
