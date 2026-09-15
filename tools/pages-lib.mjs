// Meeting time pages: one static page per city pair, an index at /meeting-time/ and the sitemap.
// Pure functions over public/js/tz.js, the engine the app runs, so every time, offset and
// difference on a page is computed, never typed. tools/build-pages.mjs writes the result into
// public/, and test/pages.test.mjs checks the committed files still match it.
import { offsetAt, dayRange, analyze, rate, clockChanges, hhmm, dateIn, formatOffset, DAY_MS, HOUR_MS, DEFAULT_START, DEFAULT_END } from '../public/js/tz.js';
import { encode } from '../public/js/state.js';

export const SITE = 'https://overlap.vibe-coding.fans';

// Hubs pair with every other city, the rest pair with hubs only. Pairs that share a clock all year
// (Berlin and Paris, Singapore and Hong Kong) are left out.
const HUBS = [
  ['New York', 'America/New_York'], ['San Francisco', 'America/Los_Angeles'], ['Chicago', 'America/Chicago'],
  ['London', 'Europe/London'], ['Berlin', 'Europe/Berlin'], ['Dubai', 'Asia/Dubai'], ['Mumbai', 'Asia/Kolkata'],
  ['Singapore', 'Asia/Singapore'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'],
];
const OTHERS = [
  ['Los Angeles', 'America/Los_Angeles'], ['Toronto', 'America/Toronto'], ['Mexico City', 'America/Mexico_City'],
  ['São Paulo', 'America/Sao_Paulo'], ['Paris', 'Europe/Paris'], ['Amsterdam', 'Europe/Amsterdam'], ['Madrid', 'Europe/Madrid'],
  ['Bucharest', 'Europe/Bucharest'], ['Kyiv', 'Europe/Kyiv'], ['Istanbul', 'Europe/Istanbul'], ['Tel Aviv', 'Asia/Jerusalem'],
  ['Cairo', 'Africa/Cairo'], ['Lagos', 'Africa/Lagos'], ['Nairobi', 'Africa/Nairobi'], ['Johannesburg', 'Africa/Johannesburg'],
  ['Bangalore', 'Asia/Kolkata'], ['Manila', 'Asia/Manila'], ['Hong Kong', 'Asia/Hong_Kong'], ['Seoul', 'Asia/Seoul'],
  ['Auckland', 'Pacific/Auckland'],
];

export const slugify = s => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const CITIES = [...HUBS.map(c => [...c, true]), ...OTHERS.map(c => [...c, false])].map(([name, tz, hub]) => ({ name, tz, hub, slug: slugify(name) }));

const e = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ymd = iso => iso.split('-').map(Number);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);
const dayMonth = iso => `${ymd(iso)[2]} ${MONTHS[ymd(iso)[1] - 1]}`;
const fullDate = iso => `${WEEKDAYS[new Date(Date.parse(iso)).getUTCDay()]} ${dayMonth(iso)} ${ymd(iso)[0]}`;
const range = (from, to) => (from === to ? dayMonth(from) : ymd(from)[1] === ymd(to)[1] ? `${ymd(from)[2]} to ${dayMonth(to)}` : `${dayMonth(from)} to ${dayMonth(to)}`);
const joinList = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const cap = s => s[0].toUpperCase() + s.slice(1);
const amount = min => (min < 60 ? `${min} minutes` : `${min / 60} hour${min === 60 ? '' : 's'}`);
const wallAt = (ms, off) => new Date(ms + off * 60000).toISOString(); // the wall clock at ms with a given offset
const firstFitting = (candidates, min, max) => candidates.find(c => c.length >= min && c.length <= max);

const memo = new Map();
/** Clock changes in tz during the calendar year, each { at, from, to }. */
function changes(tz, year) {
  const key = tz + year;
  if (!memo.has(key)) {
    const from = Date.UTC(year, 0, 1), to = Date.UTC(year + 1, 0, 1);
    memo.set(key, clockChanges(tz, from, Math.round((to - from) / DAY_MS)).filter(c => c.at < to));
  }
  return memo.get(key);
}
// The local date a change happens on, read on the clock before it changes (Cairo goes back at 00:00 on a Friday).
const changeDate = ch => wallAt(ch.at, ch.from).slice(0, 10);

const sameClock = (a, b, year) =>
  offsetAt(a, Date.UTC(year, 0, 1)) === offsetAt(b, Date.UTC(year, 0, 1)) && JSON.stringify(changes(a, year)) === JSON.stringify(changes(b, year));

/** Every pair, slug ordered alphabetically so london-new-york exists and new-york-london does not. */
export function pairList(year) {
  const out = [];
  CITIES.forEach((a, i) => CITIES.slice(i + 1).forEach(b => {
    if (!(a.hub || b.hub) || sameClock(a.tz, b.tz, year)) return;
    const [x, y] = a.slug < b.slug ? [a, b] : [b, a];
    out.push({ a: x, b: y, slug: `${x.slug}-${y.slug}`, path: `/meeting-time/${x.slug}-${y.slug}/` });
  }));
  return out.sort((p, q) => (p.slug < q.slug ? -1 : 1));
}

/** The year cut at every clock change of either city: { start, end, from, to, offA, offB, gap } with gap = minutes a is ahead of b. */
function periods(a, b, year) {
  const cuts = [a, b].flatMap(c => changes(c.tz, year).map(ch => ({ at: ch.at, date: changeDate(ch) }))).sort((x, y) => x.at - y.at);
  const edges = [{ at: Date.UTC(year, 0, 1), date: `${year}-01-01` }, ...cuts, { at: Date.UTC(year + 1, 0, 1), date: `${year + 1}-01-01` }];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const [s, t] = [edges[i], edges[i + 1]];
    if (t.at - s.at < DAY_MS) continue; // New York and Chicago switch an hour apart: nobody works in that gap
    const offA = offsetAt(a.tz, s.at), offB = offsetAt(b.tz, s.at), last = out.at(-1);
    if (last && last.offA === offA && last.offB === offB) Object.assign(last, { end: t.at, endDate: t.date });
    else out.push({ start: s.at, end: t.at, startDate: s.date, endDate: t.date, offA, offB, gap: offA - offB });
  }
  return out.map(p => ({ ...p, from: p.startDate, to: addDays(p.endDate, -1) }));
}

/** The working day analysis the app does, for a date inside the group's longest period, in a's time zone. */
function meeting(a, b, g) {
  const p = g.periods.reduce((x, y) => (y.end - y.start > x.end - x.start ? y : x));
  const mid = dateIn(a.tz, p.start + Math.floor((p.end - p.start) / 2));
  const inside = d => { const r = dayRange(d, a.tz); return [r.start, r.end - 1].every(t => offsetAt(a.tz, t) === p.offA && offsetAt(b.tz, t) === p.offB); };
  // The Wednesday nearest the middle of the period, or the middle itself when the period is too short for one.
  const date = [addDays(mid, ((13 - new Date(Date.parse(mid)).getUTCDay()) % 7) - 3), mid].find(inside);
  if (!date) throw new Error(`${a.name}, ${b.name}: no whole day inside a period around ${mid}`);
  const { start, end } = dayRange(date, a.tz);
  const people = [a, b].map(c => ({ tz: c.tz, start: DEFAULT_START, end: DEFAULT_END }));
  const { status, best } = analyze(people, start, end, 60);
  const at = (c, t) => ({ time: hhmm(c.tz, t), day: Math.round((Date.parse(dateIn(c.tz, t)) - Date.parse(date)) / DAY_MS) });
  return {
    date,
    full: best.full,
    minutes: (best.end - best.start) / 60000,
    slot: [a, b].map((c, i) => ({ from: hhmm(c.tz, best.start), to: hhmm(c.tz, best.end), day: at(c, best.start).day, rating: rate(people[i], best.start, 60) })),
    hours: Array.from({ length: 24 }, (_, h) => ({ a: hhmm(a.tz, start + h * HOUR_MS), b: at(b, start + h * HOUR_MS), work: status.map(s => s.slice(h * 4, h * 4 + 4).every(x => x === 'work')) })),
    nine: at(b, start + 9 * HOUR_MS),
  };
}

/** Everything one pair page says, computed. */
export function pageData(pair, year) {
  const { a, b } = pair;
  const groups = [];
  for (const p of periods(a, b, year)) {
    let g = groups.find(x => x.gap === p.gap);
    if (!g) groups.push(g = { gap: p.gap, periods: [], ms: 0 });
    g.periods.push(p);
    g.ms += p.end - p.start;
  }
  groups.sort((x, y) => y.ms - x.ms || x.periods[0].start - y.periods[0].start);
  for (const g of groups) g.meet = meeting(a, b, g);
  const [usual, ...others] = groups;
  const whole = !others.length;
  const half = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 2;
  const [ca, cb] = [a, b].map(c => changes(c.tz, year));
  const mismatch = ca.length > 0 && cb.length > 0 && ca.map(changeDate).join() !== cb.map(changeDate).join();

  const pair2 = `${a.name} and ${b.name}`;
  const ahead = gap => [gap > 0 ? a : b, gap > 0 ? b : a];
  const gapText = gap => (gap === 0 ? `${pair2} are on the same time` : `${ahead(gap)[0].name} is ${amount(Math.abs(gap))} ahead of ${ahead(gap)[1].name}`);
  const gapShort = gap => (gap === 0 ? 'Same time' : `${ahead(gap)[0].name} ${amount(Math.abs(gap))} ahead`);
  const merged = g => g.periods.reduce((out, p) => {
    if (out.length && addDays(out.at(-1).to, 1) === p.from) out.at(-1).to = p.to;
    else out.push({ from: p.from, to: p.to });
    return out;
  }, []);
  const spans = g => joinList(merged(g).map(r => (r.from === r.to ? 'on ' : 'from ') + range(r.from, r.to)));
  const when = g => (whole ? `all year in ${year}` : g.ms > half ? `for most of ${year}` : `${spans(g)} ${year}`);
  const dayWords = d => (d > 0 ? ' the next day' : d < 0 ? ' the previous day' : '');
  const inCity = (s, c) => `${s.from} to ${s.to}${dayWords(s.day)} in ${c.name}`;
  const meetClause = m => (m.full
    ? `the best time is ${inCity(m.slot[0], a)}, which is ${inCity(m.slot[1], b)}, with ${amount(m.minutes)} of overlap`
    : `working hours do not overlap, and the least painful 1 hour meeting is ${inCity(m.slot[0], a)} (${m.slot[0].rating} for ${a.name}), which is ${inCity(m.slot[1], b)} (${m.slot[1].rating} for ${b.name})`);
  const changeDates = cs => joinList(cs.map(ch => fullDate(changeDate(ch)).slice(0, -5)));
  const otherSentence = g => `${cap(spans(g))} ${year}, ${gapText(g.gap)}.`;

  // A mismatch of a few weeks (the US and Europe, Europe and Australia) gets a callout of its own.
  const brief = mismatch ? others.filter(g => g.periods.every(p => p.end - p.start < 42 * DAY_MS)) : [];
  const differenceText = [`${gapText(usual.gap)} ${when(usual)}.`, ...others.filter(g => !brief.includes(g)).map(otherSentence)].join(' ');
  const callout = brief.length ? `${pair2} change clocks on different dates in ${year}, so ${joinList(brief.map(g => `${gapText(g.gap)} ${spans(g)}`))}.` : '';

  const s0 = usual.meet.slot;
  const lead = `${gapText(usual.gap)} ${when(usual)}. ${usual.meet.full
    ? `With 09:00 to 17:00 working hours in both cities, the best time to meet is ${inCity(s0[0], a)}, which is ${inCity(s0[1], b)}.`
    : `Their 09:00 to 17:00 working hours do not overlap, so the least painful 1 hour meeting is ${inCity(s0[0], a)}, which is ${inCity(s0[1], b)}.`}`;

  let clocks;
  if (!ca.length && !cb.length) clocks = `Neither city changes its clocks, so ${gapText(usual.gap)} all year in ${year}.`;
  else if (!ca.length || !cb.length) {
    const [still, moves] = ca.length ? [b, a] : [a, b];
    clocks = `No. ${still.name} stays on ${formatOffset(offsetAt(still.tz, Date.UTC(year, 0, 1)))} all year, while ${moves.name} changes clocks on ${changeDates(changes(moves.tz, year))} ${year}, so the time difference changes when ${moves.name} does.`;
  } else if (!mismatch) clocks = `Yes. Both change clocks on ${changeDates(ca)} ${year}, so ${whole ? `${gapText(usual.gap)} all year` : 'the time difference still changes briefly'}.`;
  else clocks = `No. In ${year} ${a.name} changes clocks on ${changeDates(ca)}, and ${b.name} on ${changeDates(cb)}. ${others.map(otherSentence).join(' ')}`;

  const nine = g => `${g.meet.nine.time}${dayWords(g.meet.nine.day)}`;
  const faq = [
    { q: `What is the time difference between ${pair2}?`, a: [`${gapText(usual.gap)} ${when(usual)}.`, ...others.map(otherSentence)].join(' ') },
    { q: `What is the best time for a meeting between ${pair2}?`, a: [`${cap(when(usual))}, ${meetClause(usual.meet)}.`, ...others.map(g => `${cap(spans(g))} ${year}, ${meetClause(g.meet)}.`), 'These times assume 09:00 to 17:00 working hours in both cities.'].join(' ') },
    { q: `Do ${pair2} change clocks on the same day?`, a: clocks },
    { q: `When it is 09:00 in ${a.name}, what time is it in ${b.name}?`, a: `It is ${joinList([`${nine(usual)} in ${b.name} ${when(usual)}`, ...others.map(g => `${nine(g)} ${spans(g)}`)])}.` },
  ];

  const offsetsOf = c => [...new Set([offsetAt(c.tz, Date.UTC(year, 0, 1)), ...changes(c.tz, year).map(ch => ch.to)])].sort((x, y) => x - y);
  const clockItem = c => {
    const cs = changes(c.tz, year);
    if (!cs.length) return `${c.name} stays on ${formatOffset(offsetsOf(c)[0])} all year and does not change clocks.`;
    const [std, dst] = offsetsOf(c);
    return `${c.name} is on ${formatOffset(std)} in standard time and ${formatOffset(dst)} in daylight saving time. Clocks go ${joinList(cs.map(ch => `${ch.to > ch.from ? 'forward' : 'back'} ${amount(Math.abs(ch.to - ch.from))} at ${wallAt(ch.at, ch.from).slice(11, 16)} on ${fullDate(changeDate(ch))}`))}.`;
  };
  const offsetCell = (c, off) => formatOffset(off) + (changes(c.tz, year).length ? (off > offsetsOf(c)[0] ? ', daylight saving' : ', standard') : '');

  const gaps = groups.map(g => g.gap);
  const sameSign = gaps.every(g => g > 0) || gaps.every(g => g < 0);
  const [lo, hi] = [Math.min(...gaps.map(Math.abs)), Math.max(...gaps.map(Math.abs))];
  const spread = sameSign ? `${ahead(gaps[0])[0].name} is ${lo / 60} to ${amount(hi)} ahead of ${ahead(gaps[0])[1].name}` : `${pair2} are up to ${amount(hi)} apart`;
  const aT = `${s0[0].from} to ${s0[0].to}`, bT = `${s0[1].from} to ${s0[1].to}${dayWords(s0[1].day)}`;
  const descDiff = [...(whole || usual.ms > half ? [`${gapText(usual.gap)} ${when(usual)}.`] : []), ...(whole ? [] : [`${spread} in ${year}.`])];
  const descMeet = usual.meet.full
    ? [` Working 09:00 to 17:00, they share ${amount(usual.meet.minutes)}: ${aT} in ${a.name}, ${bT} in ${b.name}.`, ` Working 09:00 to 17:00, they share ${amount(usual.meet.minutes)}, ${aT} in ${a.name}.`, ` Best meeting time: ${aT} in ${a.name}.`]
    : [` Working hours do not overlap. Best 1 hour slot: ${aT} in ${a.name}, ${bT} in ${b.name}.`, ` Working hours do not overlap. Best slot: ${aT} in ${a.name}.`];
  const tails = ['', ' Hour by hour table included.', ' Plus clock changes and an hour by hour table.', ' With clock change dates.', ' Free, no signup.', ' See the hour by hour table and clock change dates.'];
  const description = firstFitting(descDiff.flatMap(d => descMeet.flatMap(m => tails.map(t => d + m + t))), 140, 155);
  const title = firstFitting([
    `Best Meeting Time for ${pair2} | Overlap`,
    `${pair2} Meeting Time | Overlap`,
    `${a.name} to ${b.name} Time Difference and Meeting Time | Overlap`,
  ], 50, 60);
  if (!title || !description) throw new Error(`${pair.slug}: no title or description fits`);

  return {
    ...pair, year, title, description, lead, differenceText, callout, faq,
    url: SITE + pair.path,
    appLink: '/#' + encode({ date: '', people: [a, b].map(c => ({ name: '', city: c.name, tz: c.tz, start: DEFAULT_START, end: DEFAULT_END })), slots: [], utc: false }),
    usualText: gapText(usual.gap),
    overlapRows: groups.map(g => ({
      gap: gapShort(g.gap),
      when: whole ? 'All year' : g.ms > half ? 'Most of the year' : cap(joinList(merged(g).map(r => range(r.from, r.to)))),
      meet: g.meet,
    })),
    periodRows: groups.flatMap(g => g.periods).sort((x, y) => x.start - y.start)
      .map(p => ({ range: range(p.from, p.to), a: offsetCell(a, p.offA), b: offsetCell(b, p.offB), gap: gapShort(p.gap) })),
    clockItems: [clockItem(a), clockItem(b)],
    usualDate: fullDate(usual.meet.date),
    checkedDates: joinList(groups.map(g => dayMonth(g.meet.date))) + ` ${year}`,
    hours: usual.meet.hours,
    noteOthers: !whole,
  };
}

// ---------- rendering ----------

const LOGO = '<svg class="mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#2563EB"/><circle cx="12.5" cy="16" r="6.5" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="19.5" cy="16" r="6.5" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M16 10.6a6.5 6.5 0 0 1 0 10.8 6.5 6.5 0 0 1 0-10.8Z" fill="#34D399"/></svg>';

const breadcrumb = items => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) });

function layout({ title, description, url, jsonLd, crumbs, body, today }) {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': jsonLd }, null, 2).replace(/</g, '\\u003c');
  const trail = crumbs.map(([name, href], i) => (i === crumbs.length - 1 ? `<li><span aria-current="page">${e(name)}</span></li>` : `<li><a href="${href}">${e(name)}</a></li>`)).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F8FAFC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B1220" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/pages.css">
<link rel="canonical" href="${url}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">
<meta property="og:site_name" content="Overlap">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Overlap: a timeline showing when a team in six cities is working, awake and asleep, with the best time to meet highlighted.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<script type="application/ld+json">
${ld}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="pg">
  <header class="top">
    <a class="brand" href="/" aria-label="Overlap home">
      ${LOGO}
      Overlap
    </a>
    <nav class="pg-nav" aria-label="Site"><a href="/meeting-time/">All city pairs</a><a href="/">Plan a team</a></nav>
  </header>

  <main id="main" class="pg-main">
    <nav class="crumbs" aria-label="Breadcrumb"><ol>${trail}</ol></nav>
${body}
  </main>

  <footer class="foot">
    <p>Times are worked out with the same time zone engine as the Overlap app, from the IANA time zone database. Last updated ${fullDate(today)}.</p>
    <a class="vcf-home" href="https://vibe-coding.fans/"><svg viewBox="0 0 66 66" width="30" height="30" aria-hidden="true"><rect x="6" y="6" width="58" height="58" rx="16" fill="#0B0B0F"/><rect x="2" y="2" width="54" height="54" rx="14" fill="#FF4FA3" stroke="#0B0B0F" stroke-width="4"/><path d="M26 18 13 29l13 11M33 18h7.5a5.5 5.5 0 0 1 0 11H36m4.5 0a5.5 5.5 0 0 1 0 11H33" fill="none" stroke="#0B0B0F" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>More free apps on <b>vibe-coding.fans</b></span></a>
    <p><a href="https://github.com/qxZap/overlap">Source on GitHub</a>, MIT License.</p>
  </footer>
</div>
</body>
</html>
`;
}

const pairName = p => `${p.a.name} and ${p.b.name}`;
const linkList = pairs => `<ul class="links">${pairs.map(p => `<li><a href="${p.path}">${e(pairName(p))}</a></li>`).join('')}</ul>`;
const pairsOf = (city, all, except) => all.filter(p => p !== except && (p.a === city || p.b === city))
  .sort((x, y) => (x.a === city ? x.b : x.a).name.localeCompare((y.a === city ? y.b : y.a).name, 'en'));
const dayParen = d => (d > 0 ? ' (next day)' : d < 0 ? ' (previous day)' : '');

export function renderPair(d, all, today) {
  const { a, b } = d;
  const open = `Open ${a.name} and ${b.name} in Overlap`;
  const overlapRows = d.overlapRows.map(r => {
    const [sa, sb] = r.meet.slot;
    const cell = (s, rating) => `${s.from} to ${s.to}${dayParen(s.day)}${rating ? `, ${s.rating}` : ''}`;
    return `<tr><th scope="row">${e(r.gap)}</th><td class="wrap">${e(r.when)}</td><td>${cell(sa, !r.meet.full)}</td><td>${cell(sb, !r.meet.full)}</td><td>${r.meet.full ? amount(r.meet.minutes) : 'None'}</td></tr>`;
  }).join('\n          ');
  const anyNone = d.overlapRows.some(r => !r.meet.full);
  const periodRows = d.periodRows.map(r => `<tr><th scope="row">${r.range}</th><td>${r.a}</td><td>${r.b}</td><td>${e(r.gap)}</td></tr>`).join('\n          ');
  const hourRows = d.hours.map(h => {
    const label = h.work[0] && h.work[1] ? 'Both' : h.work[0] ? `${a.name} only` : h.work[1] ? `${b.name} only` : 'Neither';
    return `<tr${h.work[0] && h.work[1] ? ' class="both"' : h.work[0] || h.work[1] ? ' class="one"' : ''}><th scope="row">${h.a}</th><td>${h.b.time}${dayParen(h.b.day)}</td><td>${e(label)}</td></tr>`;
  }).join('\n          ');
  const faq = d.faq.map(f => `<div>\n            <h3>${e(f.q)}</h3>\n            <p>${e(f.a)}</p>\n          </div>`).join('\n          ');

  const body = `    <div class="hero">
      <p class="kicker">Meeting planner for ${d.year}</p>
      <h1>Best meeting time for ${e(a.name)} and ${e(b.name)}</h1>
      <p class="lead">${e(d.lead)}</p>
      <p><a class="btn btn-primary btn-lg" href="${e(d.appLink)}">${e(open)}</a></p>
    </div>

    <section class="card" aria-labelledby="overlap-h">
      <h2 id="overlap-h">Working hours overlap in ${d.year}</h2>
      <p>Both cities working 09:00 to 17:00 local time. When the time difference changes during the year, so do the shared hours.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th scope="col">Time difference</th><th scope="col">When in ${d.year}</th><th scope="col">In ${e(a.name)}</th><th scope="col">In ${e(b.name)}</th><th scope="col">Shared hours</th></tr></thead>
          <tbody>
          ${overlapRows}
          </tbody>
        </table>
      </div>
      <p class="note">Worked out for ${d.checkedDates}.${anyNone ? ' When working hours do not overlap, the row shows the least painful 1 hour meeting and how it rates for each city: an hour just before or after work counts for less than an hour when someone is asleep.' : ''}</p>
    </section>

    <section class="card" aria-labelledby="difference-h">
      <h2 id="difference-h">Time difference between ${e(a.name)} and ${e(b.name)} in ${d.year}</h2>
      <p>${e(d.differenceText)}</p>${d.callout ? `\n      <p class="callout">${e(d.callout)}</p>` : ''}
      <div class="table-scroll">
        <table>
          <thead><tr><th scope="col">Dates in ${d.year}</th><th scope="col">${e(a.name)}</th><th scope="col">${e(b.name)}</th><th scope="col">Difference</th></tr></thead>
          <tbody>
          ${periodRows}
          </tbody>
        </table>
      </div>
      <h3>Clock changes in ${d.year}</h3>
      <ul class="list">
        ${d.clockItems.map(t => `<li>${e(t)}</li>`).join('\n        ')}
      </ul>
    </section>

    <section class="card" aria-labelledby="hours-h">
      <h2 id="hours-h">${e(a.name)} to ${e(b.name)} time conversion</h2>
      <p>Hour by hour on ${d.usualDate}, when ${e(d.usualText)}.${d.noteOthers ? ' At other times of the year, adjust by the change in the time difference above.' : ''} Working hours are 09:00 to 17:00 in both cities.</p>
      <div class="table-scroll">
        <table class="hours">
          <thead><tr><th scope="col">${e(a.name)}</th><th scope="col">${e(b.name)}</th><th scope="col">Working</th></tr></thead>
          <tbody>
          ${hourRows}
          </tbody>
        </table>
      </div>
      <p><a class="btn btn-secondary" href="${e(d.appLink)}">${e(open)}</a></p>
    </section>

    <section class="card" aria-labelledby="faq-h">
      <h2 id="faq-h">Questions about ${e(a.name)} and ${e(b.name)} time</h2>
      <div class="faq-list">
          ${faq}
      </div>
    </section>

    <nav class="card" aria-labelledby="more-h">
      <h2 id="more-h">More city pairs</h2>
      <h3>${e(a.name)}</h3>
      ${linkList(pairsOf(a, all, d))}
      <h3>${e(b.name)}</h3>
      ${linkList(pairsOf(b, all, d))}
      <p><a href="/meeting-time/">All city pairs</a></p>
    </nav>`;

  return layout({
    title: d.title, description: d.description, url: d.url, today, body,
    crumbs: [['Overlap', '/'], ['Meeting times', '/meeting-time/'], [pairName(d), d.path]],
    jsonLd: [
      breadcrumb([['Overlap', `${SITE}/`], ['Meeting times', `${SITE}/meeting-time/`], [pairName(d), d.url]]),
      { '@type': 'FAQPage', mainEntity: d.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  });
}

export function indexData(all, year) {
  const title = firstFitting(['Time Differences and Best Meeting Times by City | Overlap'], 50, 60);
  const description = firstFitting([
    `Time difference, clock changes, shared working hours and best meeting time for ${all.length} city pairs in ${year}, from London and New York to Singapore and Sydney.`,
    `Time difference, clock changes, shared working hours and the best meeting time for ${all.length} city pairs in ${year}, such as London and New York.`,
  ], 140, 155);
  if (!title || !description) throw new Error('index: no title or description fits');
  return { title, description, path: '/meeting-time/', url: `${SITE}/meeting-time/` };
}

export function renderIndex(all, year, today) {
  const d = indexData(all, year);
  const cities = [...CITIES].sort((x, y) => x.name.localeCompare(y.name, 'en'));
  const body = `    <div class="hero">
      <p class="kicker">Meeting planner for ${year}</p>
      <h1>Best meeting times for city pairs</h1>
      <p class="lead">The time difference, the ${year} clock changes and the shared working hours for ${all.length} pairs of cities, worked out for 09:00 to 17:00 in both. Every pair is listed under both of its cities. To plan a whole team, open Overlap.</p>
      <p><a class="btn btn-primary btn-lg" href="/">Open Overlap</a></p>
    </div>

    <div class="cities">
${cities.map(c => `      <section class="card" aria-labelledby="city-${c.slug}">
        <h2 id="city-${c.slug}">${e(c.name)}</h2>
        ${linkList(pairsOf(c, all))}
      </section>`).join('\n')}
    </div>`;
  return layout({
    title: d.title, description: d.description, url: d.url, today, body,
    crumbs: [['Overlap', '/'], ['Meeting times', d.path]],
    jsonLd: [breadcrumb([['Overlap', `${SITE}/`], ['Meeting times', d.url]])],
  });
}

/** Every generated file as a Map of path under public/ to contents, for the date the pages are made. */
export function buildSite(today) {
  const year = Number(today.slice(0, 4));
  const all = pairList(year);
  const files = new Map([['meeting-time/index.html', renderIndex(all, year, today)]]);
  for (const p of all) files.set(`meeting-time/${p.slug}/index.html`, renderPair(pageData(p, year), all, today));
  const urls = [`${SITE}/`, `${SITE}/meeting-time/`, ...all.map(p => SITE + p.path)];
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
  return files;
}
