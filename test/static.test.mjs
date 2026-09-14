import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = walk(pub).map(f => relative(pub, f).replaceAll('\\', '/'));

test('service worker precaches exactly the files in public/', () => {
  const sw = readFileSync(join(pub, 'sw.js'), 'utf8');
  const list = JSON.parse(/const FILES = (\[[\s\S]*?\]);/.exec(sw)[1]);
  assert.deepEqual(list.map(f => (f === './' ? 'index.html' : f)).sort(), files.filter(f => f !== '_headers' && f !== 'sw.js').sort());
});

test('no en or em dashes in public/, README or notices', () => {
  const dash = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  const paths = [...files.filter(f => !f.endsWith('.png')).map(f => join(pub, f)), join(root, 'README.md'), join(root, 'THIRD_PARTY_NOTICES')];
  for (const path of paths) {
    const text = readFileSync(path, 'utf8');
    if (!dash.test(text)) continue;
    const line = text.split('\n').findIndex(l => dash.test(l)) + 1;
    assert.fail(`${relative(root, path)}:${line} contains an en or em dash`);
  }
});

test('page markup stays inside the CSP: no inline scripts, styles or handlers', () => {
  const html = readFileSync(join(pub, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i);
  assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i);
  // Page scripts run under connect-src 'none'. (sw.js has its own CSP and may fetch same origin.)
  for (const f of files.filter(f => f.startsWith('js/'))) {
    assert.doesNotMatch(readFileSync(join(pub, f), 'utf8'), /\bfetch\(|XMLHttpRequest|setAttribute\('style'|innerHTML/, f);
  }
});

test('page weight under 300 KB gzipped, excluding city data', () => {
  const page = files.filter(f => !['js/cities.js', 'og.png', '_headers', 'robots.txt'].includes(f));
  const bytes = page.reduce((sum, f) => sum + gzipSync(readFileSync(join(pub, f))).length, 0);
  assert.ok(bytes < 300_000, `${bytes} bytes`);
});
