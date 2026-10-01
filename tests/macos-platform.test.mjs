import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGuiProcesses, loopbackListener, debugPort } from '../lib/macos-platform.mjs';
test('macOS selects the current user main process and handles bundle paths with spaces',()=>{
  const text='501 10 /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9333 --codex-composer-hud=11111111-2222-3333-4444-555555555555\n501 11 /Applications/Codex.app/Contents/MacOS/Codex --type=renderer\n502 12 /Applications/Codex.app/Contents/MacOS/Codex\n501 13 /Users/user/Apps with spaces/ChatGPT.app/Contents/MacOS/ChatGPT';
  const rows=parseGuiProcesses(text,501);assert.deepEqual(rows.map(r=>r.pid),[10,13]);assert.equal(debugPort(rows[0].args),9333);assert.match(rows[1].executable,/Apps with spaces/);
});
test('macOS connection reuse requires a loopback listener rather than a public port',()=>{
  assert.equal(loopbackListener('p10\nn127.0.0.1:9333\n',9333),true);
  assert.equal(loopbackListener('p10\nn*:9333\n',9333),false);
  assert.equal(loopbackListener('n127.0.0.1:9444',9333),false);
});
