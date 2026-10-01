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
import { findGuiProcesses, locateApp, debugPort, ownsDebugPort } from './lib/linux-platform.mjs';

const run = promisify(execFile), root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2)), argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const stateRoot = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'CodexComposerHUD');
const runtimeBase = process.env.XDG_RUNTIME_DIR || path.join(stateRoot, 'run');
const runtimeRoot = path.join(runtimeBase, 'codex-composer-hud');
const socketPath = path.join(runtimeRoot, 'control.sock');
let port = argument('--attach') ? Number(argument('--attach')) : null;
let stopped = false, server, socketIdentity, appTracked = false, exitCode = 0, failureMessage = null;
const connections = new Map();
const reader = new SessionReader(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const ui = (await fs.readFile(path.join(root, 'ui', 'metrics.js'), 'utf8')) + '\n' + (await fs.readFile(path.join(root, 'ui', 'composer-hud.js'), 'utf8'));
await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });

async function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (process.stdout.isTTY) process.stdout.write(line);
  const file = path.join(stateRoot, 'hud.log');
  try { if ((await fs.stat(file)).size > 256 * 1024) await fs.writeFile(file, '', { mode: 0o600 }); } catch {}
  await fs.appendFile(file, line, { mode: 0o600 }).catch(() => {});
}
async function tell(message, error = false) {
  await log(message);
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) await run('notify-send', ['--app-name=Codex Composer HUD', '--urgency=' + (error ? 'critical' : 'normal'), 'Codex Composer HUD', message], { timeout: 3000 }).catch(() => {});
  else process.stderr.write(message + '\n');
}
async function state(value) { await fs.writeFile(path.join(stateRoot, 'status.json'), JSON.stringify({ ...value, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 }); }
function control(command) {
  return new Promise(resolve => {
    const socket = net.connect(socketPath), timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
    socket.once('connect', () => { socket.end(command); clearTimeout(timer); resolve(true); });
  });
}
async function bindControl() {
  await fs.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.lstat(runtimeRoot);
  if (directory.isSymbolicLink() || !directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077)) throw new Error('개인 실행 디렉터리의 소유자와 권한을 확인하세요.');
  if (Buffer.byteLength(socketPath) > 100) throw new Error('실행 디렉터리 경로가 너무 깁니다. XDG_RUNTIME_DIR을 지정하세요.');
  server = net.createServer(socket => socket.on('data', bytes => { if (String(bytes) === 'stop') shutdown(); }));
  async function listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); }); }); }
  try { await listen(); }
  catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    if (await control('ping')) return false;
    const stale = await fs.lstat(socketPath);
    if (!stale.isSocket() || stale.uid !== process.getuid()) throw new Error('다른 파일과 겹치는 제어 경로는 변경하지 않습니다.');
    await fs.unlink(socketPath); await listen();
  }
  await fs.chmod(socketPath, 0o600); socketIdentity = await fs.lstat(socketPath); return true;
}
async function shutdown() {
  if (stopped) return; stopped = true;
  for (const { client } of connections.values()) {
    await client.evaluate('window.__codexComposerHUD?.dispose()').catch(() => {});
    if (client.hudScriptId) await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.hudScriptId }).catch(() => {});
    await client.call('Runtime.removeBinding', { name: '__codexComposerHUDRead' }).catch(() => {}); client.close();
  }
  connections.clear();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  try { const current = await fs.lstat(socketPath); if (socketIdentity && current.ino === socketIdentity.ino && current.dev === socketIdentity.dev && current.isSocket()) await fs.unlink(socketPath); } catch {}
  await state({ status: failureMessage ? 'error' : 'stopped', port, ...(failureMessage ? { error: failureMessage } : {}) }); await log('Stopped; injected UI removed.'); setTimeout(() => process.exit(exitCode), 50);
}
async function setup(client) {
  if (!client.hudBound) client.listeners.add(async message => {
    if (message.method !== 'Runtime.bindingCalled' || message.params.name !== '__codexComposerHUDRead') return;
    try { const snapshot = await reader.read(JSON.parse(message.params.payload)); await client.evaluate(`window.__codexComposerHUD?.acceptSnapshot(${JSON.stringify(snapshot)})`); } catch {}
  });
  client.hudBound = true;
  await client.call('Runtime.enable'); await client.call('Runtime.addBinding', { name: '__codexComposerHUDRead' });
  if (client.hudScriptId) await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.hudScriptId }).catch(() => {});
  client.hudScriptId = (await client.call('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded',()=>{${ui}}, {once:true});` })).identifier;
  await client.evaluate(ui);
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('CDP target lookup failed');
  return (await response.json()).filter(item => item.type === 'page' && (item.url.startsWith('app://-/index.html') || item.url.startsWith('app://codex/index.html')) && !/avatar-overlay|mcp-app|sandbox|browser/i.test(decodeURIComponent(item.url)) && item.webSocketDebuggerUrl);
}
async function connectLoop() {
  let disconnectedSince = null, lastIssue = null;
  while (!stopped) {
    try {
      const pages = await targets(); disconnectedSince = null;
      const ids = new Set(pages.map(page => page.id));
      for (const [id, entry] of connections) if (!ids.has(id)) { entry.client.close(); connections.delete(id); }
      for (const page of pages) {
        const entry = connections.get(page.id);
        if (entry?.client.socket.readyState === WebSocket.OPEN) { if (!await entry.client.evaluate('window.__codexComposerHUD?.state()')) await setup(entry.client); continue; }
        entry?.client.close(); connections.delete(page.id);
        const client = await new CDP(page.webSocketDebuggerUrl).connect();
        try { await setup(client); connections.set(page.id, { client }); await log('Composer UI connected.'); } catch (error) { client.close(); throw error; }
      }
      lastIssue = null; await state({ status: connections.size ? 'connected' : 'waiting-for-window', port, windows: connections.size });
    } catch (error) {
      if (lastIssue !== error.message) await log(`Connection waiting: ${error.message.split('\n')[0].slice(0, 160)}`);
      lastIssue = error.message; disconnectedSince ||= Date.now();
      if (appTracked && Date.now() - disconnectedSince > 45000) { await tell('앱 연결이 종료되었습니다. 앱 메뉴의 Codex Composer HUD로 다시 실행하세요.'); await shutdown(); return; }
    }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
}
async function main() {
  if (args.has('--stop')) { if (!await control('stop')) await log('No running HUD.'); return; }
  if (args.has('--status')) { console.log(await fs.readFile(path.join(stateRoot, 'status.json'), 'utf8').catch(() => 'Not running')); return; }
  if (args.has('--diagnose')) {
    const rows = await findGuiProcesses(); let executable = null, error = null;
    try { executable = await locateApp(rows, argument('--app')); } catch (issue) { error = issue.message; }
    console.log(JSON.stringify({ platform: process.platform, node: process.version, architecture: process.arch, executable, mainProcesses: rows.length, stateRoot, error })); return;
  }
  if (process.getuid() === 0) throw new Error('GUI 표시는 sudo 없이 일반 사용자 계정에서 실행하세요.');
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !port) throw new Error('Ubuntu 데스크톱에서 실행하세요. 기존 앱 연결은 --attach 포트를 사용합니다.');
  if (await control('ping')) { if (!args.has('--quiet')) await tell('사용량 표시기가 이미 실행 중입니다.'); return; }
  if (!await bindControl()) return;
  if (port) { if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local debugging port'); await connectLoop(); return; }
  let rows = await findGuiProcesses();
  let executable = await locateApp(rows, argument('--app'));
  for (const row of rows.filter(row => row.args.some(arg => /^--codex-composer-hud=[0-9a-f-]{36}$/i.test(arg)))) {
    const candidatePort = debugPort(row.args);
    if (candidatePort && await ownsDebugPort(row.pid, candidatePort)) { port = candidatePort; appTracked = true; await log('Reconnected to the existing desktop app.'); await connectLoop(); return; }
  }
  const regular = () => rows.filter(row => !row.args.some(arg => arg.startsWith('--user-data-dir=')));
  if (regular().length) {
    await state({ status: 'waiting-for-codex-exit' });
    if (!args.has('--quiet')) await tell('현재 작업을 마치고 ChatGPT/Codex 앱을 완전히 종료하면 사용량 표시가 포함된 앱이 열립니다.');
    while (regular().length && !stopped) { await new Promise(resolve => setTimeout(resolve, 3000)); rows = await findGuiProcesses(); }
    if (stopped) return;
  }
  executable = await locateApp(await findGuiProcesses(), argument('--app'));
  const listener = net.createServer(); await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--codex-composer-hud=${crypto.randomUUID()}`], { detached: true, stdio: 'ignore' });
  child.once('error', async error => { await tell(`앱 실행 실패: ${error.message}`, true); await shutdown(); }); child.unref(); appTracked = true;
  await log('Desktop app launched with a loopback debugging port.'); await connectLoop();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
main().catch(async error => { exitCode = 1; failureMessage = error.message; await tell(error.message, true); await shutdown(); });
