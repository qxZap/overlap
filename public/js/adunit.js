// Rotating ad unit for our own apps (data in makers.js). adunit.css switches the layout:
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

// One small animated scene per product, made of plain elements and animated by adunit.css while the ad is showing.
const MOTIFS = {
  // scrape.land: fields of a page resolve into structured values while a scan beam passes
  data: () => h('div', 'ad-motif ad-motif-data',
    ...[['"title"', 0.9], ['"price"', 0.5], ['"in_stock"', 0.7], ['"rating"', 0.4]].map(([key, w], i) =>
      setVars(h('div', 'ad-row', h('span', 'ad-key', key), setVars(h('span', 'ad-val'), { w })), { i })),
    h('div', 'ad-beam')),
  // Penholder: the item that matters most rises above the line
  order: () => h('div', 'ad-motif ad-motif-order',
    ...['Onboarding emails', 'Pricing page', 'Quarterly report', 'Fix checkout bug'].map((t, i, all) =>
      h('div', i === all.length - 1 ? 'ad-item is-rising' : 'ad-item', t)),
    h('div', 'ad-pen-line')),
  // Censory: redaction bars close over the personal data in a document
  redact: () => {
    let n = 0;
    return h('div', 'ad-motif ad-motif-redact',
      ...[[92, 34, 40], [78, 8, 30], [96, 52, 30], [64, 0, 0], [84, 20, 46]].map(([len, l, w]) => {
        const line = setVars(h('div', 'ad-text'), { len: `${len}%` });
        if (w) line.append(setVars(h('span', 'ad-mark'), { l: `${l}%`, w: `${w}%`, i: n++ }));
        return line;
      }));
  },
};

export function mountAds(slot, ads) {
  const slides = [], segs = [];
  const stage = h('div', 'adunit-stage');
  const progress = h('div', 'adunit-progress'); // clickable segments, half-page unit
  const timer = h('div', 'adunit-timer', h('i')); // plain timer line, anchor bar
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
    const arrow = h('span', 'ad-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    const logo = Object.assign(document.createElement('img'), { src: ad.logo, alt: '', width: 40, height: 40, className: 'ad-logo' });
    const slide = setVars(h('a', 'ad-slide',
      motif,
      h('span', 'ad-brand', logo, h('span', 'ad-name', ad.title)),
      h('span', 'ad-headline', ad.headline),
      h('span', 'ad-line', ad.line),
      h('span', 'ad-cta', h('span', 'ad-cta-text', ad.cta), arrow)), ad.theme, 'ad-');
    // A new tab, so following an ad never throws away what someone was doing on this page.
    Object.assign(slide, { href: ad.url, target: '_blank', rel: 'noopener' });
    slides.push(slide);
    stage.append(slide);

    const seg = h('button', 'adunit-seg', h('i'));
    seg.type = 'button';
    seg.setAttribute('aria-label', `Show ad ${i + 1} of ${ads.length}: ${ad.title}`);
    seg.addEventListener('click', () => show(i));
    segs.push(seg);
    progress.append(seg);
  });

  const close = h('button', 'adunit-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close ad');
  const unit = setVars(h('div', 'adunit', h('span', 'adunit-badge', 'Ad'), close, stage, progress, timer), { 'ad-interval': `${INTERVAL}ms` });

  unit.addEventListener('animationend', e => { if (e.animationName === 'ad-progress') show((index + 1) % slides.length); });
  // Pause while someone points at or tabs into the ad, and while the tab is hidden.
  const pause = on => unit.classList.toggle('is-paused', on);
  unit.addEventListener('pointerenter', () => pause(true));
  unit.addEventListener('pointerleave', () => pause(unit.contains(document.activeElement)));
  unit.addEventListener('focusin', () => pause(true));
  unit.addEventListener('focusout', e => pause(unit.contains(e.relatedTarget)));
  document.addEventListener('visibilitychange', () => unit.classList.toggle('is-hidden-tab', document.hidden));
  close.addEventListener('click', () => {
    unit.classList.add('is-dismissed');
    document.body.classList.remove('has-ad-anchor');
  });

  slot.replaceChildren(unit);
  document.body.classList.add('has-ad-anchor');
  show(0);
}
