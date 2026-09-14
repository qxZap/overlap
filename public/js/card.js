// Share card: a 1200x627 PNG drawn in the browser. Loaded only when someone asks for it.
const W = 1200, H = 627, M = 64;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const C = { bg: '#f8f2e8', ink: '#2a2019', muted: '#69594b', accent: '#a9431a', work: '#f0b13c', awake: '#f8e3bb', asleep: '#2e3954' };
const FILL = { work: C.work, early: C.awake, late: C.awake, asleep: C.asleep };

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

export function drawCard(canvas, d) {
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d');
  x.fillStyle = C.bg;
  x.fillRect(0, 0, W, H);

  const horizon = x.createLinearGradient(0, 0, W, 0);
  [[0, C.asleep], [0.2, C.asleep], [0.3, C.awake], [0.4, C.work], [0.62, C.work], [0.72, C.awake], [0.82, C.asleep], [1, C.asleep]]
    .forEach(([at, color]) => horizon.addColorStop(at, color));
  x.fillStyle = horizon;
  x.fillRect(0, 0, W, 10);

  x.fillStyle = C.accent;
  x.font = `800 28px ${FONT}`;
  x.fillText('Overlap', M, 68);

  // Legend, top right.
  x.font = `600 18px ${FONT}`;
  let lx = W - M;
  for (const [label, color] of [['Asleep', C.asleep], ['Awake', C.awake], ['Working', C.work]]) {
    const w = x.measureText(label).width;
    lx -= w;
    x.fillStyle = C.muted;
    x.fillText(label, lx, 66);
    lx -= 28;
    x.fillStyle = color;
    x.fillRect(lx, 51, 20, 18);
    lx -= 22;
  }

  let y = 132;
  x.fillStyle = C.ink;
  x.font = `800 48px ${FONT}`;
  for (const line of wrap(x, d.headline, W - 2 * M)) { x.fillText(line, M, y); y += 56; }
  x.fillStyle = C.accent;
  x.font = `700 36px ${FONT}`;
  for (const line of wrap(x, d.sub, W - 2 * M)) { x.fillText(line, M, y); y += 46; }

  const labelW = 230, gx = M + labelW, gw = W - M - gx, sw = gw / d.n;
  const top = y + 8, gy = top + 34, bottom = H - 72;
  const rh = Math.min(40, (bottom - gy) / d.rows.length), gap = Math.max(3, rh * 0.15);

  x.font = `600 18px ${FONT}`;
  x.fillStyle = C.muted;
  for (const h of d.hours) x.fillText(h.text, gx + h.slot * sw + 3, top + 20);

  d.rows.forEach((r, i) => {
    const ry = gy + i * rh;
    x.fillStyle = C.ink;
    x.font = `600 20px ${FONT}`;
    x.fillText(clip(x, r.label, labelW - 18), M, ry + rh / 2 + 7);
    r.status.forEach((s, k) => {
      x.fillStyle = FILL[s];
      x.fillRect(gx + k * sw, ry + gap / 2, sw + 0.6, rh - gap);
    });
  });

  x.strokeStyle = C.accent;
  x.lineWidth = 5;
  x.beginPath();
  const bx = gx + d.best.from * sw, bw = Math.max(d.best.len * sw, 4), by = gy - 5, bh = d.rows.length * rh + 10;
  if (x.roundRect) x.roundRect(bx, by, bw, bh, 8); else x.rect(bx, by, bw, bh);
  x.stroke();

  x.font = `500 20px ${FONT}`;
  x.fillStyle = C.muted;
  x.fillText(d.foot + (d.more ? `, plus ${d.more} more people` : ''), M, H - 30);
  x.textAlign = 'right';
  x.fillText(d.host, W - M, H - 30);
  x.textAlign = 'left';
}
