// Overlap UI. The URL hash is the source of truth; everything on screen is derived from it.
// Flow: build the team (search + chips), read the answer card, fine tune on the timeline, then compare or share.
import { analyze, dayRange, dateIn, hhmm, offsetAt, formatOffset, rate, statusAt, clockChanges, checkZone, PAIN, HOUR_MS, SLOT_MS, DAY_MS, DEFAULT_START, DEFAULT_END } from './tz.js';
import { encode, decode, MAX_PEOPLE, MAX_SLOTS } from './state.js';
import { ics } from './ics.js';
import { PRESETS, clamp, cityOf, groupKey, groupPeople, moveGroup, initials, runs, windowStart, stepKey, typeahead, shiftDate, highlight } from './ui.js';
import { mountAds } from './showcase.js';
import makers from './makers.js';

const $ = id => document.getElementById(id);
const VIEWER = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const STORE = 'overlap:team';
const BAD = new Set(['early', 'late', 'asleep']);
const RATE_LABEL = { great: 'Great', fine: 'Fine', early: 'Early', late: 'Late', asleep: 'Asleep' };
const NOW_WORD = { work: 'working', early: 'awake', late: 'awake', asleep: 'asleep' };
const QUARTERS = Array.from({ length: 96 }, (_, i) => i * 15);

let state = decode('');
let view = null;  // the shown day: zone, date, start, end, n, status, best
let sel = 0;      // meeting window start, in 15 minute slots from view.start
let meetLen = 60; // minutes
let remember = false;
let cardUrl = '';
let drag = null;

/* ---------- helpers ---------- */

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.filter(k => k != null && k !== ''));
  return e;
}
const btn = (cls, ...kids) => Object.assign(el('button', cls, ...kids), { type: 'button' });
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
function avatar(text, status) {
  const a = el('span', 'avatar', initials(text));
  a.setAttribute('aria-hidden', 'true');
  if (status) a.append(el('span', `dot ${status === 'early' || status === 'late' ? 'awake' : status}`));
  return a;
}
const who = p => (p.name ? `${p.name}, ${cityOf(p)}` : cityOf(p));
const nameOf = p => (p.name ? `${p.name} (${cityOf(p)})` : cityOf(p));
const list = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const dur = m => [Math.floor(m / 60) && `${Math.floor(m / 60)} hour${m >= 120 ? 's' : ''}`, m % 60 && `${m % 60} minutes`].filter(Boolean).join(' ') || '0 minutes';
const hoursText = m => { const h = m / 60; return `${Number.isInteger(h) ? h : h.toFixed((h * 4) % 2 ? 2 : 1)} hour${h === 1 ? '' : 's'}`; };
const shortHour = t => (t.endsWith(':00') ? t.slice(0, 2) : t.replace(/^0/, ''));
const clock = m => hhmm('UTC', m * 60000);
const zoneName = (tz, ms) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find(x => x.type === 'timeZoneName').value;
const refName = ms => (state.utc ? 'UTC' : zoneName(VIEWER, ms));
const dayText = (tz, ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
const weekday = (tz, ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(ms);
const offsetText = (tz, ms) => formatOffset(offsetAt(tz, ms));
const utcMin = ms => (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 60000;
const slotAt = s => view.start + ((s.start - utcMin(view.start) + 1440) % 1440) * 60000;
const worst = rs => rs.reduce((a, b) => (PAIN[b] > PAIN[a] ? b : a));
// Local clock, plus the weekday when it is not the same date as the timeline.
const localAt = (tz, ms) => hhmm(tz, ms) + (dateIn(tz, ms) !== dateIn(view.zone, ms) ? ` ${weekday(tz, ms)}` : '');
const slots = () => meetLen / 15;
const selMs = () => view.start + sel * SLOT_MS;
const bestAt = () => Math.round((view.best.start - view.start) / SLOT_MS);

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

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = el('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast(done);
}

let toastTimer = 0, undoFn = null;
function toast(text, undo = null) {
  undoFn = undo;
  $('toast-undo').hidden = !undo;
  $('toast').classList.add('is-shown');
  $('toast-text').textContent = '';
  requestAnimationFrame(() => { $('toast-text').textContent = text; }); // a fresh change, so it is announced
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 8000 : 4000);
}
function hideToast(force) {
  if (!force && $('toast').matches(':hover, :focus-within')) { toastTimer = setTimeout(hideToast, 2000); return; }
  $('toast').classList.remove('is-shown');
  undoFn = null;
}

// The answer card is announced politely, and only once the window stops moving.
let liveTimer = 0;
function say(text) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { $('live').textContent = text; }, 800);
}

function restore(hash) {
  state = decode(hash);
  update({ scroll: true });
  toast('Restored.');
}

/* ---------- state flow ---------- */

function update({ keep = false, scroll = false } = {}) {
  state.people = groupPeople(state.people).flat(); // people in the same city sit together
  const hash = encode(state);
  history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
  if (remember) store(hash);

  const zone = state.utc ? 'UTC' : VIEWER;
  const date = state.date || dateIn(zone, Date.now());
  const { start, end } = dayRange(date, zone);
  view = { zone, date, start, end, ...analyze(state.people, start, end, meetLen) };

  const has = state.people.length > 0;
  document.body.classList.toggle('is-empty', !has);
  $('result').hidden = !has;
  $('team-row').hidden = !has;
  $('link-out').value = location.href;
  $('card-out').hidden = true;
  renderChips();
  if (!has) return;
  if (!keep || sel >= view.n) sel = bestAt();
  renderToolbar();
  renderTimeline();
  renderAnswer();
  renderCompare();
  if (scroll) scrollToWindow();
}

function load() {
  // A plain anchor such as #faq is not a team: keep the team on screen (and put its link back), or open the remembered one.
  const team = location.hash.includes('=') ? location.hash.slice(1) : '';
  if (!team && location.hash.length > 1 && state.people.length) { update({ keep: true }); return; }
  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch { /* storage blocked */ }
  remember = saved != null;
  $('remember').checked = remember;
  state = decode(team || saved || '');
  if ($('dlg').open) $('dlg').close();
  update({ scroll: true });
  $('compare-d').open = state.slots.length > 0;
}

/* ---------- team chips ---------- */

function renderChips() {
  const now = Date.now();
  $('chips').replaceChildren(...groupPeople(state.people).map(g => {
    const p = g[0], city = cityOf(p), s = statusAt(p, now), label = g.length > 1 ? city : p.name || city;
    const b = btn('chip');
    b.dataset.key = groupKey(p);
    b.setAttribute('aria-haspopup', 'dialog');
    // The accessible name is the visible text plus hidden context ("Edit Sam, San Francisco, 11:01 working"), so voice control matches what is on screen.
    const name = el('span', 'chip-name', el('span', 'vh', 'Edit '), label);
    if (g.length > 1) name.append(el('span', 'count', String(g.length)), el('span', 'vh', ' people'));
    else if (p.name) name.append(el('span', 'vh', `, ${city}`));
    b.append(avatar(label, s), el('span', 'chip-text', name, el('span', 'chip-meta', el('span', 'vh', ', '), `${hhmm(p.tz, now)} ${NOW_WORD[s]}`)));
    return el('li', null, b);
  }));
}

/* ---------- toolbar ---------- */

function renderToolbar() {
  $('date').value = view.date;
  $('today').hidden = !state.date;
  document.querySelector(`input[name="ref"][value="${state.utc ? 'utc' : 'local'}"]`).checked = true;
  $('len').value = String(meetLen);

  const byZone = new Map();
  for (const g of groupPeople(state.people)) byZone.set(g[0].tz, [...(byZone.get(g[0].tz) || []), cityOf(g[0])]);
  const items = [];
  for (const [tz, cities] of byZone) for (const ch of clockChanges(tz, view.start, 14)) items.push({ tz, cities, ...ch });
  items.sort((a, b) => a.at - b.at);
  $('dst').hidden = !items.length;
  if (!items.length) return;
  const when = (tz, at) => {
    if (state.date) return `on ${dayText(tz, at)}`;
    const d = Math.round((Date.parse(dateIn(tz, at)) - Date.parse(dateIn(tz, Date.now()))) / DAY_MS);
    return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
  };
  const plural = x => x.cities.length > 1;
  const first = items[0];
  $('dst-text').textContent = `${list(first.cities)} ${plural(first) ? 'change' : 'changes'} clocks ${when(first.tz, first.at)}${items.length > 1 ? `, plus ${items.length - 1} more` : ''}`;
  const full = `Daylight saving: ${items.map(x => `${list(x.cities)} ${plural(x) ? 'move' : 'moves'} clocks ${x.to > x.from ? 'forward' : 'back'} ${dur(Math.abs(x.to - x.from))} ${when(x.tz, x.at)}`).join('. ')}. The overlap shifts after that, so check the date you meet.`;
  $('dst-full').textContent = full;
  $('dst').title = full;
}

/* ---------- timeline ---------- */

const pct = i => `${(i / view.n) * 100}%`;

function renderTimeline() {
  const { n, status, zone, start, best } = view;
  const ticks = [];
  for (let c = 0; c * 4 < n; c++) {
    const t = el('span', c % 3 ? 'tick' : 'tick h3', el('span', null, shortHour(hhmm(zone, start + c * HOUR_MS))));
    t.style.left = pct(c * 4);
    ticks.push(t);
  }
  $('tl-ruler').replaceChildren(...ticks, el('span', 'tick-now', 'Now'));

  $('tl-labels').replaceChildren(...state.people.map(p => {
    const city = cityOf(p);
    const row = el('div', 'tl-who', avatar(p.name || city),
      el('span', 'who', el('span', 'who-name', p.name || city), el('span', 'tl-meta', el('span', null, p.name ? city : offsetText(p.tz, start + 12 * HOUR_MS)), el('b'))));
    row.title = `${who(p)}, ${p.tz}, works ${clock(p.start)} to ${clock(p.end)} local`;
    return row;
  }));

  $('tl-rows').replaceChildren(...status.map(st => {
    const bar = el('div', 'tl-bar');
    for (const r of runs(st)) {
      if (r.s === 'asleep') continue; // the bar itself is the night pattern
      const seg = el('i', `run ${r.s}`);
      seg.style.left = pct(r.from);
      seg.style.width = pct(r.to - r.from);
      bar.append(seg);
    }
    return bar;
  }));

  const band = $('tl-best');
  band.hidden = !best.full;
  document.querySelector('.legend .sw.best').parentElement.hidden = !best.full;
  if (best.full) {
    const from = (best.start - start) / SLOT_MS;
    band.style.left = pct(from);
    band.style.width = pct(Math.min(n, (best.end - start) / SLOT_MS) - from);
  }
  $('tl').style.setProperty('--n', n);
  renderNow();
  placeWindow();
}

function renderNow() {
  const now = Date.now(), on = now >= view.start && now < view.end;
  const line = $('tl-now'), tag = $('tl-ruler').querySelector('.tick-now');
  line.hidden = tag.hidden = !on;
  if (on) line.style.left = tag.style.left = pct((now - view.start) / SLOT_MS);
}

function placeWindow() {
  const w = $('tl-win'), t = selMs();
  w.style.setProperty('--k', slots());
  w.style.setProperty('--s', sel);
  w.setAttribute('aria-valuemin', '0');
  w.setAttribute('aria-valuemax', String(Math.max(0, view.n - slots())));
  w.setAttribute('aria-valuenow', String(sel));
  w.setAttribute('aria-valuetext', `${hhmm(view.zone, t)} to ${hhmm(view.zone, t + meetLen * 60000)} ${refName(t)}`);
  $('tl-labels').querySelectorAll('.tl-meta b').forEach((b, i) => { b.textContent = hhmm(state.people[i].tz, t); });
}

function scrollToWindow(smooth = false) {
  const sc = $('tl-scroll');
  if (sc.scrollWidth <= sc.clientWidth) return;
  const labels = $('tl-labels').offsetWidth, track = $('tl-rows').offsetWidth;
  const centre = (track * (sel + slots() / 2)) / view.n;
  sc.scrollTo({ left: centre - (sc.clientWidth - labels) / 2, behavior: smooth ? 'smooth' : 'instant' });
}

function keepWindowVisible() {
  const sc = $('tl-scroll'), labels = $('tl-labels').offsetWidth, track = $('tl-rows').offsetWidth;
  const a = (track * sel) / view.n, b = (track * (sel + slots())) / view.n;
  if (a < sc.scrollLeft || b > sc.scrollLeft + sc.clientWidth - labels) scrollToWindow(true);
}

function setSel(i, { visible = false } = {}) {
  if (i === sel) return;
  sel = i;
  placeWindow();
  renderAnswer();
  if (visible) keepWindowVisible();
}

/* ---------- answer card ---------- */

function describe(t, minutes, atBest) {
  const parts = groupPeople(state.people).map(g => {
    const r = worst(g.map(p => rate(p, t, minutes)));
    return `${localAt(g[0].tz, t)} in ${cityOf(g[0])}${BAD.has(r) ? ` (${r})` : ''}`;
  });
  return `${atBest ? 'Best time' : 'Selected'}: ${hhmm(view.zone, t)} to ${hhmm(view.zone, t + minutes * 60000)} ${refName(t)}. That is ${parts.join(', ')}.`;
}

function renderAnswer() {
  const t = selMs(), m = meetLen, end = t + m * 60000, zone = view.zone, best = view.best;
  const atBest = sel === bestAt();
  const ratings = state.people.map(p => rate(p, t, m));
  const total = ratings.reduce((sum, r) => sum + PAIN[r], 0);

  $('ans-kicker').textContent = atBest ? 'Best time to meet' : 'Selected time';
  $('ans-time').replaceChildren(hhmm(zone, t), el('span', 'to', 'to'), hhmm(zone, end));
  $('ans-date').textContent = `${dayText(zone, t)}, ${state.utc ? 'UTC' : `your time (${refName(t)})`}`;
  $('ans-utc').textContent = state.utc ? '' : `${hhmm('UTC', t)} to ${hhmm('UTC', end)} UTC`;

  const outside = ratings.filter(r => BAD.has(r)).length;
  let note;
  if (atBest && best.full) {
    const span = (best.end - best.start) / 60000;
    note = span > m ? `Everyone is inside working hours from ${hhmm(zone, best.start)} to ${hhmm(zone, best.end)}, ${dur(span)} in all.` : 'Everyone is inside working hours.';
  } else if (atBest) {
    note = `No time on this date has everyone inside working hours, so this is the least painful ${m === 60 ? 'hour' : dur(m)}.`;
  } else {
    note = outside ? `${outside} of ${ratings.length} ${outside === 1 ? 'person is' : 'people are'} outside working hours.` : 'Everyone is inside working hours.';
  }
  $('ans-note').textContent = note;
  const bestTotal = atBest ? total : state.people.reduce((sum, p) => sum + PAIN[rate(p, best.start, m)], 0);
  $('ans-score').textContent = `Pain score ${total}${atBest ? '' : ` (best time: ${bestTotal})`}`;
  // Hidden with visibility, not removed, so the card keeps its height while the window is dragged.
  $('back-best').classList.toggle('is-off', atBest);

  $('ans-people').replaceChildren(...state.people.map((p, i) => {
    const city = cityOf(p), r = ratings[i];
    const time = el('span', 'who-time', hhmm(p.tz, t));
    if (dateIn(p.tz, t) !== dateIn(zone, t)) time.append(el('small', null, weekday(p.tz, t)));
    return el('li', null, avatar(p.name || city),
      el('span', 'who', el('span', 'who-name', p.name || city), el('span', 'who-city', p.name ? city : offsetText(p.tz, t))),
      time, el('span', `rate ${r}`, icon(r), RATE_LABEL[r]));
  }));

  const sentence = `${describe(t, m, atBest)} Pain score ${total}.`;
  $('ans-sentence').textContent = sentence;
  say(sentence);
}

/* ---------- compare ---------- */

function renderCompare() {
  $('compare-count').textContent = state.slots.length ? String(state.slots.length) : '';
  if (!state.slots.length) {
    $('compare-table').replaceChildren();
    $('rotate').hidden = true;
    return;
  }
  const cands = state.slots.map(s => ({ ...s, at: slotAt(s) }));
  const ratings = cands.map(c => state.people.map(p => rate(p, c.at, c.len)));
  const totals = ratings.map(rs => rs.reduce((sum, r) => sum + PAIN[r], 0));
  const low = Math.min(...totals);
  const unique = totals.filter(x => x === low).length === 1;

  const head = el('tr', null, el('th', null, 'Person'));
  cands.forEach((c, k) => {
    const time = `${hhmm(view.zone, c.at)} to ${hhmm(view.zone, c.at + c.len * 60000)} ${refName(c.at)}`;
    const show = btn('btn btn-ghost btn-sm', 'Show');
    show.dataset.show = k;
    show.setAttribute('aria-label', `Show ${time} on the timeline`);
    const cal = btn('btn btn-ghost btn-sm', '.ics');
    cal.dataset.ics = k;
    cal.setAttribute('aria-label', `Add ${time} to calendar`);
    const rm = btn('btn btn-ghost btn-sm', 'Remove');
    rm.dataset.rm = k;
    rm.setAttribute('aria-label', `Remove ${time}`);
    const th = el('th', null, el('span', null, time), el('span', 'cand-acts', show, cal, rm));
    th.scope = 'col';
    head.append(th);
  });
  const tbody = el('tbody');
  state.people.forEach((p, i) => {
    const th = el('th', null, who(p));
    th.scope = 'row';
    tbody.append(el('tr', null, th, ...cands.map((c, k) => el('td', null, el('span', `rate ${ratings[k][i]}`, icon(ratings[k][i]), RATE_LABEL[ratings[k][i]]), localAt(p.tz, c.at)))));
  });
  const footTh = el('th', null, 'Pain score');
  footTh.scope = 'row';
  const foot = el('tr', null, footTh, ...totals.map(t => el('td', null, String(t), cands.length > 1 && t === low && unique ? el('span', 'fairest', 'fairest') : null)));
  const table = el('table', null, el('caption', 'vh', 'Rating per person for each pinned time, with the total pain score'), el('thead', null, head), tbody, el('tfoot', null, foot));
  $('compare-table').replaceChildren(table);

  const hit = cands.length > 1 ? state.people.filter((p, i) => ratings.every(rs => BAD.has(rs[i]))) : [];
  $('rotate').hidden = !hit.length;
  $('rotate').textContent = hit.length
    ? `Rotate the pain: ${list(hit.map(nameOf))} ${hit.length > 1 ? 'get' : 'gets'} an early, late or asleep slot in every candidate. Take turns between these times so the same people are not always the ones stretching.`
    : '';
}

/* ---------- city search ---------- */

let cities = null;
let results = [];
let active = -1;
let searched = false;
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
    toast('City search could not load. You can still type a time zone like Asia/Kolkata.');
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

function marked(text, q) {
  const [range] = highlight(text, q);
  return range ? [text.slice(0, range[0]), el('mark', null, text.slice(...range)), text.slice(range[1])] : [text];
}

function showResults() {
  const input = $('add-city'), ul = $('city-list'), q = input.value, now = Date.now();
  const items = results.map((r, k) => {
    const name = r.raw ? r.tz : r.name;
    const li = el('li', 'opt', icon(r.raw ? 'globe' : 'pin'),
      el('span', 'opt-text', el('span', 'opt-name', ...marked(name, r.raw ? q : q.split(',')[0])),
        el('span', 'opt-where', r.raw ? 'Time zone' : [r.region, country(r.cc)].filter(Boolean).join(', '))),
      el('span', 'opt-when', el('span', 'opt-time', hhmm(r.tz, now)), el('span', 'opt-off', offsetText(r.tz, now))));
    li.id = `opt-${k}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(k === active));
    li.dataset.k = k;
    return li;
  });
  if (!items.length && searched && q.trim()) {
    const li = el('li', 'opt', icon('search'), el('span', 'opt-text', el('span', 'opt-name', 'No matches'), el('span', 'opt-where', 'Try a bigger nearby city, or a time zone like Asia/Kolkata')));
    li.setAttribute('role', 'option');
    li.setAttribute('aria-disabled', 'true');
    li.setAttribute('aria-selected', 'false');
    items.push(li);
  }
  ul.replaceChildren(...items);
  ul.hidden = !items.length;
  input.setAttribute('aria-expanded', String(items.length > 0));
  if (active >= 0 && results.length) input.setAttribute('aria-activedescendant', `opt-${active}`);
  else input.removeAttribute('aria-activedescendant');
  $(`opt-${active}`)?.scrollIntoView({ block: 'nearest' });
}

function closeResults() {
  results = [];
  active = -1;
  searched = false;
  showResults();
}

function addPerson(r) {
  if (state.people.length >= MAX_PEOPLE) {
    toast(`A team can have up to ${MAX_PEOPLE} people.`);
    return;
  }
  const name = $('add-name').value.trim().slice(0, 40);
  const p = { name, city: r.raw ? '' : r.name, tz: r.tz, start: DEFAULT_START, end: DEFAULT_END };
  state.people.push(p);
  $('add-name').value = '';
  $('add-city').value = '';
  closeResults();
  update({ scroll: true });
  toast(`Added ${nameOf(p)}. ${name ? 'Select them to change hours.' : 'Select the person to add a name or change hours.'}`);
  // Next teammate starts at the name, so adding a whole team is: name, city, Enter, repeat.
  $('add-name').focus();
}

/* ---------- person dialog ---------- */

const dlg = $('dlg');
let dlgKey = null;
let uid = 0;
const currentGroup = () => groupPeople(state.people).find(g => groupKey(g[0]) === dlgKey);
const hoursNote = p => (p.end === p.start ? 'All day' : p.end < p.start ? `Overnight, ${dur((p.end - p.start + 1440) % 1440)}` : dur(p.end - p.start));

function openPerson(key) {
  dlgKey = key;
  renderDialog();
  dlg.showModal();
}

function renderDialogHead() {
  const g = currentGroup();
  if (!g) return false;
  const p = g[0], city = cityOf(p), now = Date.now(), title = g.length > 1 ? city : p.name || city;
  $('dlg-avatar').textContent = initials(title);
  $('dlg-h').textContent = title;
  $('dlg-sub').textContent = `${p.name && g.length === 1 ? `${city}, ` : ''}${p.tz.replace(/_/g, ' ')}, ${offsetText(p.tz, now)}, ${hhmm(p.tz, now)} there now`;
  const gs = groupPeople(state.people), i = gs.findIndex(x => groupKey(x[0]) === dlgKey);
  $('dlg-earlier').disabled = i === 0;
  $('dlg-later').disabled = i === gs.length - 1;
  $('dlg-add-text').textContent = `Add someone else in ${city}`;
  return true;
}

function renderDialog() {
  if (!renderDialogHead()) { dlg.close(); return; }
  const g = currentGroup();
  $('dlg-people').replaceChildren(...g.map((p, i) => personForm(p, i, g.length)));
}

function personForm(p, i, count) {
  const id = `pp${++uid}`;
  const nameLabel = el('label', 'field-label', count > 1 ? `Person ${i + 1}, name` : 'Name');
  nameLabel.htmlFor = `${id}-name`;
  const name = Object.assign(el('input', 'input'), { id: `${id}-name`, type: 'text', value: p.name, maxLength: 40, placeholder: 'Optional', autocomplete: 'off' });
  name.addEventListener('input', () => {
    p.name = name.value.slice(0, 40);
    update({ keep: true });
    renderDialogHead();
  });

  const hoursLabel = el('span', 'field-label', 'Working hours, local time');
  hoursLabel.id = `${id}-hours`;
  const note = el('span', 'pp-note', hoursNote(p));
  const timeButton = field => {
    const b = btn('select-btn');
    const word = field === 'start' ? 'Starts' : 'Ends';
    const sync = () => {
      b.textContent = clock(p[field]);
      b.setAttribute('aria-label', `${word} at ${clock(p[field])}`);
      note.textContent = hoursNote(p);
    };
    b.setAttribute('aria-haspopup', 'listbox');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-describedby', hoursLabel.id);
    b.addEventListener('click', () => openPicker(b, p[field], `${word}, ${nameOf(p)}`, v => {
      p[field] = v;
      sync();
      update();
    }));
    sync();
    return b;
  };

  const rm = btn('btn btn-danger btn-sm', icon('trash'), 'Remove');
  rm.setAttribute('aria-label', `Remove ${nameOf(p)}`);
  rm.addEventListener('click', () => removePerson(p));
  return el('div', 'pp',
    el('div', null, nameLabel, name),
    el('div', null, hoursLabel, el('div', 'pp-hours', timeButton('start'), el('span', 'to', 'to'), timeButton('end'), note)),
    el('div', 'pp-row', el('span'), rm));
}

function removePerson(p) {
  const snap = encode(state);
  state.people.splice(state.people.indexOf(p), 1);
  update();
  if (currentGroup()) {
    renderDialog();
    dlg.querySelector('.pp .input')?.focus();
  } else if (dlg.open) {
    dlg.close();
  }
  toast(`Removed ${nameOf(p)}.`, () => restore(snap));
}

function moveCurrent(d) {
  state.people = moveGroup(state.people, dlgKey, d);
  update({ keep: true });
  renderDialogHead();
  const b = $(d < 0 ? 'dlg-earlier' : 'dlg-later');
  if (b.disabled) $(d < 0 ? 'dlg-later' : 'dlg-done').focus();
  toast(d < 0 ? 'Moved earlier in the team.' : 'Moved later in the team.');
}

/* ---------- time picker: a button that opens a listbox of 15 minute times ---------- */

const tp = $('tp'), tpList = $('tp-list');
let tpBtn = null, tpDone = null, tpActive = 0, typed = '', typedAt = 0;
tpList.append(...QUARTERS.map((m, i) => {
  const li = el('li', 'opt', el('span', null, clock(m)), icon('check'));
  li.id = `tp-${i}`;
  li.dataset.i = i;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', 'false');
  return li;
}));

function tpSet(i, block = 'nearest') {
  tpList.children[tpActive].setAttribute('aria-selected', 'false');
  tpActive = i;
  const li = tpList.children[i];
  li.setAttribute('aria-selected', 'true');
  tpList.setAttribute('aria-activedescendant', li.id);
  if (block) li.scrollIntoView({ block });
}

function openPicker(b, value, label, done) {
  tpBtn = b;
  tpDone = done;
  tpList.setAttribute('aria-label', label);
  for (const li of tpList.children) li.toggleAttribute('data-current', Number(li.dataset.i) === value / 15);
  tp.showPopover();
  const r = b.getBoundingClientRect(), h = tp.offsetHeight, w = tp.offsetWidth;
  tp.style.left = `${clamp(r.left, 8, innerWidth - w - 8)}px`;
  tp.style.top = `${innerHeight - r.bottom >= h + 12 || r.top < h + 12 ? r.bottom + 6 : r.top - h - 6}px`;
  b.setAttribute('aria-expanded', 'true');
  tpList.focus({ preventScroll: true });
  tpSet(value / 15, 'center');
}

function closePicker(commit) {
  if (commit) tpDone?.(QUARTERS[tpActive]);
  if (tp.matches(':popover-open')) tp.hidePopover();
  tpBtn?.focus();
}

tp.addEventListener('toggle', e => {
  if (e.newState !== 'closed') return;
  tpBtn?.setAttribute('aria-expanded', 'false');
  if (tp.contains(document.activeElement) || document.activeElement === document.body) tpBtn?.focus();
});
tpList.addEventListener('keydown', e => {
  const i = stepKey(e.key, tpActive, QUARTERS.length - 1, { list: true });
  if (i != null) { e.preventDefault(); tpSet(i); return; }
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') { e.preventDefault(); closePicker(true); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(false); }
  else if (/^[0-9:]$/.test(e.key)) {
    typed = (e.timeStamp - typedAt < 1000 ? typed : '') + e.key;
    typedAt = e.timeStamp;
    const j = typeahead(typed, QUARTERS);
    if (j >= 0) tpSet(j, 'center');
  }
});
tpList.addEventListener('click', e => {
  const li = e.target.closest('[data-i]');
  if (!li) return;
  tpSet(Number(li.dataset.i), null);
  closePicker(true);
});
tpList.addEventListener('pointermove', e => {
  const li = e.target.closest('[data-i]');
  if (li && e.pointerType === 'mouse' && Number(li.dataset.i) !== tpActive) tpSet(Number(li.dataset.i), null);
});

/* ---------- events: team ---------- */

$('add-name').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('add-city').focus();
});
$('add-name').addEventListener('focus', () => loadCities(), { once: true });
$('add-city').addEventListener('pointerdown', () => loadCities());
$('add-city').addEventListener('input', async e => {
  const q = e.target.value;
  if (!q.trim()) { closeResults(); return; }
  const data = await loadCities();
  if (e.target.value !== q) return;
  results = search(data, q);
  active = results.length ? 0 : -1;
  searched = true;
  showResults();
});
$('add-city').addEventListener('keydown', async e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!results.length) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    showResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const q = e.target.value;
    if (!q.trim()) return;
    if (!results.length) {
      results = search(await loadCities(), q);
      active = results.length ? 0 : -1;
      searched = true;
    }
    if (results[active]) addPerson(results[active]); else showResults();
  } else if (e.key === 'Escape') {
    if ($('city-list').hidden) e.target.value = ''; else closeResults();
  }
});
$('add-city').addEventListener('blur', closeResults);
$('city-list').addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input
$('city-list').addEventListener('click', e => {
  const li = e.target.closest('[data-k]');
  if (li) addPerson(results[Number(li.dataset.k)]);
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  const preset = PRESETS.find(x => x.id === b.dataset.preset);
  state = decode(preset.hash);
  update({ scroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('ans-time').focus({ preventScroll: true });
  toast(`${preset.label} loaded. Select a person to edit.`);
});

$('chips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (chip) openPerson(chip.dataset.key);
});
$('clear').addEventListener('click', () => {
  const snap = encode(state);
  state.people = [];
  state.slots = [];
  update();
  $('add-city').focus();
  toast('Team cleared.', () => restore(snap));
});

$('dlg-close').addEventListener('click', () => dlg.close());
$('dlg-done').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // backdrop
dlg.addEventListener('close', () => {
  if (tp.matches(':popover-open')) tp.hidePopover();
  const chip = [...$('chips').querySelectorAll('.chip')].find(c => c.dataset.key === dlgKey);
  dlgKey = null;
  (chip || $('add-city')).focus();
});
$('dlg-earlier').addEventListener('click', () => moveCurrent(-1));
$('dlg-later').addEventListener('click', () => moveCurrent(1));
$('dlg-add').addEventListener('click', () => {
  const g = currentGroup();
  if (!g) return;
  if (state.people.length >= MAX_PEOPLE) { toast(`A team can have up to ${MAX_PEOPLE} people.`); return; }
  const { city, tz, start, end } = g[0];
  state.people.push({ name: '', city, tz, start, end });
  update({ keep: true });
  renderDialog();
  [...dlg.querySelectorAll('.pp .input')].at(-1)?.focus();
});

$('toast-undo').addEventListener('click', () => {
  const f = undoFn;
  hideToast(true);
  f?.();
});

/* ---------- events: toolbar ---------- */

$('date').addEventListener('change', e => {
  if (!e.target.value) return;
  state.date = e.target.value;
  update({ scroll: true });
});
const shiftDay = d => { state.date = shiftDate(view.date, d); update({ scroll: true }); };
$('prev-day').addEventListener('click', () => shiftDay(-1));
$('next-day').addEventListener('click', () => shiftDay(1));
$('today').addEventListener('click', () => {
  state.date = '';
  update({ scroll: true });
  $('date').focus();
});
for (const r of document.querySelectorAll('input[name="ref"]')) {
  r.addEventListener('change', () => {
    state.utc = r.value === 'utc';
    update({ scroll: true });
  });
}
$('len').addEventListener('change', e => {
  meetLen = Number(e.target.value);
  update({ scroll: true });
});

/* ---------- events: meeting window (pointer and keyboard) ---------- */

const body = $('tl-body'), win = $('tl-win');
const trackX = e => { const r = $('tl-rows').getBoundingClientRect(); return [e.clientX - r.left, r.width]; };

body.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !view) return;
  const [x, width] = trackX(e);
  const onWin = Boolean(e.target.closest('#tl-win'));
  drag = { id: e.pointerId, x0: e.clientX, onWin, touch: e.pointerType !== 'mouse', grab: onWin ? (x / width) * view.n - sel : slots() / 2, moved: false };
  if (!drag.touch) e.preventDefault(); // no text selection while dragging with a mouse
});
body.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.x0) < 6) return;
    if (drag.touch && !drag.onWin) { drag = null; return; } // a finger on the bars scrolls the timeline instead
    drag.moved = true;
    body.setPointerCapture(e.pointerId);
    win.classList.add('is-dragging');
  }
  setSel(windowStart(...trackX(e), view.n, slots(), drag.grab));
});
function endDrag(e, cancel) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!cancel && !drag.moved && !drag.onWin) setSel(windowStart(...trackX(e), view.n, slots()));
  win.classList.remove('is-dragging');
  drag = null;
  if (!cancel) win.focus({ preventScroll: true });
}
body.addEventListener('pointerup', e => endDrag(e, false));
body.addEventListener('pointercancel', e => endDrag(e, true));
win.addEventListener('keydown', e => {
  const i = stepKey(e.key, sel, Math.max(0, view.n - slots()));
  if (i == null) return;
  e.preventDefault();
  setSel(i, { visible: true });
});
$('back-best').addEventListener('click', () => {
  setSel(bestAt(), { visible: true });
  $('ans-time').focus();
});

/* ---------- events: answer, compare, share ---------- */

function calendar(start, minutes) {
  const end = start + minutes * 60000;
  const lines = state.people.map(p => `${who(p)}: ${hhmm(p.tz, start)} to ${hhmm(p.tz, end)} (${rate(p, start, minutes)})`);
  const text = ics({ start, end, summary: 'Team meeting', description: `Local times:\n${lines.join('\n')}\n\nTeam link: ${location.href}` });
  download(`overlap-${new Date(start).toISOString().slice(0, 16).replace(/[-:]/g, '')}Z.ics`, new Blob([text], { type: 'text/calendar' }));
  toast('Calendar file downloaded.');
}

const copyLink = () => copyText(location.href, 'Link copied. Anyone who opens it sees this team.');
$('copy-link').addEventListener('click', copyLink);
$('copy-link-2').addEventListener('click', copyLink);
$('ics').addEventListener('click', () => calendar(selMs(), meetLen));

$('pin').addEventListener('click', () => {
  const s = { start: utcMin(selMs()), len: meetLen };
  if (state.slots.some(x => x.start === s.start && x.len === s.len)) toast('That time is already pinned.');
  else if (state.slots.length >= MAX_SLOTS) toast(`You can compare up to ${MAX_SLOTS} times. Remove one first.`);
  else {
    state.slots.push(s);
    update({ keep: true });
    toast(state.slots.length === 1 ? 'Pinned. Move the window and pin another time to compare.' : 'Pinned. The table shows who stretches for each time.');
  }
});
$('compare-table').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.show != null) {
    const s = state.slots[Number(b.dataset.show)];
    if (s.len !== meetLen) { meetLen = s.len; update({ keep: true }); }
    setSel(clamp(Math.round((slotAt(s) - view.start) / SLOT_MS), 0, view.n - 1), { visible: true });
    $('ans-time').scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (b.dataset.ics != null) {
    const s = state.slots[Number(b.dataset.ics)];
    calendar(slotAt(s), s.len);
  } else {
    state.slots.splice(Number(b.dataset.rm), 1);
    update({ keep: true });
    toast('Removed that pinned time.');
    $('pin').focus();
  }
});

$('remember').addEventListener('change', e => {
  remember = e.target.checked;
  store(remember ? encode(state) : null);
  toast(remember ? 'This team will open next time on this device.' : 'This device will not remember the team.');
});
$('copy-li').addEventListener('click', () => copyText($('li-text').value, 'Post text copied.'));
$('make-card').addEventListener('click', async () => {
  const { drawCard } = await import('./card.js');
  const b = view.best;
  const offsets = [...new Set(state.people.map(p => p.tz))].map(z => offsetAt(z, b.start));
  const spread = Math.max(...offsets) - Math.min(...offsets);
  const n = groupPeople(state.people).length, where = `${n} ${n === 1 ? 'city' : 'cities'}`;
  const headline = spread ? `Our team spans ${hoursText(spread)} across ${where}.` : `Our team shares one time zone across ${where}.`;
  const sub = b.full ? `Best overlap: ${dur((b.end - b.start) / 60000)}.` : `No full overlap. Least painful time: ${hhmm(view.zone, b.start)} ${refName(b.start)}.`;
  const hours = [];
  for (let c = 0; c * 4 < view.n; c += 3) hours.push({ slot: c * 4, text: shortHour(hhmm(view.zone, view.start + c * HOUR_MS)) });
  const canvas = $('card');
  await drawCard(canvas, {
    headline, sub, hours, n: view.n,
    rows: state.people.slice(0, 8).map((p, i) => ({ label: who(p), status: view.status[i] })),
    more: Math.max(0, state.people.length - 8),
    best: { from: (b.start - view.start) / SLOT_MS, len: (Math.min(b.end, view.end) - b.start) / SLOT_MS, full: b.full },
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
  toast('Share card ready.');
});

/* ---------- offline status: only claims what the browser confirms ---------- */

let offlineReady = false;
function renderNet() {
  const off = !navigator.onLine;
  $('net').hidden = !off && !offlineReady;
  $('net').classList.toggle('is-offline', off);
  $('net-text').textContent = off ? 'Offline. Everything still works: your team lives in the link.' : 'Saved for offline use';
}
addEventListener('online', renderNet);
addEventListener('offline', renderNet);

/* ---------- start ---------- */

// Clocks on the chips and the now line move on; a new day starts a fresh "today".
setInterval(() => {
  if (!view || !state.people.length || drag || dlg.open) return;
  if (!state.date && dateIn(view.zone, Date.now()) !== view.date) { update(); return; }
  if (!$('chips').contains(document.activeElement)) renderChips();
  renderNow();
}, 30000);

mountAds($('showcase'), makers);
window.addEventListener('hashchange', load);
// load() rewrites the URL before the browser gets to scroll to a #faq style anchor, so scroll to it here.
const anchor = location.hash.includes('=') ? null : document.getElementById(location.hash.slice(1));
load();
document.body.classList.remove('is-booting');
anchor?.scrollIntoView();
renderNet();
// Ready to type on a first visit with a mouse; on touch screens a keyboard popping up would hide the quick starts.
if (!state.people.length && matchMedia('(pointer: fine)').matches) $('add-city').focus({ preventScroll: true }); // never undo a jump to #faq

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => {
    const check = () => { offlineReady = Boolean(navigator.serviceWorker.controller); renderNet(); };
    check();
    navigator.serviceWorker.addEventListener('controllerchange', check);
  });
}
