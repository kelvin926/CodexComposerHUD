import fs from 'node:fs/promises';
import '../ui/metrics.js';

const BLOCK = 1024 * 1024;
export function weeklyFromLog(rates) {
  const window = [rates?.primary, rates?.secondary].find(value => value?.window_minutes === 10080);
  if (!window || !Number.isFinite(window.used_percent) || window.used_percent < 0 || window.used_percent > 100 || !Number.isFinite(window.resets_at)) return null;
  const rawBalance = rates.credits?.balance;
  const creditsBalance = rawBalance !== null && rawBalance !== undefined && rawBalance !== '' && Number.isFinite(Number(rawBalance)) ? Number(rawBalance) : null;
  return { bucketId: rates.limit_id || 'codex', used: window.used_percent, resetsAt: window.resets_at, creditsBalance };
}
function activeAt(state, at) {
  return state.completedMs + (state.activeStart === null ? 0 : Math.max(0, at - state.activeStart));
}
function observe(state, sample) {
  if (!sample || !Number.isFinite(sample.at) || !Number.isFinite(sample.used) || sample.used < 0 || sample.used > 100 || !Number.isFinite(sample.resetsAt)) return;
  const id = sample.bucketId || 'codex';
  let bucket = state.buckets[id];
  const last = bucket?.points.at(-1);
  if (last && sample.at <= last.at) return;
  if (Number.isFinite(sample.creditsBalance) && sample.creditsBalance >= 0 && sample.at > state.creditsBalanceAt) {
    if (state.firstCreditsBalance === null) state.firstCreditsBalance = sample.creditsBalance;
    if (state.lastCreditsBalance !== null) state.creditsDebited += Math.max(0, state.lastCreditsBalance - sample.creditsBalance);
    state.lastCreditsBalance = sample.creditsBalance; state.creditsBalanceAt = sample.at;
  }
  // The service's reset timestamp can vary by a second without starting a new week.
  if (!bucket || (last && (Math.abs(sample.resetsAt - last.resetsAt) > 120 || sample.used < last.used - 0.01))) {
    bucket = { points: [], restarted: Boolean(bucket) }; state.buckets[id] = bucket;
  }
  bucket.points.push({ at: sample.at, used: sample.used, resetsAt: sample.resetsAt, activeMs: activeAt(state, sample.at) });
  if (bucket.points.length > 1024) bucket.points.splice(1, bucket.points.length - 1024);
}
export function consumeQuotaRow(state, row) {
  const at = Date.parse(row.timestamp);
  if (!Number.isFinite(at)) return;
  if (row.type === 'session_meta') { state.createdAt = at; return; }
  if (row.type === 'turn_context') { state.model = row.payload?.model || null; state.tier = row.payload?.service_tier || 'standard'; state.currentTierUnknown = !row.payload?.service_tier; if (state.currentTierUnknown) state.unknownTier = true; return; }
  if (row.type !== 'event_msg') return;
  const event = row.payload;
  if (event?.type === 'task_started') {
    if (state.activeStart !== null) state.completedMs += Math.max(0, at - state.activeStart);
    state.activeStart = at;
  }
  if (['task_complete', 'turn_aborted'].includes(event?.type)) {
    if (state.activeStart !== null) state.completedMs += Math.max(0, at - state.activeStart);
    state.activeStart = null;
  }
  if (event?.type === 'token_count') {
    observe(state, { ...weeklyFromLog(event.rate_limits), at });
    const total = event.info?.total_token_usage;
    if (total && ['input_tokens', 'cached_input_tokens', 'output_tokens'].every(name => Number.isFinite(total[name]))) {
      let delta = Object.fromEntries(['input_tokens', 'cached_input_tokens', 'output_tokens'].map(name => [name, total[name] - (state.previousTotal?.[name] || 0)]));
      if (Object.values(delta).some(value => value < 0)) delta = event.info?.last_token_usage || {};
      if (Object.values(delta).some(value => value > 0)) {
        const estimate = globalThis.__codexHUDMetrics.creditEstimate(state.model, delta, state.tier);
        if (estimate === null) state.missingCreditRecords++;
        else { state.estimatedCredits += estimate; state.estimatedCreditsHigh += state.currentTierUnknown ? estimate * (state.model === 'gpt-6-astra' ? 6 : 2) : estimate; state.creditRecords++; }
      }
      state.previousTotal = total;
    }
  }
}
export function createQuotaState() {
  return { offset: 0, carry: Buffer.alloc(0), createdAt: null, completedMs: 0, activeStart: null, buckets: {}, busy: null, mtimeMs: null, model: null, tier: 'standard', previousTotal: null, estimatedCredits: 0, estimatedCreditsHigh: 0, creditRecords: 0, missingCreditRecords: 0, unknownTier: false, currentTierUnknown: false, firstCreditsBalance: null, lastCreditsBalance: null, creditsDebited: 0, creditsBalanceAt: 0 };
}
export class QuotaHistory {
  constructor() { this.cache = new Map(); }
  async read(file, stat, live) {
    let state = this.cache.get(file);
    if (state?.busy) { await state.busy; stat = await fs.stat(file); }
    if (!state || stat.size < state.offset || (stat.size === state.offset && stat.mtimeMs !== state.mtimeMs)) { state = createQuotaState(); this.cache.set(file, state); }
    state.busy = this.scan(file, stat, state);
    try { await state.busy; } finally { state.busy = null; }
    // Keep live account observations in memory; only metrics, never conversation content.
    if (live) observe(state, live);
    if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
    return { createdAt: state.createdAt, activeMs: activeAt(state, Date.now()), buckets: state.buckets, credits: { estimated: state.creditRecords ? state.estimatedCredits : null, estimatedHigh: state.creditRecords ? state.estimatedCreditsHigh : null, records: state.creditRecords, missingRecords: state.missingCreditRecords, unknownTier: state.unknownTier, observedDebit: state.firstCreditsBalance !== null ? state.creditsDebited : null, balance: state.lastCreditsBalance } };
  }
  async scan(file, stat, state) {
    if (stat.size > state.offset) {
      const handle = await fs.open(file, 'r');
      try {
        while (state.offset < stat.size) {
          const buffer = Buffer.alloc(Math.min(BLOCK, stat.size - state.offset));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, state.offset);
          if (!bytesRead) break;
          state.offset += bytesRead;
          const bytes = Buffer.concat([state.carry, buffer.subarray(0, bytesRead)]), end = bytes.lastIndexOf(10);
          if (end >= 0) for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) {
            if (!/"type"\s*:\s*"(?:session_meta|turn_context|token_count|task_started|task_complete|turn_aborted)"/.test(line.slice(0, 512))) continue;
            try { consumeQuotaRow(state, JSON.parse(line)); } catch { /* Partial or non-JSON records do not become usage samples. */ }
          }
          state.carry = bytes.subarray(end + 1);
        }
      } finally { await handle.close(); }
    }
    state.mtimeMs = stat.mtimeMs;
  }
}
