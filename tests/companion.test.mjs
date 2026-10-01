import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionPlan,applicationArguments} from '../lib/companion.mjs';
const regular={pid:1,executable:'/app',args:['/app']};
const managed={...regular,args:['/app','--remote-debugging-port=9333','--codex-composer-hud=11111111-2222-3333-4444-555555555555']};
test('automatic login mode waits without launching Codex',()=>assert.equal(connectionPlan([],false).kind,'wait'));
test('a normal shortcut activation launches only when Codex is absent',()=>{
  assert.equal(connectionPlan([],true).kind,'launch');assert.equal(connectionPlan([regular],true).kind,'wait-existing');
});
test('an existing managed app is reused and an unrelated test profile is left alone',()=>{
  assert.equal(connectionPlan([regular,managed],false).port,9333);
  assert.equal(connectionPlan([{...regular,args:['/app','--user-data-dir=/test']}],false).kind,'wait');
});
test('app URLs are forwarded without permitting debugging or profile option overrides',()=>{
  assert.deepEqual(applicationArguments(['--watch','--app-args','codex://threads/example']),['codex://threads/example']);
  assert.throws(()=>applicationArguments(['--app-args','--remote-debugging-address=0.0.0.0']),/연결 옵션/);
});
