import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runCompanion} from './lib/companion.mjs';
import {configurePosixAuto} from './lib/posix-auto.mjs';
const mac=process.platform==='darwin',run=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
const platform=await import(mac?'./lib/macos-platform.mjs':'./lib/linux-platform.mjs');
const stateRoot=path.join(mac?path.join(os.homedir(),'Library/Application Support'):process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local/state'),'CodexComposerHUD');
const runtimeRoot=mac?path.join('/tmp',`codex-composer-hud-${process.getuid()}`):path.join(process.env.XDG_RUNTIME_DIR||path.join(stateRoot,'run'),'codex-composer-hud');
async function configure(enabled){
  if(mac){const app=root.slice(0,root.lastIndexOf('/Contents/'));await run(path.join(app,'Contents/MacOS/CodexComposerHUD'),[enabled?'--install-auto':'--remove-auto'],{timeout:10000});}
  else await configurePosixAuto({enabled,root,stateRoot,home:os.homedir(),environment:process.env});
}
async function tell(message){
  if(mac)await run('/usr/bin/osascript',['-e','on run argv\n display dialog (item 1 of argv) with title "Codex Composer HUD" buttons {"확인"} default button 1\nend run',message],{timeout:60000}).catch(()=>{});
  else if(process.env.DISPLAY||process.env.WAYLAND_DISPLAY)await run('notify-send',['--app-name=Codex Composer HUD','Codex Composer HUD',message],{timeout:3000}).catch(()=>{});
  else process.stderr.write(message+'\n');
}
if(!mac&&process.getuid()!==0&&!['--diagnose','--status','--stop','--attach','--disable-auto'].some(flag=>process.argv.includes(flag))){
  const disabled=await fs.access(path.join(stateRoot,'automatic-disabled')).then(()=>true,()=>false);
  if(disabled&&process.argv.includes('--watch')&&!process.argv.includes('--enable-auto'))process.exit(0);
  if(!disabled||process.argv.includes('--enable-auto')){
    if(!process.env.DISPLAY&&!process.env.WAYLAND_DISPLAY)throw Error('Ubuntu 데스크톱 세션에서 자동 연결을 실행하세요.');
    await configure(true);
  }
}
await runCompanion({stateRoot,controlPath:path.join(runtimeRoot,'control.sock'),unix:true,processes:platform.findGuiProcesses,locate:platform.locateApp,ownsPort:platform.ownsDebugPort,tell,enableAuto:()=>configure(true),disableAuto:()=>configure(false)},root);
