(() => {
  'use strict';
  if (window.__codexComposerHUD?.version === '1.4.0') { window.__codexComposerHUD.remount(); return 'already-mounted'; }
  window.__codexComposerHUD?.dispose();
  const VERSION = '1.4.0';
  const hosts = new Map(), pending = new Map(), threads = new Map(), quotas = new Map(), quotaRequests = new Map();
  const configs = new Map();
  const metrics = window.__codexHUDMetrics;
  let selected = null, generation = 0, timer, mountTimer, disposed = false;
  let meta = null, quotaError = null, sessionError = null, updatedAt = null;
  const number = value => Number.isFinite(value) ? (value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value).toLocaleString('ko-KR')) : '—';
  const percent = (used, max) => Number.isFinite(used) && max > 0 ? used / max * 100 : null;
  const duration = ms => { const secs = Math.max(0, Math.floor(ms / 1000)); return secs >= 3600 ? `${Math.floor(secs / 3600)}시간 ${Math.floor(secs % 3600 / 60)}분` : secs >= 60 ? `${Math.floor(secs / 60)}분 ${secs % 60}초` : `${secs}초`; };
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const key = value => `${value?.hostId || 'local'}:${value?.threadId || ''}`;
  function active(editor) {
    const row = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
    const explicit = editor.closest('[data-conversation-id]')?.getAttribute('data-conversation-id');
    const id = explicit || row?.getAttribute('data-app-action-sidebar-thread-id');
    const threadId = id?.replace(/^local:/, '').replace(/^urn:uuid:/, '');
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId || '') ? { threadId, hostId: row?.getAttribute('data-app-action-sidebar-thread-host-id') || 'local' } : null;
  }
  function request(method, params, hostId = 'local') {
    if (!window.electronBridge?.sendMessageFromView) return Promise.reject(new Error('앱 데이터 연결을 사용할 수 없습니다.'));
    const id = `composer-hud:${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('데이터 조회 시간이 초과되었습니다.')); }, 10000);
      pending.set(id, { resolve, reject, timeout });
      window.electronBridge.sendMessageFromView({ type: 'mcp-request', hostId, request: { id, method, params }, priority: 'background', source: 'composer-usage' }).catch(error => {
        clearTimeout(timeout); pending.delete(id); reject(error);
      });
    });
  }
  function normalizeNative(usage) {
    const convert = part => ({ input_tokens: part?.inputTokens ?? null, cached_input_tokens: part?.cachedInputTokens ?? null, output_tokens: part?.outputTokens ?? null, reasoning_output_tokens: part?.reasoningOutputTokens ?? null, total_tokens: part?.totalTokens ?? null });
    return { last: convert(usage?.last), total: convert(usage?.total), modelContextWindow: usage?.modelContextWindow ?? null };
  }
  function onMessage(event) {
    const message = event.data;
    if (message?.type === 'mcp-response') {
      const response = message.message, item = pending.get(response?.id);
      if (!item) return;
      event.stopImmediatePropagation(); clearTimeout(item.timeout); pending.delete(response.id);
      response.error ? item.reject(new Error(response.error.message)) : item.resolve(response.result); return;
    }
    if (message?.type !== 'mcp-notification') return;
    const params = message.params || {}, hostId = message.hostId || 'local';
    if (message.method === 'account/rateLimits/updated') { quotas.set(hostId, { data: params, at: Date.now() }); quotaError = null; render(); return; }
    if (!params.threadId) return;
    const threadKey = key({ hostId, threadId: params.threadId });
    const state = threads.get(threadKey) || { running: new Set() };
    if (message.method === 'thread/tokenUsage/updated') { state.usage = normalizeNative(params.tokenUsage); state.updatedAt = new Date().toISOString(); state.nativeUsage = true; }
    if (message.method === 'thread/status/changed') state.active = params.status?.type !== 'idle';
    if (message.method === 'turn/started') { state.active = true; state.startedAt = new Date().toISOString(); state.activityAt = state.startedAt; state.running.clear(); }
    if (['turn/completed', 'thread/closed'].includes(message.method)) { state.active = false; state.startedAt = null; state.activityAt = new Date().toISOString(); state.running.clear(); }
    if (message.method === 'item/started' && ['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'collabToolCall'].includes(params.item?.type)) state.running.add(params.item.id);
    if (message.method === 'item/completed') state.running.delete(params.item?.id);
    if (message.method === 'item/started' && params.item?.type === 'contextCompaction') state.compacting = true;
    if ((message.method === 'item/completed' && params.item?.type === 'contextCompaction') || message.method === 'turn/completed') state.compacting = false;
    threads.set(threadKey, state);
    if (threadKey === key(selected)) { sessionError = state.usage ? null : sessionError; render(); }
  }
  function acceptSnapshot(snapshot) {
    if (disposed || key(snapshot) !== key(selected)) return;
    const state = threads.get(key(selected)) || { running: new Set() };
    if (!state.nativeUsage || Date.parse(snapshot.updatedAt) >= Date.parse(state.updatedAt)) {
      if (snapshot.usage) { state.usage = snapshot.usage; state.updatedAt = snapshot.updatedAt; }
    }
    if (!state.activityAt || Date.parse(snapshot.activityAt) >= Date.parse(state.activityAt)) {
      if (snapshot.startedAt) state.startedAt = snapshot.startedAt;
      if (snapshot.startedAt === null) state.startedAt = null;
      state.activityAt = snapshot.activityAt;
    }
    threads.set(key(selected), state);
    state.quotaHistory = snapshot.quotaHistory;
    state.quotaHistoryError = snapshot.quotaHistoryError;
    sessionError = snapshot.error && !state.usage ? snapshot.error : null;
    updatedAt = new Date().toISOString(); render();
  }
  function pollSession() {
    if (!selected || !meta?.path || typeof window.__codexComposerHUDRead !== 'function') return;
    const record = quotas.get(selected.hostId);
    const weekly = metrics?.weeklyQuota(record?.data);
    const quota = weekly && !quotaError ? { ...weekly, at: record.at } : null;
    window.__codexComposerHUDRead(JSON.stringify({ ...selected, path: meta.path, quota }));
  }
  async function refreshQuota(force = false) {
    const hostId = selected?.hostId || 'local'; const record = quotas.get(hostId);
    if (!force && record && Date.now() - record.at < 60000) return;
    if (quotaRequests.has(hostId)) return quotaRequests.get(hostId);
    const query = request('account/rateLimits/read', {}, hostId);
    quotaRequests.set(hostId, query);
    try {
      const data = await query;
      if (disposed) return;
      quotas.set(hostId, { data, at: Date.now() }); quotaError = null;
    } catch { quotaError = '계정 한도를 조회할 수 없습니다. 새로고침으로 다시 시도하세요.'; }
    finally { quotaRequests.delete(hostId); }
    render();
  }
  async function select(value) {
    selected = value; const epoch = ++generation; meta = null; sessionError = null; updatedAt = null; render();
    refreshQuota();
    refreshConfig(value?.hostId || 'local');
    if (!value) return;
    try {
      const result = await request('thread/read', { threadId: value.threadId, includeTurns: false }, value.hostId);
      if (disposed || epoch !== generation) return;
      const thread = result.thread;
      meta = { path: thread.path, model: thread.model, status: thread.status };
      pollSession();
      if (!thread.path && !threads.get(key(value))?.usage) sessionError = '새 토큰 사용량 이벤트를 기다립니다.';
    } catch { if (epoch === generation) sessionError = '채팅 사용량을 조회할 수 없습니다.'; }
    render();
  }
  async function refreshConfig(hostId) {
    if (configs.has(hostId)) return;
    configs.set(hostId, null);
    try {
      const { config } = await request('config/read', { includeLayers: false }, hostId);
      if (!disposed) configs.set(hostId, { compactLimit: config.model_auto_compact_token_limit, scope: config.model_auto_compact_token_limit_scope || 'total' });
    } catch { configs.delete(hostId); }
    render();
  }
  function compactState(value) {
    const state = threads.get(key(value)) || {};
    return { ...state, active: state.active ?? (meta?.status?.type !== 'idle') };
  }
  async function compactSession() {
    const value = selected, state = threads.get(key(value));
    if (!metrics?.canCompact(value, compactState(value))) return;
    const current = state || { running: new Set() };
    current.compacting = true; current.compactError = null; threads.set(key(value), current); render();
    try { await request('thread/compact/start', { threadId: value.threadId }, value.hostId); }
    catch { current.compacting = false; current.compactError = '압축을 시작하지 못했습니다. 작업이 끝난 뒤 다시 시도하세요.'; render(); }
  }
  const styles = `
    :host{display:inline-flex;align-items:center;flex-shrink:0;margin-right:6px;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;color:var(--color-text,#dedede);color-scheme:dark}
    *{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:0}button:focus-visible{outline:2px solid #70aaff;outline-offset:3px}button:disabled{opacity:.4;cursor:default}
    .trigger{display:flex;align-items:center;gap:5px;min-height:28px;padding:3px 7px;border-radius:8px;background:transparent;color:var(--color-text-secondary,#aaa);white-space:nowrap}
    .separator{opacity:.35;margin:0 2px}.compact,.weekly{font-variant-numeric:tabular-nums}.weekly{color:var(--quota-tone,inherit)}
    .trigger:hover,.trigger[aria-expanded=true]{background:var(--color-surface-secondary,#303030);color:var(--color-text,#eee)}
    .ring{width:15px;height:15px;border-radius:50%;background:conic-gradient(var(--tone,#5399ed) calc(var(--pct,0)*1%),#ffffff22 0);position:relative}.ring:after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--color-surface-primary,#242424)}
    .running .ring{animation:spin 1.4s linear infinite;background:conic-gradient(#5399ed 30%,transparent 0)}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.running .ring{animation:none}}
    .panel{position:fixed;z-index:2147483600;width:355px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:var(--color-surface-primary,#232323);color:var(--color-text,#dedede);border:1px solid var(--color-border,#454545);border-radius:12px;box-shadow:0 8px 32px #0005;padding:12px;text-align:left;overscroll-behavior:contain}
    [hidden]{display:none!important}.head,.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.head{color:var(--color-text-secondary,#a5a5a5);margin-bottom:8px}.head strong{font-weight:500}.subtle,.note{color:var(--color-text-secondary,#999)}.note{font-size:11px;line-height:1.6}.row{margin:7px 0;font-variant-numeric:tabular-nums}.row span:last-child{text-align:right}.row b{font-weight:500}.value{color:var(--color-text,#ddd)}
    .bar{height:4px;border-radius:2px;background:var(--color-surface-secondary,#373737);overflow:hidden;margin:6px 0 9px}.bar i{display:block;height:100%;background:var(--tone,#5399ed);width:calc(var(--pct,0)*1%)}.section{border-top:1px solid var(--color-border,#3b3b3b);margin-top:12px;padding-top:10px}.reset{font-size:11px;color:var(--color-text-secondary,#999)}.error{color:#e6ad66;font-size:11px;line-height:1.6}.actions{display:flex;justify-content:space-between;margin-top:10px;gap:12px}.actions button{padding:4px 7px;border-radius:5px;background:var(--color-surface-secondary,#3b3b3b)}details summary{cursor:pointer;color:var(--color-text-secondary,#aaa);padding:4px 0;font-size:11px}.label{display:flex;align-items:center;gap:7px}.dot{width:8px;height:8px;background:#5399ed;border-radius:2px}.output{background:#ea8b4b}.cached{background:#31aa8d}.reason{background:#c496da}
    .compact-action{padding:4px 7px;border-radius:5px;background:var(--color-surface-secondary,#3b3b3b);white-space:nowrap}.compaction-row{align-items:center;margin-top:10px}.cost-title{font-size:11px;color:var(--color-text-secondary,#aaa)}
    details.fold>summary{display:flex;align-items:center;gap:7px;padding:6px 0;color:var(--color-text,#ddd);font-weight:500;list-style:none}details.fold>summary::-webkit-details-marker{display:none}details.fold>summary:before{content:'▸';font-size:11px;color:var(--color-text-secondary,#aaa)}details.fold[open]>summary:before{content:'▾'}.fold-title{flex:1}.fold-value{font-weight:400;color:var(--color-text-secondary,#aaa);font-variant-numeric:tabular-nums}.fold-body{padding-top:3px}details.notes{margin-top:8px}details.notes>summary{font-size:11px}
    :host-context([data-theme=light]){color-scheme:light}:host-context([data-theme=light]) .panel{background:var(--color-surface-primary,#fff);color:var(--color-text,#222);border-color:#ddd}:host-context([data-theme=light]) .ring:after{background:var(--color-surface-primary,#fff)}
  `;
  function makeHost(toolbar) {
    const host = document.createElement('span'); host.dataset.codexComposerHud = VERSION;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${styles}</style><button class="trigger" type="button" aria-label="컨텍스트와 주간 잔여 한도" aria-haspopup="dialog" aria-expanded="false"><span class="ring" aria-hidden="true"></span><span class="compact">컨텍스트 —</span><span class="separator" aria-hidden="true">|</span><span class="weekly">주간 잔여 —</span></button><section class="panel" role="dialog" aria-label="Codex 사용량" hidden><div class="content"></div><div class="actions"><span class="note freshness">실제 사용량</span><button type="button" class="refresh">새로고침</button></div></section>`;
    toolbar.prepend(host);
    const item = { host, root, open: false, folds: new Map(), trigger: root.querySelector('.trigger'), panel: root.querySelector('.panel') };
    item.trigger.addEventListener('click', () => {
      item.open = !item.open; item.panel.hidden = !item.open; item.trigger.setAttribute('aria-expanded', String(item.open));
      if (item.open) { refreshQuota(); pollSession(); render(); position(item); }
    });
    root.querySelector('.refresh').addEventListener('click', () => { refreshQuota(true); pollSession(); });
    root.querySelector('.content').addEventListener('click', event => {
      if (event.target.closest('.compact-action')) compactSession();
      const summary = event.target.closest('summary');
      if (!summary) return;
      event.preventDefault();
      const details = summary.parentElement;
      const next = !details.open;
      item.folds.set(details.dataset.hudFold, next);
      details.open = next;
      position(item);
    });
    root.querySelector('.content').addEventListener('toggle', event => {
      const id = event.target.dataset?.hudFold;
      if (event.target.tagName !== 'DETAILS' || !id || event.target !== root.querySelector(`details[data-hud-fold="${id}"]`)) return;
      item.folds.set(id, event.target.open);
      position(item);
    }, true);
    item.resizeObserver = new ResizeObserver(() => position(item));
    item.resizeObserver.observe(item.panel);
    item.resizeObserver.observe(item.trigger);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { close(item); item.trigger.focus(); event.stopPropagation(); }
      if (event.key === 'Tab' && item.open) { const focusables = [item.trigger, ...item.panel.querySelectorAll('summary,button:not(:disabled)')]; const current = root.activeElement; if (event.shiftKey && current === focusables[0]) { focusables.at(-1).focus(); event.preventDefault(); } else if (!event.shiftKey && current === focusables.at(-1)) { item.trigger.focus(); event.preventDefault(); } }
    });
    hosts.set(host, item); return item;
  }
  function close(item) { item.open = false; item.panel.hidden = true; item.trigger.setAttribute('aria-expanded', 'false'); }
  function position(item) {
    if (!item.open) return;
    const rect = item.trigger.getBoundingClientRect();
    const width = item.panel.offsetWidth;
    const above = Math.max(0, rect.top - 20);
    const below = Math.max(0, innerHeight - rect.bottom - 20);
    item.panel.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, rect.right - width))}px`;
    // Anchor by the available space, so native details growth stays in bounds before paint.
    if (above >= below) {
      item.panel.style.top = 'auto';
      item.panel.style.bottom = `${innerHeight - rect.top + 8}px`;
      item.panel.style.maxHeight = `${above}px`;
    } else {
      item.panel.style.bottom = 'auto';
      item.panel.style.top = `${rect.bottom + 8}px`;
      item.panel.style.maxHeight = `${below}px`;
    }
  }
  function quotaHTML(data) {
    const buckets = data?.rateLimitsByLimitId || (data?.rateLimits ? { codex: data.rateLimits } : {});
    const rows = [];
    for (const [id, bucket] of Object.entries(buckets)) {
      for (const window of [bucket.primary, bucket.secondary].filter(Boolean)) {
        const minutes = window.windowDurationMins;
        const period = minutes === 10080 ? '주간' : minutes === 300 ? '5시간' : minutes % 1440 === 0 ? `${minutes / 1440}일` : minutes % 60 === 0 ? `${minutes / 60}시간` : Number.isFinite(minutes) ? `${minutes}분` : '사용';
        const used = window.usedPercent;
        const label = `${period} 한도${Object.keys(buckets).length > 1 ? ' / ' + (bucket.limitName || id) : ''}`;
        const resetMs = Number.isFinite(window.resetsAt) ? window.resetsAt * 1000 : null;
        const reset = resetMs ? `${resetMs > Date.now() ? duration(resetMs - Date.now()) + ' 후 초기화' : '초기화 시각 경과'} (${new Date(resetMs).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})` : '초기화 시각 미제공';
        const tone = used >= 90 ? '#e8866e' : used >= 70 ? '#dcac60' : '#5399ed';
        rows.push(`<div class="row"><b>${escape(label)}</b><span>${Number.isFinite(used) ? `사용 ${Math.round(used)}% / 잔여 ${Math.round(Math.max(0, Math.min(100, 100 - used)))}%` : '—'}</span></div><div class="reset">${escape(reset)}</div><div class="bar" style="--pct:${Number.isFinite(used) ? Math.max(0, Math.min(100, used)) : 0};--tone:${tone}"><i></i></div>`);
      }
    }
    return rows.join('') || '<p class="note">계정에서 제공한 사용 한도 데이터가 없습니다.</p>';
  }
  function weeklyRemaining(data) {
    return metrics?.weeklyQuota(data)?.remaining ?? null;
  }
  function sessionForecastHTML(state, weekly, item) {
    if (!selected) return '';
    const forecast = metrics?.quotaForecast(state?.quotaHistory, weekly);
    const hasRecord = Number.isFinite(forecast?.used);
    const hasRate = !quotaError && Number.isFinite(forecast?.rate);
    const observed = hasRecord ? `${forecast.used.toFixed(2)}%p` : '기록 확인 중';
    const rate = hasRate ? `약 ${forecast.rate.toFixed(2)}%p /시간` : '표본 부족';
    const afterHour = hasRate ? `약 ${forecast.remainingAfterHour.toFixed(1)}%` : '—';
    const exhaust = !hasRate ? '아직 계산할 수 없습니다' : forecast.resetsFirst ? '주간 초기화가 먼저' : `${new Date(forecast.exhaustsAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}경`;
    const basis = forecast?.basis === 'recent' ? `최근 ${Math.round(forecast.rateSpanMs / 60000)}분 작업 기준` : '세션 작업 평균';
    const note = state?.quotaHistoryError || (forecast?.reason === 'history-unavailable' ? '이 세션의 주간 한도 기록이 없습니다.' : forecast?.reason === 'cycle-changed' ? '한도 초기화 후 기록을 다시 확인합니다.' : !hasRate ? '5분 이상 작업과 한도 변화가 관측되면 추정합니다.' : `${basis}. 쉬었던 시간은 제외합니다.`);
    const relative = hasRecord && Number.isFinite(forecast.shareOfInitial) ? `<div class="note">관측 시작 잔여의 ${forecast.shareOfInitial.toFixed(1)}% 사용${forecast.restarted ? ' / 초기화 이후 기준' : ''}</div>` : '';
    const until = hasRate && !forecast.resetsFirst ? `<div class="note">같은 소모 속도를 유지하면 약 ${duration(forecast.exhaustsAt - Date.now())} 후</div>` : '';
    const credits = state?.quotaHistory?.credits;
    const creditAmount = !Number.isFinite(credits?.estimated) ? '미제공' : credits.missingRecords ? `≥ ${credits.estimated.toFixed(1)} credits` : credits.estimatedHigh > credits.estimated + .01 ? `약 ${credits.estimated.toFixed(1)}–${credits.estimatedHigh.toFixed(1)} credits` : `약 ${credits.estimated.toFixed(1)} credits`;
    const creditRows = `<div class="row"><span>이 세션 credit 환산</span><span>${creditAmount}</span></div><div class="row"><span>잔액 차감 / 관측</span><span>${Number.isFinite(credits?.observedDebit) ? credits.observedDebit.toLocaleString('ko-KR', {maximumFractionDigits:2}) + ' credits' : '미제공'}</span></div>`;
    const creditNote = credits?.unknownTier ? '속도 기록이 없어 지원 속도의 요율 범위로 환산합니다.' : '요청별 모델과 속도 기록으로 credit을 환산합니다.';
    return `<details class="section fold" data-hud-fold="session"${item.folds.get('session') ? ' open' : ''}><summary><span class="fold-title">세션 소모 추정</span><span class="fold-value">관측 ${observed}</span></summary><div class="fold-body"><div class="row"><span>관측된 소모</span><span>${observed}</span></div>${relative}<div class="row"><span>계속 작업 시 소모</span><span>${rate}</span></div><div class="row"><span>1시간 후 주간 잔여</span><span>${afterHour}</span></div><div class="row"><span>주간 예상 고갈</span><span>${escape(exhaust)}</span></div>${until}${creditRows}<details class="notes" data-hud-fold="session-notes"${item.folds.get('session-notes') ? ' open' : ''}><summary>산정 기준과 참고</summary><p class="note">${escape(note)}<br>한도와 잔액은 계정 공유 값이며 다른 세션의 사용이 포함될 수 있습니다.<br>${creditNote} 환산량과 실제 차감량은 다릅니다.</p></details></div></details>`;
  }
  function render() {
    const state = threads.get(key(selected)); const usage = state?.usage;
    const used = usage?.last?.input_tokens, max = usage?.modelContextWindow, pct = percent(used, max);
    const tone = pct >= 85 ? '#e8866e' : pct >= 70 ? '#dcac60' : '#5399ed';
    const quota = quotas.get(selected?.hostId || 'local');
    const remaining = weeklyRemaining(quota?.data);
    for (const item of hosts.values()) {
      if (!item.host.isConnected) { item.resizeObserver.disconnect(); hosts.delete(item.host); continue; }
      item.trigger.classList.toggle('running', Boolean(state?.startedAt));
      item.trigger.style.setProperty('--pct', Math.max(0, Math.min(100, pct ?? 0)));
      item.trigger.style.setProperty('--tone', tone);
      item.root.querySelector('.compact').textContent = `컨텍스트 ${pct !== null ? Math.round(pct) + '%' : '—'}`;
      item.root.querySelector('.weekly').textContent = `주간 잔여 ${remaining !== null ? Math.round(remaining) + '%' : '—'}`;
      item.trigger.style.setProperty('--quota-tone', remaining !== null && remaining <= 10 ? '#e6ad66' : 'inherit');
      item.trigger.title = `${pct !== null ? `컨텍스트 ${number(used)} / ${number(max)} (${pct.toFixed(1)}%)` : '컨텍스트 데이터 미제공'}\n${remaining !== null ? `주간 한도 ${remaining.toFixed(1)}% 남음` : quotaError || '주간 한도 데이터 미제공'}`;
      item.trigger.setAttribute('aria-label', `${item.root.querySelector('.compact').textContent}, ${item.root.querySelector('.weekly').textContent}`);
      if (!item.open) continue;
      const available = Number.isFinite(used) && Number.isFinite(max) ? Math.max(0, max - used) : null;
      const detail = usage ? `<details data-hud-fold="tokens"${item.folds.get('tokens') ? ' open' : ''}><summary>토큰 상세 보기</summary>${[
        ['현재 입력', used, ''], ['캐시된 입력', usage.last.cached_input_tokens, 'cached'], ['최근 출력', usage.last.output_tokens, 'output'], ['출력 중 추론', usage.last.reasoning_output_tokens, 'reason'], ['누적 토큰', usage.total.total_tokens, '']
      ].map(([label, value, color]) => `<div class="row"><span class="label"><i class="dot ${color}"></i>${label}</span><span>${number(value)}</span></div>`).join('')}<p class="note">캐시는 입력에, 추론은 출력에 포함됩니다.<br>메시지, 도구, Skills별 정확한 토큰 분류는 앱에서 제공하지 않습니다.</p></details>` : '';
      const status = state?.startedAt ? `<div class="row subtle"><span>실행 중 ${duration(Date.now() - Date.parse(state.startedAt))}</span><span>${state.running?.size ? `도구 ${state.running.size}개` : ''}</span></div>` : '';
      const cacheLast = metrics?.cacheHit(usage?.last), cacheTotal = metrics?.cacheHit(usage?.total);
      const cache = usage ? `<div class="row subtle"><span>캐시 히트 / 최근</span><span>${Number.isFinite(cacheLast) ? cacheLast.toFixed(1) + '%' : '—'}</span></div><div class="row subtle"><span>캐시 히트 / 세션</span><span>${Number.isFinite(cacheTotal) ? cacheTotal.toFixed(1) + '%' : '—'}</span></div>` : '';
      const forecast = sessionForecastHTML(state, metrics?.weeklyQuota(quota?.data), item);
      const quotaContent = !quota && !quotaError ? '<p class="note">계정 한도를 조회하는 중입니다.</p>' : quotaHTML(quota?.data);
      const config = configs.get(selected?.hostId || 'local');
      const compactLeft = metrics?.compactRemaining(config, usage);
      const compression = selected ? `<div class="row compaction-row"><span class="note">${Number.isFinite(compactLeft) ? `자동 압축까지 약 ${number(compactLeft)} 토큰` : '자동 압축 기준 미제공'}</span><button class="compact-action" type="button" ${metrics?.canCompact(selected, compactState(selected)) ? '' : 'disabled'} title="작업이 끝난 채팅의 문맥을 요약해 줄입니다.">${state?.compacting ? '압축 중…' : '세션 압축'}</button></div>${config?.compactLimit ? `<div class="note">설정 기준 ${number(config.compactLimit)} 토큰</div>` : ''}${state?.compactError ? `<p class="error">${escape(state.compactError)}</p>` : ''}` : '';
      const cost = metrics?.costRange(meta?.model, usage?.last);
      const sessionCost = metrics?.sessionCostRange(meta?.model, usage?.total);
      const dollars = value => '$' + value.toFixed(value >= 1 ? 2 : 4);
      const estimate = usage ? `<details class="section fold" data-hud-fold="costs"${item.folds.get('costs') ? ' open' : ''}><summary><span class="fold-title">비용 환산 추정</span><span class="fold-value">${sessionCost ? `${dollars(sessionCost.low)}–${dollars(sessionCost.high)}` : '미제공'}</span></summary><div class="fold-body"><div class="row"><span class="cost-title">최근 토큰 API 환산</span><span>${cost ? `${dollars(cost.low)} – ${dollars(cost.high)}` : '가격 정보 미제공'}</span></div><div class="row"><span class="cost-title">세션 누적 환산 추정</span><span>${sessionCost ? `${dollars(sessionCost.low)} – ${dollars(sessionCost.high)}` : '—'}</span></div>${cost ? `<details class="notes" data-hud-fold="cost-notes"${item.folds.get('cost-notes') ? ' open' : ''}><summary>가격 기준과 참고</summary><p class="note">현재 모델 ${escape(cost.model)}, 기본 처리 요금 기준.<br>구독 청구액과 별도인 환산 값입니다. 누적 값은 긴 문맥과 캐시 쓰기 요금을 범위로 추정하며 도구 요금은 제외합니다.<br>가격 기준 ${cost.pricingDate}</p></details>` : ''}</div></details>` : '';
      const focusedFold = item.root.activeElement?.tagName === 'SUMMARY' ? item.root.activeElement.parentElement.dataset.hudFold : null;
      item.root.querySelector('.content').innerHTML = `<div class="head"><strong>컨텍스트 윈도우</strong><span class="value">${number(used)} / ${number(max)}${pct !== null ? ` (${Math.round(pct)}%)` : ''}</span></div><div class="bar" style="--pct:${Math.max(0, Math.min(100, pct ?? 0))};--tone:${tone}"><i></i></div><div class="row subtle"><span>남은 공간</span><span>${number(available)}</span></div>${!selected ? '<p class="note">채팅을 열면 컨텍스트 사용량이 표시됩니다.</p>' : sessionError ? `<p class="error">${escape(sessionError)}</p>` : !usage ? '<p class="note">사용량을 읽는 중입니다.</p>' : ''}${cache}${detail}${compression}${status}<div class="section"><div class="head"><strong>계정 사용 한도${quota?.data?.rateLimits?.planType ? ' / ' + escape(quota.data.rateLimits.planType) : ''}</strong></div>${quotaContent}${quotaError ? `<p class="error">${escape(quotaError)}</p>` : ''}</div>${forecast}${estimate}`;
      const lastChecked = quota?.at;
      if (focusedFold) item.root.querySelector(`details[data-hud-fold="${focusedFold}"]>summary`)?.focus();
      item.root.querySelector('.freshness').textContent = lastChecked ? `한도 확인 ${new Date(lastChecked).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '실제 사용량';
      position(item);
    }
  }
  function mount() {
    if (disposed) return;
    let primary = null;
    for (const editor of document.querySelectorAll('[data-codex-composer="true"], [contenteditable="true"][data-composer-markdown]')) {
      const rect = editor.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
      const footer = editor.closest('[data-composer-footer-responsive]'); if (!footer) continue;
      const gridCell = Array.from(footer.children).at(-1);
      const actionRow = gridCell?.querySelector(':scope > .flex') || gridCell;
      const toolbar = actionRow?.querySelector(':scope > .flex-1') || actionRow;
      if (!toolbar || toolbar.contains(editor)) continue;
      let host = Array.from(hosts.keys()).find(node => node.parentElement === toolbar);
      if (!host) makeHost(toolbar);
      primary ||= editor;
    }
    const next = primary ? active(primary) : null;
    if (key(next) !== key(selected)) select(next);
    for (const item of hosts.values()) if (!item.host.isConnected) { close(item); item.resizeObserver.disconnect(); hosts.delete(item.host); }
    render();
  }
  const observer = new MutationObserver(records => {
    if (records.every(record => record.target instanceof Element && record.target.closest('[data-codex-composer-hud]'))) return;
    clearTimeout(mountTimer); mountTimer = setTimeout(mount, 120);
  });
  const onOutside = event => { for (const item of hosts.values()) if (!event.composedPath().includes(item.host)) close(item); };
  const onResize = () => { for (const item of hosts.values()) position(item); };
  const api = {
    version: VERSION, acceptSnapshot, remount: mount,
    state: () => ({ selected, mounted: hosts.size, hasUsage: Boolean(threads.get(key(selected))?.usage), quotaLoaded: quotas.size > 0, error: sessionError || quotaError }),
    dispose: () => {
      disposed = true; ++generation; clearInterval(timer); clearTimeout(mountTimer); observer.disconnect();
      window.removeEventListener('message', onMessage, true); document.removeEventListener('pointerdown', onOutside, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true);
      for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error('사용량 표시기가 종료되었습니다.')); }
      pending.clear(); for (const item of hosts.values()) { item.resizeObserver.disconnect(); item.host.remove(); } hosts.clear(); delete window.__codexComposerHUD;
    }
  };
  window.__codexComposerHUD = api;
  window.addEventListener('message', onMessage, true); document.addEventListener('pointerdown', onOutside, true); window.addEventListener('resize', onResize); window.addEventListener('scroll', onResize, true);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-thread-active', 'data-app-action-sidebar-thread-id', 'data-theme'] });
  mount(); refreshQuota(); timer = setInterval(() => { mount(); pollSession(); refreshQuota(); }, 3000);
  return 'mounted';
})();
