(() => {
  'use strict';
  const pricingDate = '2026-10-01';
  const prices = {
    'gpt-6.1-sol': { input: 2, cached: 0.1, write: 2.5, output: 10, source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol' },
    'gpt-6-sol': { input: 2, cached: 0.2, write: 2.5, output: 10, source: 'https://developers.openai.com/api/docs/models/gpt-6-sol' },
    'gpt-6-astra': { input: 10, cached: 1, write: 12.5, output: 50, source: 'https://developers.openai.com/api/docs/models/gpt-6-astra' }
  };
  const creditRates = {
    'gpt-6-astra': { input: 250, cached: 25, output: 1250 },
    'gpt-6.1-sol': { input: 50, cached: 2.5, output: 250 },
    'gpt-6-sol': { input: 50, cached: 5, output: 250 },
    'gpt-6-luna': { input: 2.5, cached: .25, output: 12.5 },
    'gpt-5.6-sol': { input: 100, cached: 10, output: 500 },
    'gpt-5.6-terra': { input: 50, cached: 5, output: 300 },
    'gpt-5.6-luna': { input: 5, cached: .5, output: 30 }
  };
  function creditEstimate(model, usage, tier = 'standard') {
    const rate = creditRates[model], input = usage?.input_tokens, cached = usage?.cached_input_tokens, output = usage?.output_tokens;
    if (!rate || ![input, cached, output].every(Number.isFinite) || Math.min(input, cached, output) < 0 || cached > input) return null;
    const multiplier = ['priority', 'fast'].includes(tier) ? 2 : tier === 'ultrafast' && model === 'gpt-6-astra' ? 6 : 1;
    return ((input - cached) * rate.input + cached * rate.cached + output * rate.output) / 1e6 * multiplier;
  }
  function costRange(model, usage) {
    const rate = prices[model];
    const input = usage?.input_tokens, cached = usage?.cached_input_tokens, output = usage?.output_tokens;
    if (!rate || ![input, cached, output].every(Number.isFinite) || Math.min(input, cached, output) < 0 || cached > input) return null;
    const long = input > 272000;
    const inputMultiplier = long ? 2 : 1, outputMultiplier = long ? 1.5 : 1;
    const shared = cached * rate.cached * inputMultiplier + output * rate.output * outputMultiplier;
    return { low: ((input - cached) * rate.input * inputMultiplier + shared) / 1e6, high: ((input - cached) * rate.write * inputMultiplier + shared) / 1e6, long, model, source: rate.source, pricingDate };
  }
  function sessionCostRange(model, usage) {
    const rate = prices[model], input = usage?.input_tokens, cached = usage?.cached_input_tokens, output = usage?.output_tokens;
    if (!rate || ![input, cached, output].every(Number.isFinite) || Math.min(input, cached, output) < 0 || cached > input) return null;
    // Totals do not identify individual request tiers: bound short/long pricing rather than treating the total as one prompt.
    return { low: ((input - cached) * rate.input + cached * rate.cached + output * rate.output) / 1e6, high: ((input - cached) * rate.write * 2 + cached * rate.cached * 2 + output * rate.output * 1.5) / 1e6 };
  }
  function compactRemaining(config, usage) {
    if ((config?.scope || 'total') !== 'total') return null;
    const limit = config?.compactLimit, used = usage?.last?.total_tokens;
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return null;
    return Math.max(0, limit - used);
  }
  function canCompact(selected, state) { return Boolean(selected && !state?.active && !state?.startedAt && !state?.compacting); }
  function cacheHit(usage) {
    const input = usage?.input_tokens, cached = usage?.cached_input_tokens;
    return Number.isFinite(input) && input > 0 && Number.isFinite(cached) && cached >= 0 && cached <= input ? cached / input * 100 : null;
  }
  function weeklyQuota(data) {
    const buckets = data?.rateLimitsByLimitId;
    const bucket = buckets?.codex || data?.rateLimits || (buckets && Object.values(buckets).find(value => [value?.primary, value?.secondary].some(window => window?.windowDurationMins === 10080)));
    const window = [bucket?.primary, bucket?.secondary].find(value => value?.windowDurationMins === 10080);
    const balance = bucket?.credits?.balance;
    const creditsBalance = balance !== null && balance !== undefined && balance !== '' && Number.isFinite(Number(balance)) ? Number(balance) : null;
    return window && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 ? { bucketId: bucket.limitId || 'codex', used: window.usedPercent, remaining: 100 - window.usedPercent, resetsAt: window.resetsAt, creditsBalance } : null;
  }
  function quotaForecast(history, current, now = Date.now()) {
    const bucket = history?.buckets?.[current?.bucketId || 'codex'];
    const points = bucket?.points;
    if (!points?.length) return { reason: 'history-unavailable' };
    const first = points[0], last = points.at(-1);
    if (current && (Math.abs(current.resetsAt - last.resetsAt) > 120 || current.used < last.used - .01)) return { reason: 'cycle-changed' };
    const used = Math.max(0, last.used - first.used), initialRemaining = Math.max(0, 100 - first.used);
    const answer = { used, initialRemaining, shareOfInitial: initialRemaining > 0 ? used / initialRemaining * 100 : null, baselineAt: first.at, observedAt: last.at, restarted: bucket.restarted, rate: null, exhaustsAt: null };
    // Prefer 30 minutes of working time; a coarse, unchanged quota needs the session average.
    const threshold = last.activeMs - 30 * 60000;
    let anchor = points.find(point => point.activeMs >= threshold) || first;
    let activeSpan = last.activeMs - anchor.activeMs, delta = last.used - anchor.used;
    answer.basis = 'recent';
    if (delta <= 0 || activeSpan < 5 * 60000) { anchor = first; activeSpan = last.activeMs - first.activeMs; delta = used; answer.basis = 'session'; }
    if (activeSpan < 5 * 60000 || delta <= 0) return { ...answer, reason: 'insufficient-change' };
    answer.rate = delta / (activeSpan / 3600000);
    answer.rateSpanMs = activeSpan;
    const remaining = current?.remaining ?? (100 - last.used);
    answer.remaining = remaining;
    answer.remainingAfterHour = Math.max(0, remaining - answer.rate);
    answer.exhaustsAt = remaining > 0 ? now + remaining / answer.rate * 3600000 : now;
    const resetsAt = current?.resetsAt ?? last.resetsAt;
    answer.resetsFirst = Number.isFinite(resetsAt) && resetsAt * 1000 > now && resetsAt * 1000 <= answer.exhaustsAt;
    return answer;
  }
  globalThis.__codexHUDMetrics = { costRange, sessionCostRange, compactRemaining, canCompact, cacheHit, weeklyQuota, quotaForecast, creditEstimate, pricingDate };
})();
