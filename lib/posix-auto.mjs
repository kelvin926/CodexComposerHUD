import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
export function redirectDesktop(text, launcher) {
  const entry=text.match(/^Exec=(.*)$/m);
  if(!entry)return null;
  const match=entry[1].match(/^("[^"]+"|\S+)(.*)$/);
  if(!match||!/(?:^|\/)(?:chatgpt|codex-desktop|Codex|ChatGPT)$/.test(match[1].replace(/^"|"$/g,''))||/--(?:remote-debugging|user-data-dir|inspect|codex-composer-hud)/.test(match[2]))return null;
  return text.replace(/^Exec=.*$/m,`Exec=${launcher} --app-args${match[2]}`)+'\nX-CodexComposerHUD-Automatic=true\n';
}
export async function configurePosixAuto({enabled,root,stateRoot,home,environment,systemApplications='/usr/share/applications'}) {
  const data=environment.XDG_DATA_HOME||path.join(home,'.local/share');
  const config=environment.XDG_CONFIG_HOME||path.join(home,'.config');
  const applications=path.join(data,'applications'),autostart=path.join(config,'autostart');
  const manifestFile=path.join(stateRoot,'automatic-desktops.json'),disabled=path.join(stateRoot,'automatic-disabled');
  await fs.mkdir(stateRoot,{recursive:true,mode:0o700});
  let manifest={};try{manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!enabled){
    for(const [file,record]of Object.entries(manifest)){
      if(path.dirname(file)!==applications&&path.dirname(file)!==autostart)continue;
      let current;try{current=await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(hash(current)!==record.installedHash)continue;
      if(record.previous===null)await fs.unlink(file);else await fs.writeFile(file,record.previous,{mode:0o644});
    }
    await fs.writeFile(disabled,'disabled\n',{mode:0o600});return;
  }
  await fs.unlink(disabled).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await fs.mkdir(applications,{recursive:true});await fs.mkdir(autostart,{recursive:true});
  const install=async(file,content)=>{
    let previous=null;try{const info=await fs.lstat(file);if(info.isSymbolicLink())return;previous=await fs.readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    const old=manifest[file];
    if(old&&previous!==null&&hash(previous)!==old.installedHash)return;
    manifest[file]={previous:old?old.previous:previous,installedHash:hash(content)};
    await fs.writeFile(file,content,{mode:0o644});
  };
  let names=[];try{names=await fs.readdir(systemApplications);}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const name of names.filter(n=>n.endsWith('.desktop'))){
    const vendor=await fs.readFile(path.join(systemApplications,name),'utf8');
    let base=vendor;const userFile=path.join(applications,name);
    try{const user=await fs.readFile(userFile,'utf8');base=manifest[userFile]?vendor:user;}catch(error){if(error.code!=='ENOENT')throw error;}
    const redirected=redirectDesktop(base,'/usr/bin/codex-composer-hud');
    if(redirected)await install(userFile,redirected);
  }
  const start='[Desktop Entry]\nType=Application\nName=Codex Composer HUD automatic connection\nExec=/usr/bin/codex-composer-hud --watch --quiet\nTerminal=false\nX-GNOME-Autostart-enabled=true\nX-CodexComposerHUD-Automatic=true\n';
  await install(path.join(autostart,'codex-composer-hud.desktop'),start);
  await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2),{mode:0o600});
}
