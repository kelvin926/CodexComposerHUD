import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export { debugPort } from './linux-platform.mjs';
const run=promisify(execFile);

export function parseGuiProcesses(text, uid) {
  const result=[];
  for(const line of text.split('\n')) {
    const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if(!match || Number(match[1])!==uid)continue;
    const command=match[3];
    if(/(?:^|\s)--type(?:=|\s)/.test(command))continue;
    const binary=command.match(/^"?(\/.*?\/(?:Codex|ChatGPT)\.app\/Contents\/MacOS\/(?:Codex|ChatGPT|codex|chatgpt))"?(?:\s|$)/);
    if(!binary)continue;
    // Only our flags are needed; parsing arbitrary shell syntax is unnecessary.
    const args=[binary[1],...(command.slice(binary[0].length).match(/--[\w-]+(?:=[^\s]+)?/g)||[])];
    result.push({pid:Number(match[2]),executable:binary[1],args});
  }
  return result;
}
export async function findGuiProcesses() {
  const {stdout}=await run('/bin/ps',['-axo','uid=,pid=,args='],{timeout:5000,maxBuffer:2*1024*1024});
  const rows=parseGuiProcesses(stdout,process.getuid());
  const valid=[];
  for(const row of rows)try{await fs.access(path.join(path.dirname(row.executable),'../Resources/app.asar'));valid.push(row);}catch{}
  return valid;
}
export async function locateApp(rows, explicit, environment=process.env) {
  const candidates=[explicit,environment.CODEX_APP_PATH,...rows.map(r=>r.executable)];
  for(const folder of ['/Applications',path.join(os.homedir(),'Applications')])for(const name of ['Codex','ChatGPT'])candidates.push(path.join(folder,name+'.app','Contents/MacOS',name));
  for(const file of candidates.filter(Boolean)) {
    if(!path.isAbsolute(file))continue;
    try{const actual=await fs.realpath(file);await fs.access(actual,constants.X_OK);await fs.access(path.join(path.dirname(actual),'../Resources/app.asar'));return actual;}catch{}
  }
  throw new Error('Codex 데스크톱 앱을 찾을 수 없습니다. 공식 앱을 설치하거나 --app 실행파일의절대경로를 지정하세요.');
}
export function loopbackListener(text, port) { return text.split('\n').some(line=>line===`n127.0.0.1:${port}` || line===`n[::1]:${port}`); }
export async function ownsDebugPort(pid, port) {
  if(!Number.isInteger(pid)||!Number.isInteger(port)||port<1024||port>65535)return false;
  try{const {stdout}=await run('/usr/sbin/lsof',['-nP','-a','-p',String(pid),'-iTCP:'+port,'-sTCP:LISTEN','-F','n'],{timeout:5000});return loopbackListener(stdout,port);}catch{return false;}
}
