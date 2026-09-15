// The meeting time pages are generated from tz.js and committed. These tests hold the committed files
// to the generator, so a page can never drift from the engine the app runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildSite, pairList, pageData, CITIES } from '../tools/pages-lib.mjs';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(f => (f.isDirectory() ? walk(join(dir, f.name)) : [join(dir, f.name)]));
// Pages describe the year they were built in, and the sitemap records the build date.
const today = /<lastmod>(\d{4}-\d\d-\d\d)<\/lastmod>/.exec(readFileSync(join(pub, 'sitemap.xml'), 'utf8'))[1];
const site = buildSite(today);
const pages = [...site].filter(([path]) => path.endsWith('.html'));
const unescape = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pair = (slug, year = 2026) => pageData(pairList(year).find(p => p.slug === slug), year);

test('committed pages and sitemap are exactly what the generator makes from tz.js', () => {
  const committed = walk(join(pub, 'meeting-time')).map(f => relative(pub, f).replaceAll('\\', '/'));
  assert.deepEqual(committed.sort(), [...site.keys()].filter(p => p.startsWith('meeting-time/')).sort(), 'run npm run pages');
  for (const [path, text] of site) assert.ok(readFileSync(join(pub, path), 'utf8') === text, `${path} is out of date: run npm run pages`);
});

test('one page per pair of cities that do not share a clock, slugs in alphabetical order', () => {
  const all = pairList(Number(today.slice(0, 4)));
  assert.ok(all.length >= 150 && all.length <= 250, `${all.length} pairs`);
  assert.equal(new Set(all.map(p => p.path)).size, all.length);
  assert.equal(new Set(CITIES.map(c => c.slug)).size, CITIES.length);
  for (const p of all) assert.ok(p.a.slug < p.b.slug && /^\/meeting-time\/[a-z0-9-]+\/$/.test(p.path), p.path);
  const slugs = new Set(all.map(p => p.slug));
  for (const s of ['london-new-york', 'london-singapore', 'sao-paulo-tokyo']) assert.ok(slugs.has(s), s);
  for (const s of ['berlin-paris', 'new-york-toronto', 'hong-kong-singapore', 'bangalore-mumbai']) assert.ok(!slugs.has(s), `${s} share a clock all year`);
});

test('titles 50 to 60 characters, descriptions 140 to 155, one h1, headings in order, canonical in the sitemap', () => {
  const sitemap = site.get('sitemap.xml');
  assert.equal(sitemap.match(/<url>/g).length, pages.length + 1); // plus the home page
  for (const [path, html] of pages) {
    const title = unescape(/<title>([^<]*)<\/title>/.exec(html)[1]);
    const description = unescape(/<meta name="description" content="([^"]*)">/.exec(html)[1]);
    assert.ok(title.length >= 50 && title.length <= 60, `${path}: ${title.length} ${title}`);
    assert.ok(description.length >= 140 && description.length <= 155, `${path}: ${description.length} ${description}`);
    assert.equal(html.match(/<h1[\s>]/g).length, 1, path);
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map(m => Number(m[1]));
    levels.forEach((level, i) => assert.ok(i ? level <= levels[i - 1] + 1 : level === 1, `${path}: h${level} after h${levels[i - 1]}`));
    const url = 'https://overlap.vibe-coding.fans/' + path.replace(/index\.html$/, '');
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), path);
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), path);
    assert.ok(html.includes('<meta property="og:image" content="https://overlap.vibe-coding.fans/og.png">'), path);
  }
});

test('no script but JSON-LD, no inline styles, no dashes, and the FAQPage matches the visible FAQ word for word', () => {
  const dash = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  for (const [path, html] of pages) {
    assert.doesNotMatch(html, /<script(?![^>]*type="application\/ld\+json")[^>]*>/i, path);
    assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i, path);
    assert.doesNotMatch(html, dash, path);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])['@graph']);
    assert.equal(blocks.length, 1, path);
    const crumbs = blocks[0].find(n => n['@type'] === 'BreadcrumbList').itemListElement;
    assert.equal(crumbs.at(-1).item, 'https://overlap.vibe-coding.fans/' + path.replace(/index\.html$/, ''));
    const faq = blocks[0].find(n => n['@type'] === 'FAQPage');
    if (path === 'meeting-time/index.html') continue;
    const start = html.indexOf('id="faq-h"');
    const section = html.slice(start, html.indexOf('</section>', start));
    const visible = [...section.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(m => [unescape(m[1]), unescape(m[2])]);
    assert.ok(visible.length >= 3 && visible.length <= 4, path);
    assert.deepEqual(faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]), visible, path);
  }
});

test('each page is under 12 KB gzipped', () => {
  for (const [path, html] of pages) assert.ok(gzipSync(html).length < 12_000, `${path}: ${gzipSync(html).length} bytes`);
});

test('London and New York in 2026: the US and Europe switch clocks on different Sundays', () => {
  const p = pair('london-new-york');
  assert.equal(p.title, 'Best Meeting Time for London and New York | Overlap');
  assert.equal(p.appLink, '/#p=,London,Europe/London;,New+York,America/New_York');
  assert.deepEqual(p.periodRows.map(r => [r.range, r.gap]), [
    ['1 January to 7 March', 'London 5 hours ahead'],
    ['8 to 28 March', 'London 4 hours ahead'],
    ['29 March to 24 October', 'London 5 hours ahead'],
    ['25 to 31 October', 'London 4 hours ahead'],
    ['1 November to 31 December', 'London 5 hours ahead'],
  ]);
  // 3 shared hours most of the year, 4 in the mismatch weeks, as test/tz.test.mjs checks for 1 and 15 March.
  assert.deepEqual(p.overlapRows.map(r => [...r.meet.slot.flatMap(s => [s.from, s.to]), r.meet.minutes]), [
    ['14:00', '17:00', '09:00', '12:00', 180],
    ['13:00', '17:00', '09:00', '13:00', 240],
  ]);
  assert.deepEqual(p.hours.filter(h => h.work[0] && h.work[1]).map(h => `${h.a} ${h.b.time}`), ['14:00 09:00', '15:00 10:00', '16:00 11:00']);
  assert.match(p.faq[2].a, /^No\. In 2026 London changes clocks on Sunday 29 March and Sunday 25 October, and New York on Sunday 8 March and Sunday 1 November\./);
});

test('no shared working hours: the least painful hour, picked and rated as the app does', () => {
  const p = pair('london-sydney');
  assert.ok(p.overlapRows.every(r => !r.meet.full));
  const [sa, sb] = p.overlapRows[0].meet.slot; // 5 April to 3 October 2026, Sydney 9 hours ahead
  assert.deepEqual([sa.from, sa.rating, sb.from, sb.rating], ['07:00', 'early', '16:00', 'fine']);
  const next = pair('san-francisco-sydney').overlapRows[0].meet.slot[1];
  assert.deepEqual([next.from, next.day], ['09:00', 1]);
});
