// "From the makers": our other apps. Plain links, no tracking beyond the utm_source in the URL.
// Logos are served from this site (img-src 'self'). A JS module because the CSP blocks fetching JSON,
// and named makers.js, not ads.js: ad blockers block files called ads.js, which would break the page's import.
export default [
  {
    title: 'scrape.land',
    line: 'Turn any web page into clean structured data. Start free with 1,000 requests.',
    url: 'https://scrape.land/?utm_source=overlap',
    logo: 'makers/scrapeland.svg',
  },
  {
    title: 'Penholder',
    line: "Put your team's priorities in order. Anyone can add, one person holds the pen.",
    url: 'https://penholder.app/?utm_source=overlap',
    logo: 'makers/penholder.svg',
  },
  {
    title: 'Censory',
    line: 'Finds names, ID numbers, faces and signatures in PDFs and scans, then deletes them from the file.',
    url: 'https://censory.app/?utm_source=overlap',
    logo: 'makers/censory.svg',
  },
];
