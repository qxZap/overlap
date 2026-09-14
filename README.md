# Overlap

**When is everyone on your team actually awake? One link, no signup.**

Overlap is a free, static, single page tool for distributed teams. Add your team's cities (34,000 of them, down to 15,000 people, or any IANA time zone like `Asia/Kolkata`), see a 24 hour grid of who is working, awake or asleep, and share one link that recreates the team exactly.

- People, not clocks: names, per person working hours (hours across midnight are fine), reorder, remove, people in the same city grouped together.
- The best overlap window across everyone, in a plain sentence, or the least painful hour when there is no full overlap.
- Date aware: pick any date and the grid follows real daylight saving rules, including the weeks when the US and Europe switch on different Sundays. A badge warns when anyone's clocks change within 14 days.
- Exact for +05:30, +05:45, +12:45 and Lord Howe's 30 minute daylight saving: everything runs on UTC instants at 15 minute resolution using the browser's `Intl` API. No date library.
- Meeting pain score per person (great, fine, early, late, asleep) with a total, pinned candidate times side by side, and a "rotate the pain" hint when the same people always get the bad slot.
- Share: copy link, a 1200x627 share card drawn on a canvas with LinkedIn text, and an `.ics` file for the chosen slot.
- No backend, no accounts, no cookies, no analytics, no third party anything. Works offline after the first visit.

## The URL format

The part after `#` is the whole state, readable by humans:

```
#d=2026-03-15&p=Ana,Bucharest,Europe/Bucharest;Raj,Mumbai,Asia/Kolkata,1000-1830;,,Asia/Kathmandu&c=1400-1500,1630-1730&z=utc
```

| Key | Meaning |
| --- | --- |
| `d` | Date shown, only present when someone picked a date. Without it the page shows today. |
| `p` | People separated by `;`. Fields: `name,city,time zone[,hours]`. Name and city may be empty. Hours are local `HHMM-HHMM` in 15 minute steps and are left out when they are the default `0900-1700`. `2200-0600` means a night shift. |
| `c` | Pinned candidate times as UTC `HHMM-HHMM`, up to four. |
| `z` | `utc` shows the grid in UTC instead of the viewer's own time zone. |

Spaces become `+`. Only `, ; & # = + %` and control characters are percent encoded, so names with emoji or accents stay readable. The page updates the hash with `history.replaceState` (typing does not flood the back button) and reacts to `hashchange`. "Remember this team on this device" copies the hash into `localStorage` and restores it when the page is opened without a hash.

## How the best time is picked

- The day is the chosen date from local midnight to local midnight in the grid's time zone, so it can be 23, 23.5, 24, 24.5 or 25 hours long.
- Each person, each 15 minutes: **working** inside their hours, **early** up to 2 hours before work, **late** up to 6 hours after work, otherwise **asleep**. With 09:00 to 17:00 that means awake from 07:00 to 23:00. The constants live at the top of `public/js/tz.js`.
- Best overlap: the longest run where everyone is working (it may run past midnight). If there is none, the meeting length window (1 hour by default) with the lowest cost, where each person costs 0 working, 1 early or late, 3 asleep per quarter hour. Ties go to the earliest.
- Pain score for a slot: great 0 (working, at least an hour from either end of the day), fine 1 (working), early 3, late 3, asleep 8. A person's rating is the worst quarter hour of the meeting.

## Run locally

```sh
npm start                    # http://localhost:8080 (PORT=0 picks a free port)
docker compose up --build    # http://localhost:8081
npm test                     # node --test, no dependencies
```

`serve.mjs` is a zero dependency static server that applies `public/_headers` the same way Cloudflare does, so the CSP you test locally is the one you ship.

Tests cover the US and EU daylight saving mismatch (New York and London in March 2026), +05:30, +05:45 and +12:45 offsets, Lord Howe, 23 and 25 hour days, a team across the date line, the six city sample team on a normal date and on a mismatch date (checked against hand computed windows), URL round trip with awkward names, `.ics` structure and local time, the service worker precache list, no en or em dashes, no inline scripts or styles, the page weight budget, and the response headers.

## City data

`public/js/cities.js` is generated and committed. To rebuild it:

1. Download [cities15000.zip](https://download.geonames.org/export/dump/cities15000.zip) and unzip `cities15000.txt` into `tools/data/`.
2. Download [admin1CodesASCII.txt](https://download.geonames.org/export/dump/admin1CodesASCII.txt) into `tools/data/`.
3. Run `node tools/build-cities.mjs`.

The script keeps name, ASCII name, country code, region and time zone, sorts by population and warns about (and drops) any time zone that Node's `Intl` does not accept. Country names come from `Intl.DisplayNames` at runtime. `tools/data/` is gitignored.

City data is JS rather than JSON, and the house ads live in `public/js/ads.js` instead of `ads.json`, because the CSP sets `connect-src 'none'`, which blocks `fetch` and JSON module imports alike. The city file is loaded with a dynamic `import()` the first time someone focuses the city search.

The Open Graph image `public/og.png` is rendered from `tools/og.html`:

```sh
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless --hide-scrollbars --screenshot=<absolute path>/public/og.png --window-size=1200,630 file:///<absolute path>/tools/og.html
```

## Deploy to Cloudflare

Cloudflare Workers static assets, set up in the dashboard. No `wrangler login` needed, nothing to build, and static asset requests are free.

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, then pick the repo.
3. Leave the build command empty. Set the deploy command to `npx wrangler deploy` (it reads `wrangler.jsonc`, which serves `./public`).
4. Deploy. Every push to the main branch deploys again.
5. Add a custom domain under the Worker's **Settings → Domains & Routes**.
6. Set `og:image` and `twitter:image` in `public/index.html` to the absolute URL on your domain (for example `https://overlap.example.com/og.png`); some social sites ignore relative image URLs.

Alternative, Cloudflare Pages: **Workers & Pages → Create → Pages → Connect to Git**, framework preset None, build command empty, build output directory `public`. `_headers` works the same way.

Check the headers after deploying:

```sh
curl -I https://your-domain/          # Content-Security-Policy: default-src 'self'; connect-src 'none'; ...
curl -I https://your-domain/sw.js     # Content-Security-Policy: default-src 'none'; connect-src 'self'
```

The page rules in `_headers` match `/` and `/js/*` rather than `/*` on purpose: Cloudflare joins every matching rule, and `connect-src 'none'` stacked onto `/sw.js` would stop the service worker from caching the app for offline use.

Lighthouse's SEO check reports that it cannot download `robots.txt`. It fetches the file from inside the page, and the page's `connect-src 'none'` blocks that; search engines request `robots.txt` directly and are not affected. Adding `connect-src 'self'` to the page rules turns the check green, at the cost of a looser policy.

Traffic numbers come from the Cloudflare dashboard. There is no analytics script.

## Files

```
public/index.html      page
public/styles.css      all styles, light and dark
public/js/app.js       UI
public/js/tz.js        time zone engine (pure, tested)
public/js/state.js     URL hash encode and decode (pure, tested)
public/js/ics.js       calendar file (pure, tested)
public/js/card.js      share card canvas, loaded on demand
public/js/ads.js       house ads
public/js/cities.js    generated GeoNames data, loaded on demand
public/sw.js           offline cache
tools/                 city generator and OG image source
```

## Credits

City data from [GeoNames](https://www.geonames.org/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See `THIRD_PARTY_NOTICES`. Code is MIT, see `LICENSE`.
