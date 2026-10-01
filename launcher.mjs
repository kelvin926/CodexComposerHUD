import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runCompanion} from './lib/companion.mjs';

const run=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
async function powershell(script){
  const encoded=Buffer.from('[Console]::OutputEncoding = [Text.Encoding]::UTF8; '+script,'utf16le').toString('base64');
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:15000,maxBuffer:1024*1024,encoding:'utf8'});
  return stdout.replace(/^\uFEFF/,'').trim();
}
let packageRoot=null;
async function processes(){
  const result=JSON.parse(await powershell(`$p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; $rows=@(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'" | Where-Object { $_.CommandLine -notmatch '--type(?:=|\\s)' -and $_.ExecutablePath -and ($_.ExecutablePath -match 'OpenAI\\.Codex_' -or $_.ExecutablePath -match '\\\\Codex\\\\') -and (Test-Path -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($_.ExecutablePath)) 'resources\\app.asar')) } | Select-Object ProcessId,ExecutablePath,CommandLine); [pscustomobject]@{packageRoot=$p.InstallLocation;processes=$rows} | ConvertTo-Json -Depth 4 -Compress`));
  packageRoot=result.packageRoot;
  return (result.processes||[]).map(p=>({pid:p.ProcessId,executable:p.ExecutablePath,args:[p.ExecutablePath,...(p.CommandLine.match(/--[\w-]+(?:=[^\s]+)?/g)||[])]}));
}
async function locate(rows,explicit){
  for(const file of [explicit,process.env.CODEX_APP_PATH,...rows.map(p=>p.executable),packageRoot&&path.join(packageRoot,'app/ChatGPT.exe')].filter(Boolean)){
    try{const actual=await fs.realpath(file);await fs.access(path.join(path.dirname(actual),'resources/app.asar'));return actual;}catch{}
  }
  throw Error('Microsoft Store Codex 앱을 찾을 수 없습니다.');
}
async function ownsPort(pid,port){return Number(await powershell(`@(Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq ${Number(pid)} }).Count`))>0;}
async function tell(message){const literal="'"+message.replace(/'/g,"''")+"'";await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(${literal},'Codex Composer HUD') | Out-Null`).catch(()=>{});}
const support=command=>run(path.join(root,'Codex Composer HUD.exe'),[command],{windowsHide:true,timeout:10000});
await runCompanion({
  stateRoot:path.join(process.env.LOCALAPPDATA||root,'CodexComposerHUD'),
  controlPath:`\\\\.\\pipe\\codex-composer-hud-${crypto.createHash('sha256').update(os.homedir()).digest('hex').slice(0,16)}`,
  processes,locate,ownsPort,tell,
  enableAuto:()=>support('--configure-auto'),disableAuto:()=>support('--remove-auto'),
},root);
