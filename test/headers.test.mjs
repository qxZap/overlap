// Local equivalent of `curl -I`: the dev server applies public/_headers the way Cloudflare does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('pages get the strict CSP, sw.js gets its own, _headers is not served', async (t) => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const srv = spawn(process.execPath, ['serve.mjs'], { cwd, env: { ...process.env, PORT: '0' } });
  t.after(() => srv.kill());
  const base = await new Promise((ok, fail) => {
    srv.stdout.on('data', d => { const m = /http:\/\/\S+/.exec(d); if (m) ok(m[0]); });
    srv.on('exit', fail);
  });

  const page = (await fetch(base + '/')).headers.get('content-security-policy');
  assert.match(page, /connect-src 'none'/);
  assert.match(page, /frame-ancestors 'none'/);

  const pair = await fetch(base + '/meeting-time/london-new-york/');
  assert.equal(pair.status, 200);
  assert.match(pair.headers.get('content-security-policy'), /script-src 'none'; connect-src 'none'/);
  assert.match(pair.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(pair.headers.get('x-content-type-options'), 'nosniff');

  const sw = (await fetch(base + '/sw.js')).headers.get('content-security-policy');
  assert.match(sw, /connect-src 'self'/);
  assert.doesNotMatch(sw, /connect-src 'none'/, 'page CSP must not stack onto sw.js');

  assert.equal((await fetch(base + '/_headers')).status, 404);
});
