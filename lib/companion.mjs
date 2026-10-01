import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {CDP} from './cdp.mjs';
import {SessionReader} from './sessions.mjs';
import {debugPort} from './linux-platform.mjs';

export function connectionPlan(rows, activate) {
  const managed=rows.find(row=>row.args.some(arg=>/^--codex-composer-hud=[0-9a-f-]{36}$/i.test(arg))&&debugPort(row.args));
  if(managed)return {kind:'connect',row:managed,port:debugPort(managed.args)};
  const regular=rows.filter(row=>!row.args.some(arg=>arg.startsWith('--user-data-dir=')));
  return {kind:regular.length?'wait-existing':activate?'launch':'wait',regular};
}
export function applicationArguments(argv) {
  const marker=argv.indexOf('--app-args');
  const result=marker<0?[]:argv.slice(marker+1);
  if(result.some(arg=>/^--(?:remote-debugging|inspect|user-data-dir|codex-composer-hud)/.test(arg)))throw Error('표시기의 연결 옵션은 앱 전달 인수로 사용할 수 없습니다.');
  return result;
}
export async function runCompanion(platform, root, options={}) {
  const argv=process.argv.slice(2),marker=argv.indexOf('--app-args'),own=marker<0?argv:argv.slice(0,marker),flags=new Set(own),watch=flags.has('--watch'),quiet=flags.has('--quiet');
  const argument=name=>{const index=own.indexOf(name);return index<0?null:own[index+1];};
  const stateRoot=platform.stateRoot,controlPath=platform.controlPath;
  await fs.mkdir(stateRoot,{recursive:true,mode:0o700});
  const ui=(await fs.readFile(path.join(root,'ui/metrics.js'),'utf8'))+'\n'+(await fs.readFile(path.join(root,'ui/composer-hud.js'),'utf8'));
  const reader=new SessionReader(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
  const connections=new Map(),queue=[];
  let stopped=false,server,identity,port=null,wake,exitCode=0,lastMessage=null;
  const state=async value=>fs.writeFile(path.join(stateRoot,'status.json'),JSON.stringify({...value,automatic:watch,pid:process.pid,updatedAt:new Date().toISOString()},null,2),{mode:0o600});
  async function log(message){const file=path.join(stateRoot,'hud.log');try{if((await fs.stat(file)).size>256*1024)await fs.writeFile(file,'');}catch{}await fs.appendFile(file,new Date().toISOString()+' '+message+'\n',{mode:0o600}).catch(()=>{});}
  async function tell(message){await log(message);if(!quiet)await platform.tell(message);}
  function control(message){return new Promise(resolve=>{const socket=net.connect(controlPath),timer=setTimeout(()=>{socket.destroy();resolve(false);},1500);socket.once('error',()=>{clearTimeout(timer);resolve(false);});socket.once('connect',()=>{socket.end(message);clearTimeout(timer);resolve(true);});});}
  async function clearConnections(remove=true){
    for(const {client}of connections.values()){
      if(remove)await client.evaluate('window.__codexComposerHUD?.dispose()').catch(()=>{});
      if(client.hudScriptId)await client.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:client.hudScriptId}).catch(()=>{});
      await client.call('Runtime.removeBinding',{name:'__codexComposerHUDRead'}).catch(()=>{});client.close();
    }
    connections.clear();
  }
  async function shutdown(){
    if(stopped)return;stopped=true;wake?.();await clearConnections();
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    if(platform.unix)try{const now=await fs.lstat(controlPath);if(identity&&now.ino===identity.ino&&now.dev===identity.dev&&now.isSocket())await fs.unlink(controlPath);}catch{}
    await state({status:exitCode?'error':'stopped',port});await log('Stopped; injected UI removed.');
    setTimeout(()=>process.exit(exitCode),50);
  }
  function idle(ms){return new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},ms);wake=()=>{clearTimeout(timer);wake=null;resolve();};});}
  function activate(args){queue.push(args);wake?.();}
  async function bind(){
    if(platform.unix){const dir=path.dirname(controlPath);await fs.mkdir(dir,{recursive:true,mode:0o700});const info=await fs.lstat(dir);if(info.isSymbolicLink()||!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o077))throw Error('개인 제어 디렉터리의 소유자와 권한을 확인하세요.');if(Buffer.byteLength(controlPath)>100)throw Error('제어 소켓 경로가 너무 깁니다.');}
    server=net.createServer(socket=>{let text='';socket.on('data',bytes=>{text+=String(bytes);if(text.length>65536)socket.destroy();});socket.on('end',()=>{
      if(text==='stop'){shutdown();return;}
      if(text==='ping')return;
      try{const message=JSON.parse(text);if(message.command==='launch'&&Array.isArray(message.args)&&message.args.every(v=>typeof v==='string'))activate(applicationArguments(['--app-args',...message.args]));}catch{}
    });});
    async function listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(controlPath,()=>{server.removeListener('error',reject);resolve();});});}
    try{await listen();}catch(error){if(!platform.unix||error.code!=='EADDRINUSE')throw error;if(await control('ping'))return false;const old=await fs.lstat(controlPath);if(!old.isSocket()||old.uid!==process.getuid())throw Error('다른 파일과 겹치는 제어 경로는 변경하지 않습니다.');await fs.unlink(controlPath);await listen();}
    if(platform.unix){await fs.chmod(controlPath,0o600);identity=await fs.lstat(controlPath);}return true;
  }
  async function setup(client){
    if(!client.hudBound)client.listeners.add(async message=>{
      if(message.method!=='Runtime.bindingCalled'||message.params.name!=='__codexComposerHUDRead')return;
      try{const snapshot=await reader.read(JSON.parse(message.params.payload));await client.evaluate(`window.__codexComposerHUD?.acceptSnapshot(${JSON.stringify(snapshot)})`);}catch{}
    });
    client.hudBound=true;await client.call('Runtime.enable');await client.call('Runtime.addBinding',{name:'__codexComposerHUDRead'});
    if(client.hudScriptId)await client.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:client.hudScriptId}).catch(()=>{});
    client.hudScriptId=(await client.call('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{${ui}},{once:true});`})).identifier;
    await client.evaluate(ui);
  }
  function launch(executable,args,managed=false){
    const extra=managed?['--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--codex-composer-hud=${crypto.randomUUID()}`]:[];
    const child=spawn(executable,[...extra,...args],{windowsHide:true,detached:true,stdio:'ignore'});
    child.once('error',error=>{log('App launch failed: '+error.message);});child.unref();
  }
  async function connect(executable){
    let failureAt=null,ready=false;
    while(!stopped){
      while(queue.length)launch(executable||await platform.locate(await platform.processes()),queue.shift());
      try{
        const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2500)});
        if(!response.ok)throw Error('CDP target lookup failed');
        const pages=(await response.json()).filter(p=>p.type==='page'&&/^app:\/\/(?:-|codex)\/(?:index|detached-window)\.html/.test(p.url)&&!/avatar-overlay|mcp-app|sandbox|browser/i.test(decodeURIComponent(p.url))&&p.webSocketDebuggerUrl);
        const ids=new Set(pages.map(p=>p.id));
        for(const [id,{client}]of connections)if(!ids.has(id)){client.close();connections.delete(id);}
        for(const page of pages){
          const existing=connections.get(page.id);
          if(existing?.client.socket.readyState===WebSocket.OPEN){if(!await existing.client.evaluate('window.__codexComposerHUD?.state()'))await setup(existing.client);continue;}
          existing?.client.close();const client=await new CDP(page.webSocketDebuggerUrl).connect();
          try{await setup(client);connections.set(page.id,{client});}catch(error){client.close();throw error;}
        }
        ready=true;failureAt=null;lastMessage=null;await state({status:connections.size?'connected':'waiting-for-window',port,windows:connections.size});
      }catch(error){
        failureAt||=Date.now();if(lastMessage!==error.message){await log('Connection waiting: '+error.message.split('\n')[0].slice(0,150));lastMessage=error.message;}
        await state({status:'reconnecting',port,windows:connections.size});
        if(Date.now()-failureAt>(ready?10000:45000)){await clearConnections(false);port=null;return;}
      }
      await idle(2500);
    }
  }
  async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const value=s.address().port;await new Promise(resolve=>s.close(resolve));return value;}
  try{
    if(flags.has('--stop')){await control('stop');return;}
    if(flags.has('--status')){console.log(await fs.readFile(path.join(stateRoot,'status.json'),'utf8').catch(()=>'Not running'));return;}
    if(flags.has('--diagnose')){const rows=await platform.processes();let executable=null,error=null;try{executable=await platform.locate(rows,argument('--app'));}catch(e){error=e.message;}console.log(JSON.stringify({platform:process.platform,node:process.version,architecture:process.arch,executable,mainProcesses:rows.length,stateRoot,error}));return;}
    if(flags.has('--disable-auto')){await platform.disableAuto?.();await control('stop');return;}
    if(flags.has('--enable-auto'))await platform.enableAuto?.();
    if(!watch||flags.has('--launch'))activate(applicationArguments(argv));
    if(await control('ping')){if(queue.length)await control(JSON.stringify({command:'launch',args:queue.shift()}));return;}
    if(process.getuid?.()===0)throw Error('일반 사용자 계정에서 표시기를 실행하세요.');
    if(!await bind())return;
    process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
    if(argument('--attach')){port=Number(argument('--attach'));if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local debugging port');queue.length=0;await connect(null);await shutdown();return;}
    let warned=false;
    while(!stopped){
      const rows=await platform.processes(),plan=connectionPlan(rows,queue.length>0);
      if(plan.kind==='connect'&&await platform.ownsPort(plan.row.pid,plan.port)){
        port=plan.port;await connect(plan.row.executable);warned=false;if(!watch&&!queue.length){await shutdown();return;}continue;
      }
      if(plan.kind==='launch'){
        const executable=await platform.locate(rows,argument('--app'));port=await freePort();launch(executable,queue.shift(),true);await connect(executable);if(!watch&&!queue.length){await shutdown();return;}continue;
      }
      if(plan.kind==='wait-existing'||plan.kind==='connect'){
        await state({status:'waiting-for-codex-exit',port:null});
        if(queue.length&&!warned){warned=true;await tell('현재 작업을 마친 뒤 Codex를 완전히 종료하세요. 자동 연결 실행기로 사용량 표시가 포함된 앱을 엽니다. 작업 중인 앱은 강제로 종료하지 않습니다.');}
      }else await state({status:'waiting-for-codex',port:null});
      await idle(5000);
    }
  }catch(error){exitCode=1;await tell(error.message);await log('Error: '+error.message);await shutdown();}
}
