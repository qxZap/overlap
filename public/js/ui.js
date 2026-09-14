// Pure helpers behind the UI: presets, grouping, the timeline's pointer and keyboard maths, the time picker's typeahead.
// No DOM, importable from Node (see test/ui.test.mjs).

// Quick starts, as URL hash fragments decoded by state.js.
export const PRESETS = [
  { id: 'sample', label: 'Sample team', hash: 'p=Sam,San+Francisco,America/Los_Angeles;Nadia,New+York,America/New_York;Leo,London,Europe/London;Ioana,Bucharest,Europe/Bucharest;Arjun,Mumbai,Asia/Kolkata;Grace,Sydney,Australia/Sydney' },
  { id: 'us-eu', label: 'US + Europe', hash: 'p=,San+Francisco,America/Los_Angeles;,Chicago,America/Chicago;,New+York,America/New_York;,London,Europe/London;,Berlin,Europe/Berlin' },
  { id: 'eu-in', label: 'Europe + India', hash: 'p=,London,Europe/London;,Amsterdam,Europe/Amsterdam;,Warsaw,Europe/Warsaw;,Bengaluru,Asia/Kolkata' },
  { id: 'am-apac', label: 'Americas + Asia Pacific', hash: 'p=,San+Francisco,America/Los_Angeles;,S%C3%A3o+Paulo,America/Sao_Paulo;,Singapore,Asia/Singapore;,Tokyo,Asia/Tokyo;,Sydney,Australia/Sydney' },
];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const cityOf = p => p.city || p.tz.split('/').pop().replace(/_/g, ' ');
export const groupKey = p => `${cityOf(p)}|${p.tz}`;

/** People in the same city and zone, grouped, in order of first appearance. */
export function groupPeople(people) {
  const m = new Map();
  for (const p of people) {
    const k = groupKey(p);
    if (m.has(k)) m.get(k).push(p); else m.set(k, [p]);
  }
  return [...m.values()];
}

/** Move the group with this key one place earlier (-1) or later (+1). Returns the new flat list. */
export function moveGroup(people, key, d) {
  const gs = groupPeople(people);
  const i = gs.findIndex(g => groupKey(g[0]) === key), j = i + d;
  if (i < 0 || j < 0 || j >= gs.length) return people;
  [gs[i], gs[j]] = [gs[j], gs[i]];
  return gs.flat();
}

/** "SF" for San Francisco, "L" for Leo, "?" for nothing. */
export function initials(text) {
  const words = String(text).trim().split(/[\s/_.-]+/u).filter(Boolean);
  if (!words.length) return '?';
  const first = w => [...w][0];
  return (words.length === 1 ? first(words[0]) : first(words[0]) + first(words.at(-1))).toUpperCase();
}

/** Consecutive statuses as runs of slots; early and late both read as "awake". */
export function runs(status) {
  const out = [];
  status.forEach((x, i) => {
    const s = x === 'early' || x === 'late' ? 'awake' : x;
    const last = out.at(-1);
    if (last && last.s === s) last.to = i + 1; else out.push({ s, from: i, to: i + 1 });
  });
  return out;
}

/**
 * Meeting window start slot for a pointer at x px on a track `width` px wide showing n slots.
 * `grab` is where in the window (in slots) the pointer holds it; the default centres the window on the pointer.
 * The window of k slots always fits inside the day.
 */
export function windowStart(x, width, n, k, grab = k / 2) {
  return clamp(Math.round((x / width) * n - grab), 0, Math.max(0, n - k));
}

/**
 * New index for a key press, or null when the key does nothing.
 * Slider (the meeting window): Right/Up +1, Left/Down -1, Page Up/Down one page. List (the time picker): Down +1, Up -1.
 */
export function stepKey(key, i, max, { page = 4, list = false } = {}) {
  if (key === 'Home') return 0;
  if (key === 'End') return max;
  const d = list
    ? { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page }
    : { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: page, PageDown: -page };
  return Object.hasOwn(d, key) ? clamp(i + d[key], 0, max) : null;
}

const pad = n => String(n).padStart(2, '0');
/** Index of the first time (minutes after midnight) matching typed digits: "9" and "09" find 09:00, "930" finds 09:30. -1 if none. */
export function typeahead(typed, minutes) {
  const digits = String(typed).replace(/\D/g, '');
  if (!digits) return -1;
  const labels = minutes.map(m => pad(Math.floor(m / 60)) + pad(m % 60));
  const tries = digits.length % 2 ? ['0' + digits, digits] : [digits, '0' + digits];
  for (const q of tries) {
    const i = labels.findIndex(l => l.startsWith(q));
    if (i >= 0) return i;
  }
  return -1;
}

/** YYYY-MM-DD plus d calendar days. */
export function shiftDate(date, d) {
  const [y, m, day] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + d)).toISOString().slice(0, 10);
}

/** [start, end) ranges of `text` matching `query`, ignoring case and accents. Empty when it only matched elsewhere (for example the ASCII name). */
export function highlight(text, query) {
  const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  if (!q) return [];
  let folded = '';
  const at = []; // folded index -> original index
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (let j = 0; j < f.length; j++) at.push(i);
    folded += f;
  }
  at.push(text.length);
  const i = folded.indexOf(q);
  return i < 0 ? [] : [[at[i], at[i + q.length - 1] + 1]];
}
