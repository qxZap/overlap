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
// The generated meeting time pages are cached when opened, not precached; test/pages.test.mjs covers them.
const app = files.filter(f => !f.startsWith('meeting-time/'));

test('service worker precaches exactly the app files in public/', () => {
  const sw = readFileSync(join(pub, 'sw.js'), 'utf8');
  const list = JSON.parse(/const FILES = (\[[\s\S]*?\]);/.exec(sw)[1]);
  assert.deepEqual(list.map(f => (f === './' ? 'index.html' : f)).sort(), app.filter(f => f !== '_headers' && f !== 'sw.js').sort());
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
  // JSON-LD is a data block the browser never executes, so the CSP allows it.
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)(?![^>]*type="application\/ld\+json")[^>]*>/i);
  assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i);
  // Page scripts run under connect-src 'none'. (sw.js has its own CSP and may fetch same origin.)
  for (const f of files.filter(f => f.startsWith('js/'))) {
    assert.doesNotMatch(readFileSync(join(pub, f), 'utf8'), /\bfetch\(|XMLHttpRequest|setAttribute\('style'|innerHTML/, f);
  }
});

test('structured data parses and the FAQPage matches the visible FAQ word for word', () => {
  const html = readFileSync(join(pub, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.ok(blocks.some(b => b['@type'] === 'WebApplication'));
  const faq = blocks.find(b => b['@type'] === 'FAQPage');
  const text = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const section = html.slice(html.indexOf('id="faq"'), html.indexOf('</section>', html.indexOf('id="faq"')));
  const visible = [...section.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(m => [text(m[1]), text(m[2])]);
  assert.ok(visible.length >= 6);
  assert.deepEqual(faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]), visible);
});

test('page weight under 300 KB gzipped, excluding city data', () => {
  const page = app.filter(f => !['js/cities.js', 'og.png', '_headers', 'robots.txt'].includes(f));
  const bytes = page.reduce((sum, f) => sum + gzipSync(readFileSync(join(pub, f))).length, 0);
  assert.ok(bytes < 300_000, `${bytes} bytes`);
});
