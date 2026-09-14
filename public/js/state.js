// URL hash <-> app state. Pure module, importable from Node.
// #d=2026-03-15&p=Ana,Bucharest,Europe/Bucharest;Raj,Mumbai,Asia/Kolkata,1000-1830&c=1400-1500&z=utc
//   d  date, only when picked explicitly
//   p  people separated by ";", fields name,city,zone[,hours] (hours omitted when 0900-1700)
//   c  pinned candidate slots as UTC start-end
//   z  "utc" when the grid is shown in UTC
// Text is kept readable: spaces become "+", and only , ; & # = + % and control characters are percent-encoded.
import { checkZone, DEFAULT_START, DEFAULT_END } from './tz.js';

export const MAX_PEOPLE = 50;
export const MAX_SLOTS = 4;

const enc = s => String(s).replace(/[%,;&#=+\p{Cc}]/gu, c => encodeURIComponent(c)).replace(/ /g, '+');
function dec(s) {
  s = s.replace(/\+/g, ' ');
  try { return decodeURIComponent(s); } catch { return s; }
}
const pad = n => String(n).padStart(2, '0');
const clock = min => pad(Math.floor(min / 60)) + pad(min % 60);
const span = (a, b) => `${clock(a)}-${clock(b)}`;

function parseSpan(s) {
  const m = /^(\d\d)(00|15|30|45)-(\d\d)(00|15|30|45)$/.exec(s || '');
  if (!m || +m[1] > 23 || +m[3] > 23) return null;
  return [m[1] * 60 + +m[2], m[3] * 60 + +m[4]];
}

export function encode(state) {
  const out = [];
  if (state.date) out.push('d=' + state.date);
  if (state.people.length) {
    out.push('p=' + state.people.map(p => {
      const f = [enc(p.name), enc(p.city), enc(p.tz)];
      if (p.start !== DEFAULT_START || p.end !== DEFAULT_END) f.push(span(p.start, p.end));
      return f.join(',');
    }).join(';'));
  }
  if (state.slots.length) out.push('c=' + state.slots.map(s => span(s.start, (s.start + s.len) % 1440)).join(','));
  if (state.utc) out.push('z=utc');
  return out.join('&');
}

export function decode(hash) {
  const state = { date: '', people: [], slots: [], utc: false };
  for (const part of String(hash || '').replace(/^#/, '').split('&')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i), val = part.slice(i + 1);
    if (key === 'd' && /^\d{4}-\d\d-\d\d$/.test(val) && !isNaN(Date.parse(val))) state.date = val;
    if (key === 'z') state.utc = val === 'utc';
    if (key === 'p') {
      for (const item of val.split(';')) {
        const [name = '', city = '', zone = '', hours] = item.split(',').map(dec);
        const tz = checkZone(zone);
        if (!tz || state.people.length >= MAX_PEOPLE) continue;
        const [start, end] = parseSpan(hours) || [DEFAULT_START, DEFAULT_END];
        state.people.push({ name: name.slice(0, 40), city: city.slice(0, 60), tz, start, end });
      }
    }
    if (key === 'c') {
      for (const s of val.split(',')) {
        const t = parseSpan(s);
        if (t && state.slots.length < MAX_SLOTS) state.slots.push({ start: t[0], len: ((t[1] - t[0] + 1440) % 1440) || 1440 });
      }
    }
  }
  return state;
}
