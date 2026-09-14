// Our other apps, shown by adunit.js as a rotating ad. Plain links, no tracking beyond the utm_source in the URL.
// Logos are served from this site (img-src 'self'). A JS module because the CSP blocks fetching JSON,
// and named makers.js, not ads.js: ad blockers block files called ads.js, which would break the page's import.
// theme keys become --ad-<key> custom properties on each ad; copy comes from each product's own site.
export default [
  {
    title: 'scrape.land',
    headline: 'The web, turned into data.',
    line: 'Send any URL, get the exact fields you need as clean structured data. Start free with 1,000 requests.',
    cta: 'Start free',
    url: 'https://scrape.land/?utm_source=overlap',
    logo: 'makers/scrapeland.svg',
    motif: 'data',
    theme: { bg: 'linear-gradient(160deg, #131d30, #0b0f17 62%)', fg: '#e9f0fa', muted: '#a8b5c7', accent: '#3fdc7a', 'accent-2': '#54a8ff', 'cta-bg': '#3fdc7a', 'cta-ink': '#04140a', panel: 'rgba(255, 255, 255, .06)' },
  },
  {
    title: 'Penholder',
    headline: 'Everything is a priority. Put them in order.',
    line: 'Anyone can add, one person holds the pen. Five dollars a month per team.',
    cta: 'Try Penholder',
    url: 'https://penholder.app/?utm_source=overlap',
    logo: 'makers/penholder.svg',
    motif: 'order',
    theme: { bg: 'linear-gradient(155deg, #4f46e5, #6a3fd6)', fg: '#ffffff', muted: '#e4e2ff', accent: '#ffffff', 'accent-2': '#c7d2fe', 'cta-bg': '#ffffff', 'cta-ink': '#3730a3', panel: 'rgba(255, 255, 255, .1)' },
  },
  {
    title: 'Censory',
    headline: 'Redact personal data from PDFs and scans.',
    line: 'Finds names, ID numbers, faces and signatures, then deletes them from the file itself. You approve every redaction.',
    cta: 'Try Censory',
    url: 'https://censory.app/?utm_source=overlap',
    logo: 'makers/censory.svg',
    motif: 'redact',
    theme: { bg: '#111a26', fg: '#f4efe3', muted: '#c0c7d2', accent: '#c9a24a', 'accent-2': '#e3c37a', 'cta-bg': '#c9a24a', 'cta-ink': '#111a26', panel: '#f4efe3' },
  },
];
