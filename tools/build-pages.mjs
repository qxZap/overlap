// Writes the meeting time pages into public/meeting-time/ and regenerates public/sitemap.xml.
// Run with `npm run pages` (today's date) or `node tools/build-pages.mjs 2027-01-04`.
// The pages describe the year of that date, so run it again at the start of each year.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './pages-lib.mjs';

const today = process.argv[2] || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d\d-\d\d$/.test(today)) throw new Error(`Expected a date like 2026-09-15, got ${today}`);
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const files = buildSite(today);

rmSync(join(pub, 'meeting-time'), { recursive: true, force: true }); // pairs dropped from the list must not linger
for (const [path, text] of files) {
  mkdirSync(dirname(join(pub, path)), { recursive: true });
  writeFileSync(join(pub, path), text);
}
console.log(`${files.size - 2} pair pages, /meeting-time/ and sitemap.xml for ${today}`);
