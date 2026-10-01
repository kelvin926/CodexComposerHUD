import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {redirectDesktop,configurePosixAuto} from '../lib/posix-auto.mjs';
test('desktop integration preserves arguments and excludes a web app with the same name',()=>{
  assert.match(redirectDesktop('[Desktop Entry]\nName=ChatGPT\nExec=/usr/bin/chatgpt %U\n','hud'),/Exec=hud --app-args %U/);
  assert.equal(redirectDesktop('[Desktop Entry]\nName=ChatGPT\nExec=chrome --app=https://chatgpt.com\n','hud'),null);
  const vendor='[Desktop Entry]\nName=Codex\nIcon=/opt/Codex/resources/codex.png\nExec=/usr/bin/codex-desktop %U\n';
  const redirected=redirectDesktop(vendor,'hud');
  assert.match(redirected,/^Name=Codex$/m);assert.match(redirected,/^Icon=\/opt\/Codex\/resources\/codex.png$/m);
});
test('automatic launch entries are restored on disable and later user edits are preserved',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hud-auto-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const home=path.join(directory,'home'),system=path.join(directory,'system'),state=path.join(directory,'state');await fs.mkdir(system,{recursive:true});
  const original='[Desktop Entry]\nName=ChatGPT\nExec=chatgpt %U\n';await fs.writeFile(path.join(system,'chatgpt.desktop'),original);
  const args={root:directory,stateRoot:state,home,environment:{},systemApplications:system};
  await configurePosixAuto({...args,enabled:true});const user=path.join(home,'.local/share/applications/chatgpt.desktop');
  assert.match(await fs.readFile(user,'utf8'),/codex-composer-hud --app-args %U/);
  await configurePosixAuto({...args,enabled:false});await assert.rejects(fs.access(user));
  await configurePosixAuto({...args,enabled:true});await fs.writeFile(user,original+'# user edit\n');
  await configurePosixAuto({...args,enabled:false});assert.match(await fs.readFile(user,'utf8'),/# user edit/);
});
