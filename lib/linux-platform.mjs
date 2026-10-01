import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export function mainGuiArgs(args) { return !args.some(arg => arg === '--type' || arg.startsWith('--type=')); }
export function debugPort(args) {
  const value = args.find(arg => arg.startsWith('--remote-debugging-port='));
  const port = Number(value?.split('=')[1]);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}
export async function findGuiProcesses(procRoot = '/proc', uid = process.getuid?.()) {
  const result = [];
  for (const pid of (await fs.readdir(procRoot)).filter(name => /^\d+$/.test(name))) {
    try {
      const directory = path.join(procRoot, pid), owner = await fs.stat(directory);
      if (uid !== undefined && owner.uid !== uid) continue;
      const executable = await fs.readlink(path.join(directory, 'exe'));
      const args = (await fs.readFile(path.join(directory, 'cmdline'), 'utf8')).split('\0').filter(Boolean);
      if (!mainGuiArgs(args)) continue;
      const name = path.basename(executable).toLowerCase();
      if (!/^(chatgpt|codex|codex-desktop)(-.*)?$/.test(name) && !/(chatgpt|codex)\//i.test(executable)) continue;
      await fs.access(path.join(path.dirname(executable), 'resources', 'app.asar'));
      result.push({ pid: Number(pid), executable, args });
    } catch { /* Inaccessible or vanished processes are not app candidates. */ }
  }
  return result;
}
export async function locateApp(rows, explicit, environment = process.env) {
  const candidates = [explicit, environment.CODEX_APP_PATH, ...rows.map(row => row.executable)];
  for (const folder of (environment.PATH || '').split(path.delimiter)) for (const name of ['chatgpt', 'codex-desktop', 'ChatGPT']) candidates.push(path.join(folder, name));
  for (const candidate of candidates.filter(Boolean)) {
    if (!path.isAbsolute(candidate)) continue;
    try { const actual = await fs.realpath(candidate); await fs.access(actual, constants.X_OK); return actual; } catch {}
  }
  throw new Error('ChatGPT/Codex Linux 앱을 찾을 수 없습니다. 공식 앱을 설치하거나 --app /절대/경로를 지정하세요.');
}
export async function ownsDebugPort(pid, port, procRoot = '/proc') {
  if (!Number.isInteger(pid) || !Number.isInteger(port)) return false;
  try {
    const table = await fs.readFile(path.join(procRoot, 'net', 'tcp'), 'utf8');
    const local = `0100007F:${port.toString(16).toUpperCase().padStart(4, '0')}`;
    const inodes = new Set(table.split('\n').map(line => line.trim().split(/\s+/)).filter(fields => fields[1] === local && fields[3] === '0A').map(fields => fields[9]));
    if (!inodes.size) return false;
    for (const fd of await fs.readdir(path.join(procRoot, String(pid), 'fd'))) {
      try { const link = await fs.readlink(path.join(procRoot, String(pid), 'fd', fd)); if (inodes.has(link.match(/^socket:\[(\d+)\]$/)?.[1])) return true; } catch {}
    }
  } catch {}
  return false;
}
