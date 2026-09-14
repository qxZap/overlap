// Time zone engine. Pure ES module, no DOM: everything is UTC instants (ms) at 15 minute
// resolution, and every offset comes from Intl, so +05:30, +05:45, +12:45 and Lord Howe's
// 30 minute daylight saving come out exact.

export const SLOT_MIN = 15;
export const SLOT_MS = SLOT_MIN * 60000;
export const HOUR_MS = 3600000;
export const DAY_MS = 86400000;

// Working hours default, in minutes after local midnight.
export const DEFAULT_START = 9 * 60;
export const DEFAULT_END = 17 * 60;
// Awake window around working hours: from 2 hours before start until 6 hours after end.
// With the default 09:00 to 17:00 that is 07:00 to 23:00 local.
export const EARLY_MIN = 120;
export const LATE_MIN = 360;

// Meeting pain points per person (lower total is fairer).
export const PAIN = { great: 0, fine: 1, early: 3, late: 3, asleep: 8 };
const RATING_ORDER = ['great', 'fine', 'early', 'late', 'asleep'];
// A working slot counts as "great" when it is at least this far from both ends of the day.
const GREAT_MARGIN = 60;
// Cost per 15 minutes, used only when no time has everyone working.
const COST = { work: 0, early: 1, late: 1, asleep: 3 };

const pad = n => String(n).padStart(2, '0');
const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) formatters.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }));
  return f;
}

/** The zone name if Intl accepts it (case-insensitive), else null. The UI fixes the case from its zone list. */
export function checkZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { formatter(tz); } catch { return null; }
  return tz.toLowerCase() === 'utc' ? 'UTC' : tz;
}

/** Minutes east of UTC for a zone at an instant. */
export function offsetAt(tz, ms) {
  const name = formatter(tz).formatToParts(ms).find(p => p.type === 'timeZoneName').value; // "GMT+05:30" or "GMT"
  const m = /([+\-−])(\d{1,2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}

/** A Date whose UTC fields read as the wall clock in tz. */
export const wall = (tz, ms) => new Date(ms + offsetAt(tz, ms) * 60000);
export const hhmm = (tz, ms) => { const d = wall(tz, ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
export const dateIn = (tz, ms) => wall(tz, ms).toISOString().slice(0, 10);
export const formatOffset = min => `UTC${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;

/** Instant of the first moment of a local date (YYYY-MM-DD) in tz. */
export function startOfDay(date, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const u = Date.UTC(y, m - 1, d);
  const tries = [...new Set([offsetAt(tz, u - DAY_MS), offsetAt(tz, u + DAY_MS)])].map(o => u - o * 60000).sort((a, b) => a - b);
  // ponytail: when clocks skip midnight itself (DST at 00:00), the later guess is the transition, which is the day's first instant.
  return tries.find(t => t + offsetAt(tz, t) * 60000 === u) ?? tries.at(-1);
}

/** The local day in tz as [start, end) instants; 23, 23.5, 24, 24.5 or 25 hours long. */
export function dayRange(date, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: startOfDay(date, tz), end: startOfDay(next, tz) };
}

function place(p, ms) {
  const off = offsetAt(p.tz, ms);
  const local = (((ms + off * 60000) % DAY_MS) + DAY_MS) % DAY_MS / 60000;
  const len = ((p.end - p.start + 1440) % 1440) || 1440; // start == end means all day
  const since = (local - p.start + 1440) % 1440; // minutes since work started (handles hours across midnight)
  return { since, len };
}

/** 'work' | 'early' | 'late' | 'asleep' for the 15 minutes starting at ms. */
export function statusAt(p, ms) {
  const { since, len } = place(p, ms);
  if (since < len) return 'work';
  if (1440 - since <= EARLY_MIN) return 'early';
  if (since - len < LATE_MIN) return 'late';
  return 'asleep';
}

/** Rate a meeting [start, start + minutes) for one person: great, fine, early, late or asleep. */
export function rate(p, start, minutes) {
  let worst = 0;
  for (let t = start; t < start + minutes * 60000; t += SLOT_MS) {
    const s = statusAt(p, t);
    let r = s;
    if (s === 'work') {
      const { since, len } = place(p, t);
      r = since >= GREAT_MARGIN && len - since - SLOT_MIN >= GREAT_MARGIN ? 'great' : 'fine';
    }
    worst = Math.max(worst, RATING_ORDER.indexOf(r));
  }
  return RATING_ORDER[worst];
}

/**
 * Statuses for every 15 minute slot of [start, end) and the best window.
 * best: the longest run where everyone works (it may continue past the end of the day),
 * or, when there is none, the lowest cost window of `minutes`.
 */
export function analyze(people, start, end, minutes = 60) {
  const n = Math.round((end - start) / SLOT_MS);
  const total = n + 96; // look one day ahead so a window that crosses midnight is not cut short
  const status = people.map(p => Array.from({ length: total }, (_, i) => statusAt(p, start + i * SLOT_MS)));
  if (!people.length) return { n, status, best: null };

  const run = new Array(total + 1).fill(0);
  for (let i = total - 1; i >= 0; i--) run[i] = status.every(s => s[i] === 'work') ? run[i + 1] + 1 : 0;
  let at = -1, len = 0;
  for (let i = 0; i < n; i++) if (run[i] > len) { at = i; len = run[i]; }
  let best;
  if (len) {
    best = { start: start + at * SLOT_MS, end: start + (at + Math.min(len, 96)) * SLOT_MS, full: true };
  } else {
    const k = Math.max(1, Math.round(minutes / SLOT_MIN));
    const cost = i => status.reduce((sum, s) => sum + COST[s[i]], 0);
    let low = Infinity;
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let j = i; j < i + k; j++) c += cost(j);
      if (c < low) { low = c; at = i; }
    }
    best = { start: start + at * SLOT_MS, end: start + (at + k) * SLOT_MS, full: false };
  }
  return { n, status: status.map(s => s.slice(0, n)), best };
}

/** Offset changes in tz during [from, from + days]. Each: { at, from, to } (minutes east of UTC). */
export function clockChanges(tz, from, days = 14) {
  const out = [];
  let prev = offsetAt(tz, from);
  for (let t = from + HOUR_MS; t <= from + days * DAY_MS; t += HOUR_MS) {
    const o = offsetAt(tz, t);
    if (o === prev) continue;
    let lo = t - HOUR_MS, hi = t;
    while (hi - lo > 60000) {
      const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
      if (offsetAt(tz, mid) === prev) lo = mid; else hi = mid;
    }
    out.push({ at: hi, from: prev, to: o });
    prev = o;
  }
  return out;
}
