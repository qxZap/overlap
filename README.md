# Overlap

**When is everyone on your team actually awake? One link, no signup.**

Overlap is a free, static, single page tool for distributed teams. Add your team's cities (34,000 of them, down to 15,000 people, or any IANA time zone like `Asia/Kolkata`), read the best time to meet at a glance, and share one link that recreates the team exactly.

## How it works on the page

1. **Build the team.** One search box, "Add a city or time zone". Picking a result adds the person straight away. People show as chips with initials, local time and a status dot; people in the same city share one chip with a count. Selecting a chip opens a dialog to set the name and working hours (15 minute steps, overnight shifts allowed), move the person earlier or later, add someone else in the same city, or remove them (with Undo). First visit: "Try a sample team" or a preset (US + Europe, Europe + India, Americas + Asia Pacific).
2. **Read the answer.** The answer card says "Best time to meet: 14:00 to 15:00" in your time zone, with the date and UTC, then every person's local time with a rating (great, fine, early, late, asleep; icon and label, never colour alone) and the pain score. When nobody's working hours line up, it says so and shows the least painful slot. "Copy team link" and "Add to calendar (.ics)" sit right there.
3. **Fine tune on the timeline.** One continuous bar per person: working solid blue, awake light blue, asleep dark with stripes, exact to the quarter hour (Mumbai's +05:30 included). A hour ruler, a "now" line on today, the window where everyone works as a green band, and a green meeting window you drag, tap, or move with the keyboard (arrows 15 minutes, Page Up and Page Down one hour, Home, End). Moving it updates the answer card live; "Back to best time" returns. Above it: the date with previous and next day, "Your time / UTC", meeting length, and a daylight saving badge ("London changes clocks in 6 days").
4. **Compare and share when you need them.** Two collapsed sections: "Compare times" pins candidate windows into a table with the fairest marked and a "rotate the pain" hint; "Share" has the link, "Remember this team on this device", and a 1200x627 share card with LinkedIn text.

Everything else:

- Date aware: pick any date and the timeline follows real daylight saving rules, including the weeks when the US and Europe switch on different Sundays.
- Exact for +05:30, +05:45, +12:45 and Lord Howe's 30 minute daylight saving: everything runs on UTC instants at 15 minute resolution using the browser's `Intl` API. No date library.
- No backend, no accounts, no cookies, no analytics, no third party anything. The footer shows "Saved for offline use" only once the service worker controls the page, and says so when the browser goes offline.
- Light and dark themes, keyboard and screen reader support (combobox, dialog with focus return, a slider for the meeting window, polite announcements that wait until the window stops moving), 44px touch targets, reduced motion respected.

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
| `z` | `utc` shows the timeline in UTC instead of the viewer's own time zone. |

Spaces become `+`. Only `, ; & # = + %` and control characters are percent encoded, so names with emoji or accents stay readable. The page updates the hash with `history.replaceState` (typing does not flood the back button) and reacts to `hashchange`. "Remember this team on this device" copies the hash into `localStorage` and restores it when the page is opened without a hash. The meeting window position and length are not part of the link; a shared link opens on the best time.

## How the best time is picked

- The day is the chosen date from local midnight to local midnight in the timeline's time zone, so it can be 23, 23.5, 24, 24.5 or 25 hours long.
- Each person, each 15 minutes: **working** inside their hours, **early** up to 2 hours before work, **late** up to 6 hours after work, otherwise **asleep**. With 09:00 to 17:00 that means awake from 07:00 to 23:00. Early and late both draw as "awake" on the timeline. The constants live at the top of `public/js/tz.js`.
- Best overlap: the longest run where everyone is working (it may run past midnight). If there is none, the meeting length window (1 hour by default) with the lowest cost, where each person costs 0 working, 1 early or late, 3 asleep per quarter hour. Ties go to the earliest.
- Pain score for a slot: great 0 (working, at least an hour from either end of the day), fine 1 (working), early 3, late 3, asleep 8. A person's rating is the worst quarter hour of the meeting.

## Run locally

```sh
npm start                    # http://localhost:8080 (PORT=0 picks a free port)
docker compose up --build    # http://localhost:8081
npm test                     # node --test, no dependencies
```

`serve.mjs` is a zero dependency static server that applies `public/_headers`, so the security headers can be checked locally.

Tests cover the US and EU daylight saving mismatch (New York and London in March 2026), +05:30, +05:45 and +12:45 offsets, Lord Howe, 23 and 25 hour days, a team across the date line, the six city sample team on a normal date and on a mismatch date (checked against hand computed windows), URL round trip with awkward names, `.ics` structure and local time, the UI helpers (presets decode to valid zones, grouping by city, pointer position to a 15 minute window, keyboard steps, time typeahead, search highlighting), the service worker precache list, no en or em dashes, no inline scripts or styles, the page weight budget, and the response headers.

## City data

`public/js/cities.js` is generated and committed. To rebuild it:

1. Download [cities15000.zip](https://download.geonames.org/export/dump/cities15000.zip) and unzip `cities15000.txt` into `tools/data/`.
2. Download [admin1CodesASCII.txt](https://download.geonames.org/export/dump/admin1CodesASCII.txt) into `tools/data/`.
3. Run `node tools/build-cities.mjs`.

The script keeps name, ASCII name, country code, region and time zone, sorts by population and warns about (and drops) any time zone that Node's `Intl` does not accept. Country names come from `Intl.DisplayNames` at runtime. `tools/data/` is gitignored.

City data is JS rather than JSON, and the house ads (scrape.land, Penholder, Censory) live in `public/js/makers.js` with logos in `public/makers/`, instead of `ads.json`, because the CSP sets `connect-src 'none'`, which blocks `fetch` and JSON module imports alike. (Nothing is named `ads`: ad blockers block such files, and a blocked import would break the page.) The city file is loaded with a dynamic `import()` the first time someone types in or taps the search box, never on page load.

The ads render through `public/js/showcase.js` and `public/showcase.css`: a dismissible bar fixed to the bottom of screens narrower than 75rem, and a rotating half page unit in a sticky right column from 75rem. Plain links, no tracking, every animation is CSS and stops under reduced motion.

The Open Graph image `public/og.png` is rendered from `tools/og.html`:

```sh
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless --hide-scrollbars --screenshot=<absolute path>/public/og.png --window-size=1200,630 file:///<absolute path>/tools/og.html
```

## Security headers

`public/_headers` sets the Content-Security-Policy. With `npm start` running:

```sh
curl -I http://localhost:8080/          # Content-Security-Policy: default-src 'self'; connect-src 'none'; ...
curl -I http://localhost:8080/sw.js     # Content-Security-Policy: default-src 'none'; connect-src 'self'
```

The page rules match `/` and `/js/*` rather than `/*` on purpose: matching rules are joined, and `connect-src 'none'` stacked onto `/sw.js` would stop the service worker from caching the app for offline use.

Lighthouse's SEO check reports that it cannot download `robots.txt`. It fetches the file from inside the page, and the page's `connect-src 'none'` blocks that; search engines request `robots.txt` directly and are not affected. Adding `connect-src 'self'` to the page rules turns the check green, at the cost of a looser policy.

There is no analytics script.

## Files

```
public/index.html      page, including the inline SVG icon sprite
public/styles.css      design tokens (light and dark) and all page styles
public/showcase.css      house ad unit styles
public/fonts/          Plus Jakarta Sans, latin subset, variable weight
public/js/app.js       UI
public/js/ui.js        UI helpers: presets, grouping, timeline pointer and keyboard maths (pure, tested)
public/js/tz.js        time zone engine (pure, tested)
public/js/state.js     URL hash encode and decode (pure, tested)
public/js/ics.js       calendar file (pure, tested)
public/js/card.js      share card canvas, loaded on demand
public/js/showcase.js    house ad unit
public/js/makers.js    house ad copy, logos in public/makers/
public/js/cities.js    generated GeoNames data, loaded on demand
public/sw.js           offline cache
tools/                 city generator, OG image source, font license
```

## Credits

City data from [GeoNames](https://www.geonames.org/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Plus Jakarta Sans by the Plus Jakarta Sans Project Authors, licensed under the SIL Open Font License 1.1. See `THIRD_PARTY_NOTICES`. Code is MIT, see `LICENSE`.
