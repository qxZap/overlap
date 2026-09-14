// Rotating ad unit for our own apps (data in makers.js). showcase.css switches the layout:
// an anchor bar fixed to the bottom of small screens (dismissible), a half-page unit in the right rail of wide ones.
// Plain links, no tracking, no network: logos are local files and every animation is CSS.
const INTERVAL = 7000; // ms each ad stays up; the progress segment's CSS animation runs for this long, then the next ad shows

const h = (tag, className, ...kids) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...kids);
  return e;
};
const setVars = (e, vars, prefix = '') => {
  for (const [k, v] of Object.entries(vars)) e.style.setProperty(`--${prefix}${k}`, v);
  return e;
};

// One small animated scene per product, made of plain elements and animated by showcase.css while the ad is showing.
const MOTIFS = {
  // scrape.land: fields of a page resolve into structured values while a scan beam passes
  data: () => h('div', 'sc-motif sc-motif-data',
    ...[['"title"', 0.9], ['"price"', 0.5], ['"in_stock"', 0.7], ['"rating"', 0.4]].map(([key, w], i) =>
      setVars(h('div', 'sc-row', h('span', 'sc-key', key), setVars(h('span', 'sc-val'), { w })), { i })),
    h('div', 'sc-beam')),
  // Penholder: the team's list on a phone. The pen holder drags the item that matters most above the line
  // and the rest slide down one place. Rows sit in 1.65rem slots, with a .7rem gap for the line after slot 2.
  order: () => {
    const Y = s => s * 1.65 + (s >= 2 ? 0.7 : 0);
    const rem = v => `${+v.toFixed(3)}rem`;
    // [text, destination slot]; the list starts in this order
    const rows = [['Pricing page', 1], ['Onboarding emails', 2], ['Quarterly report', 3], ['Fix checkout bug', 0]];
    const list = h('div', 'sc-list',
      ...[0, 1, 2, 3].map(s => setVars(h('span', 'sc-rank', String(s + 1)), { y: rem(Y(s)) })),
      setVars(h('span', 'sc-divider', 'Above the line'), { y: rem(Y(2) - 0.8) }),
      ...rows.map(([text, to], from) => setVars(
        h('div', to === 0 ? 'sc-card is-rising' : 'sc-card', text, ...(to === 0 ? [h('span', 'sc-finger')] : [])),
        { y: rem(Y(from)), dy: rem(Y(to) - Y(from)) })));
    return h('div', 'sc-motif sc-motif-order',
      h('div', 'sc-phone', h('div', 'sc-screen',
        h('div', 'sc-app-bar', h('span', null, 'Q3 priorities'), h('span', 'sc-pen')),
        list)));
  },
  // Censory: a scanned document with made-up personal data. Each value is detected, then blacked out.
  redact: () => h('div', 'sc-motif sc-motif-redact',
    h('div', 'sc-doc-title', 'Employment contract', h('span', null, 'Page 1')),
    // Made up on purpose: 123-45-6789 is not a valid SSN, 555-01xx numbers are reserved for fiction, example.com for examples.
    ...[['Name', 'Emily Johnson'], ['SSN', '123-45-6789'], ['Address', '1200 Oak St, Austin, TX'], ['Phone', '+1 (212) 555-0142'], ['Email', 'emily.j@example.com']]
      .map(([label, value], i) => h('div', 'sc-doc-row', h('span', 'sc-doc-label', label), setVars(h('span', 'sc-pii', value), { i })))),
};

export function mountAds(slot, ads) {
  const slides = [], segs = [];
  const stage = h('div', 'showcase-stage');
  const progress = h('div', 'showcase-progress'); // logo tabs, half-page unit
  const timer = h('div', 'showcase-timer', h('i')); // plain timer line, anchor bar
  let index = 0;

  const show = i => {
    index = i;
    slides.forEach((s, j) => { s.classList.toggle('is-active', j === i); s.inert = j !== i; });
    segs.forEach((s, j) => {
      s.classList.remove('is-active');
      s.classList.toggle('is-done', j < i);
      s.setAttribute('aria-current', String(j === i));
    });
    timer.classList.remove('is-running');
    void timer.offsetWidth; // restart the timing animations even when the same ad is picked again
    segs[i].classList.add('is-active');
    timer.classList.add('is-running');
  };

  ads.forEach((ad, i) => {
    const motif = MOTIFS[ad.motif]();
    motif.setAttribute('aria-hidden', 'true');
    const arrow = h('span', 'sc-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    const logo = Object.assign(document.createElement('img'), { src: ad.logo, alt: '', width: 40, height: 40, className: 'sc-logo' });
    const slide = setVars(h('a', 'sc-slide',
      motif,
      h('span', 'sc-brand', logo, h('span', 'sc-name', ad.title)),
      h('span', 'sc-headline', ad.headline),
      h('span', 'sc-line', ad.line),
      h('span', 'sc-cta', h('span', 'sc-cta-text', ad.cta), arrow)), ad.theme, 'sc-');
    // A new tab, so following an ad never throws away what someone was doing on this page.
    Object.assign(slide, { href: ad.url, target: '_blank', rel: 'noopener' });
    slides.push(slide);
    stage.append(slide);

    // A tab per product with its logo and name, so all three stay visible while one plays.
    const tabLogo = Object.assign(document.createElement('img'), { src: ad.logo, alt: '', width: 28, height: 28 });
    const seg = h('button', 'showcase-seg', tabLogo, h('span', 'showcase-seg-name', ad.title), h('i'));
    seg.type = 'button';
    seg.setAttribute('aria-label', `Show ad ${i + 1} of ${ads.length}: ${ad.title}`);
    seg.addEventListener('click', () => show(i));
    segs.push(seg);
    progress.append(seg);
  });

  const close = h('button', 'showcase-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close ad');
  const unit = setVars(h('div', 'showcase', h('span', 'showcase-badge', 'Ad'), close, stage, progress, timer), { 'sc-interval': `${INTERVAL}ms` });

  unit.addEventListener('animationend', e => { if (e.animationName === 'sc-progress') show((index + 1) % slides.length); });
  // Pause while someone points at or tabs into the ad, and while the tab is hidden.
  const pause = on => unit.classList.toggle('is-paused', on);
  unit.addEventListener('pointerenter', () => pause(true));
  unit.addEventListener('pointerleave', () => pause(unit.contains(document.activeElement)));
  unit.addEventListener('focusin', () => pause(true));
  unit.addEventListener('focusout', e => pause(unit.contains(e.relatedTarget)));
  document.addEventListener('visibilitychange', () => unit.classList.toggle('is-hidden-tab', document.hidden));
  close.addEventListener('click', () => {
    unit.classList.add('is-dismissed');
    document.body.classList.remove('has-showcase-bar');
  });

  slot.replaceChildren(unit);
  document.body.classList.add('has-showcase-bar');
  show(0);
}
