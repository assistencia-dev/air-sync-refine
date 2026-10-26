import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', '8091', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Vite startup timeout: ' + log.slice(-1600))), 30000);
    child.stdout.on('data', chunk => {
      log += chunk;
      if (log.includes('http://127.0.0.1:8091')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(Error('Vite exited: ' + code + '\n' + log.slice(-1600))); });
  });
  for (const path of [
    '/node_modules/@tanstack/react-router/dist/esm/ScriptOnce.js?v=9414a7c0',
    '/node_modules/@tanstack/react-router/dist/esm/HeadContent.js?v=9414a7c0',
    '/module-recovery.js?v=20261026-1',
    '/login',
  ]) {
    const response = await fetch('http://127.0.0.1:8091' + path, { signal: AbortSignal.timeout(30000) });
    const body = await response.text();
    assert.equal(response.status, 200, `${path}: ${body.slice(0, 500)}`);
    if (path.endsWith('/login')) {
      assert.ok(body.includes('/module-recovery.js?v=20261026-1'));
      assert.ok(body.includes('data-preview="true"'));
    } else {
      assert.match(response.headers.get('content-type'), /javascript/);
    }
    console.log('Preview import HTTP 200:', path);
  }
} finally {
  child.kill('SIGTERM');
}
