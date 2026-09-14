// Share card: a 1200x627 PNG drawn in the browser. Loaded only when someone asks for it.
import { runs } from './ui.js';

const W = 1200, H = 627, M = 64;
const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const C = { bg: '#F8FAFC', surface: '#FFFFFF', border: '#E4ECFC', ink: '#0F172A', muted: '#475569', primary: '#2563EB', accent: '#059669', work: '#3B82F6', awake: '#DBEAFE', asleep: '#1E293B', asleep2: '#334155' };

function wrap(x, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && x.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  return lines.concat(line);
}

function clip(x, text, width) {
  if (x.measureText(text).width <= width) return text;
  while (text && x.measureText(text + '...').width > width) text = text.slice(0, -1);
  return text + '...';
}

function round(x, left, top, w, h, r) {
  x.beginPath();
  if (x.roundRect) x.roundRect(left, top, w, h, r); else x.rect(left, top, w, h);
}

export async function drawCard(canvas, d) {
  try { await Promise.all(['500 20px', '700 36px', '800 48px'].map(f => document.fonts.load(`${f} "Plus Jakarta Sans"`))); } catch { /* fallback font */ }
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d');
  x.fillStyle = C.bg;
  x.fillRect(0, 0, W, H);

  // Brand mark: two overlapping circles on calendar blue.
  round(x, M, 38, 40, 40, 11);
  x.fillStyle = C.primary;
  x.fill();
  x.strokeStyle = '#fff';
  x.lineWidth = 3;
  for (const cx of [M + 15.6, M + 24.4]) { x.beginPath(); x.arc(cx, 58, 8.1, 0, Math.PI * 2); x.stroke(); }
  x.fillStyle = C.ink;
  x.font = `800 28px ${FONT}`;
  x.fillText('Overlap', M + 54, 68);

  // Legend, top right.
  x.font = `600 18px ${FONT}`;
  let lx = W - M;
  for (const [label, color] of [['Asleep', C.asleep], ['Awake', C.awake], ['Working', C.work]]) {
    const w = x.measureText(label).width;
    lx -= w;
    x.fillStyle = C.muted;
    x.fillText(label, lx, 66);
    lx -= 28;
    round(x, lx, 51, 20, 18, 4);
    x.fillStyle = color;
    x.fill();
    lx -= 22;
  }

  let y = 142;
  x.fillStyle = C.ink;
  x.font = `800 48px ${FONT}`;
  for (const line of wrap(x, d.headline, W - 2 * M)) { x.fillText(line, M, y); y += 58; }
  x.fillStyle = C.accent;
  x.font = `700 34px ${FONT}`;
  for (const line of wrap(x, d.sub, W - 2 * M)) { x.fillText(line, M, y); y += 44; }

  const labelW = 230, gx = M + labelW, gw = W - M - gx, sw = gw / d.n;
  const top = y + 4, gy = top + 34, bottom = H - 72;
  const rh = Math.min(42, (bottom - gy) / d.rows.length), gap = Math.max(4, rh * 0.18);

  x.font = `600 18px ${FONT}`;
  x.fillStyle = C.muted;
  for (const h of d.hours) x.fillText(h.text, gx + h.slot * sw + 3, top + 20);

  d.rows.forEach((r, i) => {
    const ry = gy + i * rh + gap / 2, bh = rh - gap;
    x.fillStyle = C.ink;
    x.font = `600 20px ${FONT}`;
    x.fillText(clip(x, r.label, labelW - 18), M, ry + bh / 2 + 7);
    x.save();
    round(x, gx, ry, gw, bh, 8);
    x.clip();
    x.fillStyle = C.asleep;
    x.fillRect(gx, ry, gw, bh);
    for (const run of runs(r.status)) {
      if (run.s === 'asleep') continue;
      x.fillStyle = run.s === 'work' ? C.work : C.awake;
      x.fillRect(gx + run.from * sw, ry, (run.to - run.from) * sw, bh);
    }
    x.restore();
  });

  const bx = gx + d.best.from * sw, bw = Math.max(d.best.len * sw, 4), by = gy - 6, bh = d.rows.length * rh + 12;
  round(x, bx, by, bw, bh, 10);
  x.fillStyle = 'rgba(5, 150, 105, .16)';
  x.fill();
  x.strokeStyle = C.accent;
  x.lineWidth = 5;
  x.stroke();

  x.font = `500 20px ${FONT}`;
  x.fillStyle = C.muted;
  x.fillText(d.foot + (d.more ? `, plus ${d.more} more people` : ''), M, H - 30);
  x.textAlign = 'right';
  x.fillText(d.host, W - M, H - 30);
  x.textAlign = 'left';
}
