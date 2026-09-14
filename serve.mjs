// Zero-dependency static server for local dev and Docker.
// Mirrors Cloudflare static assets closely enough to test locally:
// serves public/, applies public/_headers (merge with ", ", "! Name" detaches).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

// ponytail: path rules only (no absolute-URL rules), matches what our _headers uses.
function parseHeaders(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      const re = '^' + line.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*').replace(/:[A-Za-z]\w*/g, '[^/]+') + '$';
      rules.push({ re: new RegExp(re), set: [], detach: [] });
    } else if (line.startsWith('! ')) {
      rules.at(-1).detach.push(line.slice(2).trim().toLowerCase());
    } else {
      const i = line.indexOf(':');
      rules.at(-1).set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}

function headersFor(path, rules) {
  const out = new Map();
  const hits = rules.filter(r => r.re.test(path));
  for (const r of hits) for (const [k, v] of r.set) {
    const prev = out.get(k.toLowerCase());
    out.set(k.toLowerCase(), [k, prev ? `${prev[1]}, ${v}` : v]);
  }
  for (const r of hits) for (const k of r.detach) out.delete(k);
  return Object.fromEntries(out.values());
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(ROOT) || path === '/_headers') throw new Error('not found');
    const body = await readFile(file);
    // Read per request so edits to _headers show up without a restart.
    const rules = parseHeaders(await readFile(join(ROOT, '_headers'), 'utf8').catch(() => ''));
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ...headersFor(path, rules),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => {
  console.log(`Serving public/ on http://localhost:${server.address().port}`);
});
