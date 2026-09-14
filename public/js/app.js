// Overlap UI. The URL hash is the source of truth; everything on screen is derived from it.
import { analyze, dayRange, dateIn, hhmm, offsetAt, formatOffset, rate, clockChanges, checkZone, PAIN, HOUR_MS, SLOT_MS, DAY_MS, DEFAULT_START, DEFAULT_END } from './tz.js';
import { encode, decode, MAX_PEOPLE, MAX_SLOTS } from './state.js';
import { ics } from './ics.js';
import makers from './makers.js';

const $ = id => document.getElementById(id);
const VIEWER = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const STORE = 'overlap:team';
const SAMPLE = 'p=Sam,San+Francisco,America/Los_Angeles;Nadia,New+York,America/New_York;Leo,London,Europe/London;Ioana,Bucharest,Europe/Bucharest;Arjun,Mumbai,Asia/Kolkata;Grace,Sydney,Australia/Sydney';
const WORD = { work: 'working', early: 'early', late: 'late', asleep: 'asleep' };
const BAD = new Set(['early', 'late', 'asleep']);

let state = decode('');
let view = null;     // the shown day: zone, date, start, end, n, status, best
let selStart = null; // start instant of the selected slot
let meetLen = 60;    // minutes
let remember = false;
let cardUrl = '';

/* ---------- helpers ---------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(cls, text, data = {}) {
  const b = el('button', cls, text);
  b.type = 'button';
  Object.assign(b.dataset, data);
  return b;
}
const cityOf = p => p.city || p.tz.split('/').pop().replace(/_/g, ' ');
const who = p => (p.name ? `${p.name}, ${cityOf(p)}` : cityOf(p));
const nameOf = p => (p.name ? `${p.name} (${cityOf(p)})` : cityOf(p));
const list = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const dur = m => [Math.floor(m / 60) && `${Math.floor(m / 60)} hour${m >= 120 ? 's' : ''}`, m % 60 && `${m % 60} minutes`].filter(Boolean).join(' ') || '0 minutes';
const hoursText = m => { const h = m / 60; return `${Number.isInteger(h) ? h : h.toFixed((h * 4) % 2 ? 2 : 1)} hour${h === 1 ? '' : 's'}`; };
// "09" for whole hours, "5:30" for zones with minutes (kept narrow enough for a 2rem column).
const shortHour = t => (t.endsWith(':00') ? t.slice(0, 2) : t.replace(/^0/, ''));
const zoneName = (tz, ms) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find(x => x.type === 'timeZoneName').value;
const refName = ms => (state.utc ? 'UTC' : zoneName(VIEWER, ms));
const dayText = (tz, ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
const weekday = (tz, ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(ms);
const utcMin = ms => (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 60000;
const slotAt = s => view.start + ((s.start - utcMin(view.start) + 1440) % 1440) * 60000;
const worst = rs => rs.reduce((a, b) => (PAIN[b] > PAIN[a] ? b : a));
// Local clock, plus the weekday when it is not the same date as the grid.
const localAt = (tz, ms) => hhmm(tz, ms) + (dateIn(tz, ms) !== dateIn(view.zone, ms) ? ` ${weekday(tz, ms)}` : '');

function groups() {
  const m = new Map();
  for (const p of state.people) {
    const k = cityOf(p) + '|' + p.tz;
    if (m.has(k)) m.get(k).push(p); else m.set(k, [p]);
  }
  return [...m.values()];
}

function store(hash) {
  try { hash == null ? localStorage.removeItem(STORE) : localStorage.setItem(STORE, hash); } catch { /* storage blocked */ }
}

function download(name, blob) {
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function copy(text, input, msgId, done) {
  try { await navigator.clipboard.writeText(text); }
  catch { input.select(); document.execCommand('copy'); }
  $(msgId).textContent = done;
}

/* ---------- state flow ---------- */

function update({ team = false, scroll = false } = {}) {
  state.people = groups().flat(); // people in the same city sit together
  const hash = encode(state);
  history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
  if (remember) store(hash);

  const zone = state.utc ? 'UTC' : VIEWER;
  const date = state.date || dateIn(zone, Date.now());
  const { start, end } = dayRange(date, zone);
  view = { zone, date, start, end, ...analyze(state.people, start, end, meetLen) };
  if (selStart == null || selStart < start || selStart >= end) selStart = view.best ? view.best.start : null;

  const has = state.people.length > 0;
  $('empty').hidden = has;
  $('result').hidden = !has;
  $('team-empty').hidden = has;
  $('clear').hidden = !has;
  $('date').value = date;
  $('today').hidden = !state.date;
  $(state.utc ? 'ref-utc' : 'ref-local').checked = true;
  $('link-out').value = location.href;
  $('card-out').hidden = true;
  if (team) renderTeam();
  if (!has) return;
  renderSummary();
  renderGrid(scroll);
  renderDst();
  renderSlot();
  renderCompare();
}

function load() {
  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch { /* storage blocked */ }
  remember = saved != null;
  $('remember').checked = remember;
  state = decode(location.hash.slice(1) || saved || '');
  selStart = null;
  update({ team: true, scroll: true });
}

/* ---------- rendering ---------- */

function describe(start, minutes) {
  const parts = groups().map(g => {
    const r = worst(g.map(p => rate(p, start, minutes)));
    return `${localAt(g[0].tz, start)} in ${cityOf(g[0])}${BAD.has(r) ? ` (${r})` : ''}`;
  });
  return `${hhmm(view.zone, start)} to ${hhmm(view.zone, start + minutes * 60000)} ${refName(start)}. That is ${parts.join(', ')}.`;
}

function renderSummary() {
  const b = view.best;
  const minutes = b.full ? (b.end - b.start) / 60000 : meetLen;
  $('best').textContent = `Best time: ${describe(b.start, minutes)}`;
  $('best-note').textContent = b.full
    ? `Everyone is inside working hours for ${dur(minutes)}.`
    : `No full overlap: on this date there is no time when everyone is inside working hours, so this is the least painful ${meetLen === 60 ? 'hour' : dur(meetLen)}.`;
}

function renderGrid(scroll) {
  const { start, end, n, status, best, zone } = view;
  const people = state.people;
  const cols = Math.ceil(n / 4);
  const g = $('grid');
  g.style.setProperty('--cols', cols);
  g.style.setProperty('--rows', people.length);
  const bestFrom = (best.start - start) / SLOT_MS;
  const bestTo = Math.min(n, (best.end - start) / SLOT_MS);
  const kids = [el('div', 'corner', state.utc ? 'UTC' : 'Your time')];

  const titles = [];
  for (let c = 0; c < cols; c++) {
    const t = start + c * HOUR_MS;
    const lines = people.map((p, i) => `${who(p)}: ${localAt(p.tz, t)}, ${WORD[status[i][c * 4]]}`);
    const head = `${hhmm(zone, t)} ${refName(t)}, ${dayText(zone, t)}`;
    titles.push([head, ...lines].join('\n'));
    const label = shortHour(hhmm(zone, t));
    const b = button(label.includes(':') ? 'hour mm' : 'hour', label, { col: c });
    b.title = titles[c];
    b.setAttribute('aria-label', `${head}. ${lines.join('. ')}.`);
    if (c * 4 < bestTo && (c + 1) * 4 > bestFrom) b.classList.add('in-best');
    kids.push(b);
  }

  let prevKey = '';
  people.forEach((p, i) => {
    const key = cityOf(p) + '|' + p.tz;
    const first = key !== prevKey;
    prevKey = key;
    const gap = i > 0 && first ? ' gap' : '';
    const label = el('div', `who${gap}${first ? '' : ' same'}`);
    label.append(el('span', 'name', p.name || cityOf(p)));
    if (first) label.append(el('span', 'place', `${p.name ? cityOf(p) + ' ' : ''}${formatOffset(offsetAt(p.tz, start + 12 * HOUR_MS)).slice(3)}`));
    label.title = `${who(p)}, ${p.tz}, works ${hhmm('UTC', p.start * 60000)} to ${hhmm('UTC', p.end * 60000)} local`;
    kids.push(label);
    for (let c = 0; c < cols; c++) {
      const s = status[i].slice(c * 4, c * 4 + 4);
      const cell = el('div', `cell${gap}${c === 0 ? ' first' : ''}${c === cols - 1 ? ' last' : ''}`);
      if (s.length === 4 && s.every(x => x === s[0])) cell.classList.add(s[0]);
      else for (let q = 0; q < 4; q++) cell.append(el('i', s[q] || 'out'));
      const t = start + c * HOUR_MS;
      const local = hhmm(p.tz, t);
      const text = local === '00:00' ? weekday(p.tz, t) : shortHour(local);
      cell.append(el('b', `on-${s[1] || s[0]}${text.includes(':') ? ' mm' : ''}`, text));
      cell.dataset.col = c;
      cell.title = titles[c];
      cell.setAttribute('aria-hidden', 'true');
      kids.push(cell);
    }
  });

  const band = (cls, from, len) => {
    const b = el('div', 'band ' + cls);
    b.style.setProperty('--from', from);
    b.style.setProperty('--len', len);
    kids.push(b);
    return b;
  };
  const bestBand = band('best', bestFrom, bestTo - bestFrom);
  band('sel', 0, 0).id = 'sel-band';
  const now = Date.now();
  if (now >= start && now < end) band('now', (now - start) / SLOT_MS, 0);
  g.replaceChildren(...kids);
  placeSelection();
  if (scroll) $('grid-scroll').scrollLeft = Math.max(0, bestBand.offsetLeft - g.firstChild.offsetWidth - 24);
}

function placeSelection() {
  const from = (selStart - view.start) / SLOT_MS;
  const b = $('sel-band');
  b.style.setProperty('--from', from);
  b.style.setProperty('--len', Math.min(meetLen / 15, view.n - from));
  const col = Math.floor(from / 4);
  for (const h of $('grid').querySelectorAll('.hour')) {
    const on = Number(h.dataset.col) === col;
    h.setAttribute('aria-pressed', on);
    h.tabIndex = on ? 0 : -1;
  }
}

function pick(col, focus) {
  col = Math.max(0, Math.min(Math.ceil(view.n / 4) - 1, col));
  selStart = view.start + col * HOUR_MS;
  $('slot-msg').textContent = '';
  placeSelection();
  renderSlot();
  if (focus) {
    const h = $('grid').querySelector(`.hour[data-col="${col}"]`);
    h.focus();
    h.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function renderDst() {
  const byZone = new Map();
  for (const g of groups()) byZone.set(g[0].tz, [...(byZone.get(g[0].tz) || []), cityOf(g[0])]);
  const items = [];
  for (const [tz, cities] of byZone) {
    for (const ch of clockChanges(tz, view.start, 14)) {
      items.push(`${list(cities)} ${ch.to > ch.from ? 'moves clocks forward' : 'moves clocks back'} ${dur(Math.abs(ch.to - ch.from))} on ${dayText(tz, ch.at)}`);
    }
  }
  $('dst').hidden = !items.length;
  $('dst-text').textContent = items.length ? `Daylight saving within 14 days: ${items.join('. ')}. The overlap shifts after that, so check the date you meet.` : '';
}

function renderSlot() {
  const t = selStart, end = t + meetLen * 60000;
  $('slot-when').textContent = `${hhmm(view.zone, t)} to ${hhmm(view.zone, end)} ${refName(t)}, ${dayText(view.zone, t)}`;
  let total = 0;
  $('slot-people').replaceChildren(...state.people.map(p => {
    const r = rate(p, t, meetLen);
    total += PAIN[r];
    const li = el('li');
    li.append(el('span', 'rate ' + r, r), el('span', null, who(p)), el('span', 'lt', `${localAt(p.tz, t)} to ${hhmm(p.tz, end)}`));
    return li;
  }));
  $('slot-score').textContent = `Pain score: ${total}.`;
}

function renderCompare() {
  $('compare').hidden = !state.slots.length;
  if (!state.slots.length) return;
  const cands = state.slots.map(s => ({ ...s, at: slotAt(s) }));
  const ratings = cands.map(c => state.people.map(p => rate(p, c.at, c.len)));
  const totals = ratings.map(rs => rs.reduce((sum, r) => sum + PAIN[r], 0));
  const low = Math.min(...totals);

  const table = el('table');
  table.append(el('caption', 'vh', 'Rating per person for each pinned time, with the total pain score'));
  const head = el('tr');
  head.append(el('th', null, 'Person'));
  cands.forEach((c, k) => {
    const time = `${hhmm(view.zone, c.at)} to ${hhmm(view.zone, c.at + c.len * 60000)} ${refName(c.at)}`;
    const th = el('th');
    th.scope = 'col';
    const acts = el('span', 'cand-acts');
    const cal = button('link', '.ics', { ics: k });
    cal.setAttribute('aria-label', `Add ${time} to calendar`);
    const rm = button('link', 'Remove', { rm: k });
    rm.setAttribute('aria-label', `Remove ${time}`);
    acts.append(cal, rm);
    th.append(el('span', null, time), acts);
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  state.people.forEach((p, i) => {
    const tr = el('tr');
    const th = el('th', null, who(p));
    th.scope = 'row';
    tr.append(th);
    cands.forEach((c, k) => {
      const td = el('td');
      td.append(el('span', 'rate ' + ratings[k][i], ratings[k][i]), ` ${localAt(p.tz, c.at)}`);
      tr.append(td);
    });
    tbody.append(tr);
  });
  const foot = el('tr');
  const th = el('th', null, 'Pain score');
  th.scope = 'row';
  foot.append(th);
  const unique = totals.filter(x => x === low).length === 1;
  totals.forEach(t => {
    const td = el('td', null, String(t));
    if (cands.length > 1 && t === low && unique) td.append(el('span', 'fairest', 'fairest'));
    foot.append(td);
  });
  const tfoot = el('tfoot');
  tfoot.append(foot);
  table.append(thead, tbody, tfoot);
  $('compare-table').replaceChildren(table);
  $('compare-more').hidden = cands.length > 1;

  const hit = cands.length > 1 ? state.people.filter((p, i) => ratings.every(rs => BAD.has(rs[i]))) : [];
  $('rotate').hidden = !hit.length;
  $('rotate').textContent = hit.length
    ? `Rotate the pain: ${list(hit.map(nameOf))} ${hit.length > 1 ? 'get' : 'gets'} an early, late or asleep slot in every candidate. Take turns between these times so the same people are not always the ones stretching.`
    : '';
}

const hourSelect = (() => {
  const s = el('select');
  for (let m = 0; m < 1440; m += 15) s.append(new Option(hhmm('UTC', m * 60000), m));
  return s;
})();

function renderTeam() {
  const gs = groups();
  $('team').replaceChildren(...gs.map((g, gi) => {
    const li = el('li', 'group');
    const head = el('div', 'group-head');
    const city = cityOf(g[0]);
    const title = el('div', 'group-title');
    title.append(el('h3', null, city), el('span', 'meta', `${g[0].tz.replace(/_/g, ' ')}, ${formatOffset(offsetAt(g[0].tz, view.start + 12 * HOUR_MS))}`));
    head.append(title, moves(gi, -1, gs.length, city));
    const ul = el('ul', 'people');
    g.forEach((p, k) => {
      const row = el('li', 'person');
      const label = p.name || city;
      row.append(field('Name', Object.assign(el('input'), { type: 'text', value: p.name, maxLength: 40, placeholder: 'Optional' }), gi, k, 'name'));
      row.append(field('Starts', Object.assign(hourSelect.cloneNode(true), { value: p.start }), gi, k, 'start'));
      row.append(field('Ends', Object.assign(hourSelect.cloneNode(true), { value: p.end }), gi, k, 'end'));
      if (g.length > 1) row.append(moves(gi, k, g.length, label));
      const rm = button('btn ghost', 'Remove', { act: 'remove', g: gi, k });
      rm.setAttribute('aria-label', `Remove ${nameOf(p)}`);
      row.append(rm);
      ul.append(row);
    });
    li.append(head, ul);
    return li;
  }));
}

let fieldId = 0;
function field(text, input, g, k, f) {
  const wrap = el('div', 'field');
  const label = el('label', null, text);
  input.id = label.htmlFor = `f${++fieldId}`;
  Object.assign(input.dataset, { g, k, f });
  wrap.append(label, input);
  return wrap;
}

function moves(g, k, size, label) {
  const box = el('div', 'moves');
  for (const [d, arrow, word] of [[-1, '↑', 'up'], [1, '↓', 'down']]) {
    const b = button('icon', arrow, { act: 'move', g, k, d });
    b.setAttribute('aria-label', `Move ${label} ${word}`);
    b.disabled = (k < 0 ? g : k) + d < 0 || (k < 0 ? g : k) + d >= size;
    box.append(b);
  }
  return box;
}

/* ---------- city search ---------- */

let cities = null;
let results = [];
let active = -1;
const regions = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const country = cc => { try { return regions?.of(cc) || cc; } catch { return cc; } };
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function loadCities() {
  cities ??= import('./cities.js').then(m => ({
    zones: m.zones,
    rows: m.cities.split('\n').map(r => {
      const f = r.split('|');
      return { name: f[0], key: fold(f[1] || f[0]), cc: f[2], region: m.regions[f[3]] || '', tz: m.zones[f[4]] };
    }),
  })).catch(() => {
    cities = null;
    $('add-msg').textContent = 'City search could not load. You can still type a time zone like Asia/Kolkata.';
    return { zones: [], rows: [] };
  });
  return cities;
}

function search(data, q) {
  q = q.trim();
  if (!q) return [];
  if (q.includes('/') || /^utc$/i.test(q)) {
    const all = [...new Set([...data.zones, ...(Intl.supportedValuesOf?.('timeZone') || [])])];
    const lower = q.toLowerCase();
    const exact = all.find(z => z.toLowerCase() === lower) || checkZone(q);
    const out = exact ? [{ tz: exact, raw: true }] : [];
    for (const z of all) if (out.length < 8 && z !== exact && z.toLowerCase().includes(lower)) out.push({ tz: z, raw: true });
    return out;
  }
  const [name, where = ''] = fold(q).split(',').map(s => s.trim());
  const starts = [], inside = [];
  for (const c of data.rows) {
    const i = c.key.indexOf(name);
    if (i < 0 || (where && !fold(`${c.region} ${country(c.cc)} ${c.cc}`).includes(where))) continue;
    (i === 0 || c.key[i - 1] === ' ' ? starts : inside).push(c);
    if (starts.length >= 8) break;
  }
  return starts.concat(inside).slice(0, 8);
}

function showResults() {
  const input = $('add-city'), ul = $('city-list');
  ul.replaceChildren(...results.map((r, k) => {
    const li = el('li', 'opt');
    li.id = `opt-${k}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', k === active);
    li.dataset.k = k;
    const off = formatOffset(offsetAt(r.tz, Date.now()));
    if (r.raw) li.append(el('strong', null, r.tz), el('span', 'where', `Time zone, ${off}`));
    else li.append(el('strong', null, r.name), el('span', 'where', `${[r.region, country(r.cc)].filter(Boolean).join(', ')}, ${off}`));
    return li;
  }));
  ul.hidden = !results.length;
  input.setAttribute('aria-expanded', results.length > 0);
  if (active >= 0 && results.length) input.setAttribute('aria-activedescendant', `opt-${active}`);
  else input.removeAttribute('aria-activedescendant');
  $(`opt-${active}`)?.scrollIntoView({ block: 'nearest' });
}

function addPerson(r) {
  if (state.people.length >= MAX_PEOPLE) {
    $('add-msg').textContent = `A team can have up to ${MAX_PEOPLE} people.`;
    return;
  }
  const p = { name: $('add-name').value.trim().slice(0, 40), city: r.raw ? '' : r.name, tz: r.tz, start: DEFAULT_START, end: DEFAULT_END };
  state.people.push(p);
  $('add-name').value = $('add-city').value = '';
  results = [];
  showResults();
  update({ team: true, scroll: state.people.length === 1 });
  $('add-msg').textContent = `Added ${nameOf(p)}.`;
  $('add-name').focus();
}

/* ---------- events ---------- */

$('add-city').addEventListener('focus', () => loadCities());
$('add-city').addEventListener('input', async e => {
  const q = e.target.value;
  const data = await loadCities();
  if (e.target.value !== q) return;
  results = search(data, q);
  active = results.length ? 0 : -1;
  showResults();
});
$('add-city').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!results.length) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    showResults();
  } else if (e.key === 'Escape') {
    results = [];
    showResults();
  }
});
$('add-city').addEventListener('blur', () => { results = []; showResults(); });
$('city-list').addEventListener('mousedown', e => e.preventDefault());
$('city-list').addEventListener('click', e => {
  const li = e.target.closest('[data-k]');
  if (li) addPerson(results[Number(li.dataset.k)]);
});
$('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('add-city').value;
  if (!q.trim()) {
    $('add-msg').textContent = 'Type a city or a time zone first.';
    $('add-city').focus();
    return;
  }
  if (!results.length) results = search(await loadCities(), q);
  const r = results[Math.max(0, active)];
  if (r) addPerson(r);
  else $('add-msg').textContent = 'No match. Try another spelling, a bigger nearby city, or a time zone like Asia/Kolkata.';
});

$('sample').addEventListener('click', () => {
  state = decode(SAMPLE);
  selStart = null;
  update({ team: true, scroll: true });
  $('best').focus();
});

$('date').addEventListener('change', e => {
  state.date = e.target.value;
  selStart = null;
  update({ scroll: true });
});
$('today').addEventListener('click', () => {
  state.date = '';
  selStart = null;
  update({ scroll: true });
  $('date').focus();
});
for (const r of document.querySelectorAll('input[name="ref"]')) {
  r.addEventListener('change', () => {
    state.utc = r.value === 'utc';
    selStart = null;
    update({ scroll: true });
  });
}
$('len').addEventListener('change', e => {
  meetLen = Number(e.target.value);
  update();
});

$('grid').addEventListener('click', e => {
  const c = e.target.closest('[data-col]');
  if (c) pick(Number(c.dataset.col), c.classList.contains('hour'));
});
$('grid').addEventListener('keydown', e => {
  const h = e.target.closest('.hour');
  const col = h && { ArrowLeft: Number(h.dataset.col) - 1, ArrowRight: Number(h.dataset.col) + 1, Home: 0, End: Infinity }[e.key];
  if (col == null) return;
  e.preventDefault();
  pick(col, true);
});

$('pin').addEventListener('click', () => {
  const s = { start: utcMin(selStart), len: meetLen };
  const msg = $('slot-msg');
  if (state.slots.some(x => x.start === s.start && x.len === s.len)) msg.textContent = 'That time is already pinned.';
  else if (state.slots.length >= MAX_SLOTS) msg.textContent = `You can compare up to ${MAX_SLOTS} times. Remove one first.`;
  else {
    state.slots.push(s);
    update();
    msg.textContent = state.slots.length === 1 ? 'Pinned. Pick another hour and pin it to compare.' : 'Pinned. See the comparison below.';
  }
});

function calendar(start, minutes) {
  const end = start + minutes * 60000;
  const lines = state.people.map(p => `${who(p)}: ${hhmm(p.tz, start)} to ${hhmm(p.tz, end)} (${rate(p, start, minutes)})`);
  const text = ics({ start, end, summary: 'Team meeting', description: `Local times:\n${lines.join('\n')}\n\nTeam link: ${location.href}` });
  download(`overlap-${new Date(start).toISOString().slice(0, 16).replace(/[-:]/g, '')}Z.ics`, new Blob([text], { type: 'text/calendar' }));
}
$('slot-ics').addEventListener('click', () => calendar(selStart, meetLen));
$('compare-table').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ics != null) {
    const s = state.slots[Number(b.dataset.ics)];
    calendar(slotAt(s), s.len);
  } else {
    state.slots.splice(Number(b.dataset.rm), 1);
    update();
    $('slot-msg').textContent = 'Removed that pinned time.';
    $('pin').focus();
  }
});

$('team').addEventListener('input', e => {
  const { g, k, f } = e.target.dataset;
  if (!f) return;
  const p = groups()[Number(g)][Number(k)];
  p[f] = f === 'name' ? e.target.value.slice(0, 40) : Number(e.target.value);
  update();
});
$('team').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const gs = groups(), gi = Number(b.dataset.g), k = Number(b.dataset.k), d = Number(b.dataset.d);
  if (b.dataset.act === 'remove') {
    const p = gs[gi][k], at = state.people.indexOf(p);
    state.people.splice(at, 1);
    update({ team: true });
    $('team-msg').textContent = `Removed ${nameOf(p)}.`;
    const rest = $('team').querySelectorAll('[data-act="remove"]');
    (rest[Math.min(at, rest.length - 1)] || $('add-name')).focus();
    return;
  }
  const arr = k < 0 ? gs : gs[gi], from = k < 0 ? gi : k, to = from + d;
  [arr[from], arr[to]] = [arr[to], arr[from]];
  state.people = gs.flat();
  update({ team: true });
  const sel = k < 0 ? `[data-act="move"][data-g="${to}"][data-k="-1"]` : `[data-act="move"][data-g="${gi}"][data-k="${to}"]`;
  const btns = [...$('team').querySelectorAll(sel)];
  (btns.find(x => Number(x.dataset.d) === d && !x.disabled) || btns.find(x => !x.disabled))?.focus();
  $('team-msg').textContent = 'Moved.';
});
$('remember').addEventListener('change', e => {
  remember = e.target.checked;
  store(remember ? encode(state) : null);
  $('team-msg').textContent = remember ? 'This team will open next time on this device.' : 'This device will not remember the team.';
});
$('clear').addEventListener('click', () => {
  state.people = [];
  state.slots = [];
  update({ team: true });
  $('team-msg').textContent = 'Team cleared.';
  $('add-name').focus();
});

$('copy-link').addEventListener('click', () => copy(location.href, $('link-out'), 'share-msg', 'Link copied. Anyone who opens it sees this team.'));
$('copy-li').addEventListener('click', () => copy($('li-text').value, $('li-text'), 'share-msg', 'Post text copied.'));
$('make-card').addEventListener('click', async () => {
  const { drawCard } = await import('./card.js');
  const b = view.best;
  const offsets = [...new Set(state.people.map(p => p.tz))].map(z => offsetAt(z, b.start));
  const spread = Math.max(...offsets) - Math.min(...offsets);
  const n = groups().length, where = `${n} ${n === 1 ? 'city' : 'cities'}`;
  const headline = spread ? `Our team spans ${hoursText(spread)} across ${where}.` : `Our team shares one time zone across ${where}.`;
  const sub = b.full ? `Best overlap: ${dur((b.end - b.start) / 60000)}.` : `No full overlap. Least painful time: ${hhmm(view.zone, b.start)} ${refName(b.start)}.`;
  const cols = Math.ceil(view.n / 4);
  const hours = [];
  for (let c = 0; c < cols; c += 3) hours.push({ slot: c * 4, text: shortHour(hhmm(view.zone, view.start + c * HOUR_MS)) });
  const canvas = $('card');
  drawCard(canvas, {
    headline, sub, hours, n: view.n,
    rows: state.people.slice(0, 8).map((p, i) => ({ label: who(p), status: view.status[i] })),
    more: Math.max(0, state.people.length - 8),
    best: { from: (b.start - view.start) / SLOT_MS, len: (Math.min(b.end, view.end) - b.start) / SLOT_MS },
    foot: `${dayText(view.zone, view.start)} ${view.date.slice(0, 4)}, hours in ${refName(view.start)}`,
    host: location.host,
  });
  canvas.setAttribute('aria-label', `Share card: ${headline} ${sub}`);
  canvas.toBlob(blob => {
    if (cardUrl) URL.revokeObjectURL(cardUrl);
    cardUrl = URL.createObjectURL(blob);
    $('card-dl').href = cardUrl;
  });
  $('li-text').value = `${headline} ${sub}\n\nWe mapped when everyone is actually awake with Overlap: add your team's cities, see the overlap, share one link. No signup.\n\nLink in the first comment.`;
  $('card-out').hidden = false;
  $('share-msg').textContent = 'Share card ready below.';
});

$('makers').replaceChildren(...makers.map(m => {
  const a = Object.assign(document.createElement('a'), { href: m.url });
  a.append(Object.assign(document.createElement('img'), { src: m.logo, alt: '', width: 32, height: 32 }),
    el('strong', null, m.title), el('small', null, m.line));
  const li = el('li');
  li.append(a);
  return li;
}));

window.addEventListener('hashchange', load);
load();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
