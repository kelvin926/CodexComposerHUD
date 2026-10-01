import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CDP } from './lib/cdp.mjs';
import { SessionReader } from './lib/sessions.mjs';

const run = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const stateRoot = path.join(process.env.LOCALAPPDATA || root, 'CodexComposerHUD');
const pipe = `\\\\.\\pipe\\codex-composer-hud-${crypto.createHash('sha256').update(os.homedir()).digest('hex').slice(0, 16)}`;
const args = new Set(process.argv.slice(2));
const attachIndex = process.argv.indexOf('--attach');
let port = attachIndex >= 0 ? Number(process.argv[attachIndex + 1]) : null;
let stopped = false, server, launched = false;
const connections = new Map();
const reader = new SessionReader(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const ui = (await fs.readFile(path.join(root, 'ui', 'metrics.js'), 'utf8')) + '\n' + (await fs.readFile(path.join(root, 'ui', 'composer-hud.js'), 'utf8'));
await fs.mkdir(stateRoot, { recursive: true });
async function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (process.stdout.isTTY) process.stdout.write(line);
  const file = path.join(stateRoot, 'hud.log');
  try { if ((await fs.stat(file)).size > 256 * 1024) await fs.writeFile(file, ''); } catch {}
  await fs.appendFile(file, line).catch(() => {});
}
async function powershell(script) {
  const encoded = Buffer.from(`[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`, 'utf16le').toString('base64');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
  return stdout.replace(/^\uFEFF/, '').trim();
}
async function tell(message, error = false) {
  // Arguments are literals in an encoded script, never shell interpolation.
  const literal = `'${message.replace(/'/g, "''")}'`;
  await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(${literal}, 'Codex Composer HUD', 'OK', '${error ? 'Error' : 'Information'}') | Out-Null`).catch(() => {});
}
async function state(value) { await fs.writeFile(path.join(stateRoot, 'status.json'), JSON.stringify({ ...value, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2)); }
async function inventory() {
  const json = await powershell(`$p = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'" | Where-Object { $_.CommandLine -notmatch '--type(?:=|\\s)' -and $_.ExecutablePath -and ($_.ExecutablePath -match 'OpenAI\\.Codex_' -or $_.ExecutablePath -match '\\\\Codex\\\\') -and (Test-Path -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($_.ExecutablePath)) 'resources\\app.asar')) } | Select-Object ProcessId, ExecutablePath, CommandLine); [pscustomobject]@{packageRoot=$p.InstallLocation; processes=$rows} | ConvertTo-Json -Depth 4 -Compress`);
  return JSON.parse(json || '{}');
}
async function appPath(data) {
  const candidates = [...(data.processes || []).map(item => item.ExecutablePath), data.packageRoot && path.join(data.packageRoot, 'app', 'ChatGPT.exe')].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); await fs.access(path.join(path.dirname(candidate), 'resources', 'app.asar')); return candidate; } catch {}
  }
  throw new Error('Microsoft Store Codex 앱을 찾을 수 없습니다.');
}
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const chosen = listener.address().port;
  await new Promise(resolve => listener.close(resolve)); return chosen;
}
function rpcPipe(command) {
  return new Promise(resolve => {
    const socket = net.connect(pipe); const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 1500);
    socket.once('error', () => { clearTimeout(timeout); resolve(false); });
    socket.once('connect', () => { socket.end(command); clearTimeout(timeout); resolve(true); });
  });
}
async function shutdown() {
  if (stopped) return; stopped = true;
  for (const entry of connections.values()) {
    await entry.client.evaluate('window.__codexComposerHUD?.dispose()').catch(() => {});
    if (entry.client.hudScriptId) await entry.client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.client.hudScriptId }).catch(() => {});
    await entry.client.call('Runtime.removeBinding', { name: '__codexComposerHUDRead' }).catch(() => {});
    entry.client.close();
  }
  connections.clear(); server?.close();
  await state({ status: 'stopped', port }); await log('Stopped; injected UI removed.');
  setTimeout(() => process.exit(0), 50);
}
async function setup(client) {
  if (!client.hudBound) client.listeners.add(async message => {
    if (message.method !== 'Runtime.bindingCalled' || message.params.name !== '__codexComposerHUDRead') return;
    try {
      const ref = JSON.parse(message.params.payload);
      const snapshot = await reader.read(ref);
      await client.evaluate(`window.__codexComposerHUD?.acceptSnapshot(${JSON.stringify(snapshot)})`);
    } catch { /* No credentials, session contents, or arbitrary paths are logged. */ }
  });
  client.hudBound = true;
  await client.call('Runtime.enable');
  await client.call('Runtime.addBinding', { name: '__codexComposerHUDRead' });
  if (client.hudScriptId) await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.hudScriptId }).catch(() => {});
  const script = await client.call('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded',()=>{${ui}}, {once:true});` });
  client.hudScriptId = script.identifier;
  await client.evaluate(ui);
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('CDP target lookup failed');
  const list = await response.json();
  return list.filter(item => item.type === 'page' && item.url.startsWith('app://-/index.html') && !/avatar-overlay|mcp-app|sandbox|browser/i.test(decodeURIComponent(item.url)) && item.webSocketDebuggerUrl);
}
async function connectLoop() {
  let emptySince = null, lastIssue = null;
  while (!stopped) {
    try {
      const pages = await targets(); emptySince = null;
      const ids = new Set(pages.map(item => item.id));
      for (const [id, entry] of connections) if (!ids.has(id)) { entry.client.close(); connections.delete(id); }
      for (const page of pages) {
        const entry = connections.get(page.id);
        if (entry?.client.socket.readyState === WebSocket.OPEN) {
          const result = await entry.client.evaluate(`window.__codexComposerHUD?.state()`);
          if (!result) await setup(entry.client);
          continue;
        }
        entry?.client.close(); connections.delete(page.id);
        const client = await new CDP(page.webSocketDebuggerUrl).connect();
        try { await setup(client); connections.set(page.id, { client }); await log('Composer UI connected.'); }
        catch (error) { client.close(); throw error; }
      }
      if (lastIssue) await log('Connection recovered.'); lastIssue = null;
      await state({ status: connections.size ? 'connected' : 'waiting-for-window', port, windows: connections.size });
    } catch (error) {
      const issue = error.message;
      if (issue !== lastIssue) { await log(`Connection waiting: ${issue.split('\n')[0].slice(0, 150)}`); lastIssue = issue; }
      emptySince ||= Date.now();
      if (launched && Date.now() - emptySince > 15000) { await shutdown(); return; }
    }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
}
async function main() {
  if (args.has('--diagnose')) {
    const data = await inventory();
    console.log(JSON.stringify({ executable: await appPath(data), mainProcesses: (data.processes || []).length, regularProcesses: (data.processes || []).filter(item => !/--user-data-dir(?:=|\s)/.test(item.CommandLine || '')).length })); return;
  }
  if (args.has('--stop')) { if (!await rpcPipe('stop')) await log('No running HUD.'); return; }
  if (args.has('--status')) { console.log(await fs.readFile(path.join(stateRoot, 'status.json'), 'utf8').catch(() => 'Not running')); return; }
  if (await rpcPipe('ping')) { if (!args.has('--quiet')) await tell('사용량 표시기가 이미 실행 중입니다. Codex 모델 선택기 왼쪽의 사용량 표시를 확인하세요.'); return; }
  server = net.createServer(socket => { socket.on('data', bytes => { if (String(bytes) === 'stop') shutdown(); }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  if (attachIndex < 0) {
    let data = await inventory();
    let executable = await appPath(data);
    const managed = (data.processes || []).find(item => /--codex-composer-hud=[0-9a-f-]{36}/i.test(item.CommandLine || '') && /--remote-debugging-port=\d+/.test(item.CommandLine || ''));
    if (managed) {
      const existingPort = Number(managed.CommandLine.match(/--remote-debugging-port=(\d+)/)[1]);
      const ownsPort = await powershell(`@(Get-NetTCPConnection -State Listen -LocalPort ${existingPort} -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq ${Number(managed.ProcessId)} }).Count`);
      if (Number(ownsPort) > 0) {
        port = existingPort; launched = true;
        await log('Reconnected to the existing official Codex app.');
        await connectLoop(); return;
      }
    }
    // Let existing work finish. The program never force-quits the user's Codex app.
    let regular = (data.processes || []).filter(item => !/--user-data-dir(?:=|\s)/.test(item.CommandLine || ''));
    if (regular.length) {
      await state({ status: 'waiting-for-codex-exit' });
      if (!args.has('--quiet')) await tell('사용량 표시기를 준비했습니다. 현재 작업을 마친 뒤 Codex를 완전히 종료하세요. 종료되면 사용량 버튼이 추가된 Codex가 자동으로 열립니다. 창만 닫아 앱이 남아 있다면 파일 메뉴에서 종료하세요.');
      while (regular.length && !stopped) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        data = await inventory(); regular = (data.processes || []).filter(item => !/--user-data-dir(?:=|\s)/.test(item.CommandLine || ''));
      }
      if (stopped) return;
    }
    executable = await appPath(await inventory());
    port = await freePort();
    const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--codex-composer-hud=${crypto.randomUUID()}`], { windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', async error => { await log(`Codex launch failed: ${error.message}`); await shutdown(); });
    child.unref(); launched = true;
    await log('Official Codex launched with a loopback debugging port.');
  } else if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local debugging port');
  await connectLoop();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
main().catch(async error => {
  await log(`Error: ${error.message.split('\n')[0]}`);
  await state({ status: 'error', error: error.message.split('\n')[0] });
  if (!args.has('--quiet') && attachIndex < 0) await tell(error.message, true);
  await shutdown();
});
