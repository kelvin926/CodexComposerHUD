import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mainGuiArgs, debugPort, findGuiProcesses, ownsDebugPort, locateApp } from '../lib/linux-platform.mjs';

test('renderer processes and invalid CDP ports are excluded', () => {
  assert.equal(mainGuiArgs(['chatgpt','--type=renderer']),false);
  assert.equal(mainGuiArgs(['chatgpt','--type','renderer']),false);
  assert.equal(mainGuiArgs(['chatgpt','--remote-debugging-port=9333']),true);
  assert.equal(debugPort(['--remote-debugging-port=9333']),9333);
  assert.equal(debugPort(['--remote-debugging-port=0']),null);
});
test('Linux discovery requires the app archive and checks listener ownership', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hud-linux-'));
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const app=path.join(root,'app','chatgpt'),proc=path.join(root,'proc');
  await fs.mkdir(path.join(root,'app','resources'),{recursive:true});await fs.writeFile(app,'#!/bin/sh\nexit 0\n',{mode:0o755});await fs.writeFile(path.join(root,'app','resources','app.asar'),'fixture');
  for(const pid of ['10','11']) {await fs.mkdir(path.join(proc,pid,'fd'),{recursive:true});await fs.symlink(app,path.join(proc,pid,'exe'));}
  await fs.writeFile(path.join(proc,'10','cmdline'),`${app}\0--remote-debugging-port=9333\0`);
  await fs.writeFile(path.join(proc,'11','cmdline'),`${app}\0--type=renderer\0`);
  const rows=await findGuiProcesses(proc);assert.equal(rows.length,1);assert.equal(rows[0].pid,10);
  await fs.mkdir(path.join(proc,'net'));await fs.writeFile(path.join(proc,'net','tcp'),'header\n0: 0100007F:2475 00000000:0000 0A 0:0 00:0 0 1000 0 12345\n');await fs.symlink('socket:[12345]',path.join(proc,'10','fd','7'));
  assert.equal(await ownsDebugPort(10,9333,proc),true);assert.equal(await ownsDebugPort(11,9333,proc),false);
  assert.equal(await locateApp([],app,{PATH:''}),app);
});
