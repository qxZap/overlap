import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetAt, dayRange, analyze, statusAt, rate, clockChanges, hhmm, dateIn, checkZone, HOUR_MS } from '../public/js/tz.js';

const Z = s => Date.parse(s);
const iso = ms => new Date(ms).toISOString().slice(0, 16) + 'Z';
const person = (tz, start = 540, end = 1020) => ({ name: '', city: '', tz, start, end });
function best(people, date, ref = 'UTC') {
  const { start, end } = dayRange(date, ref);
  const { best } = analyze(people, start, end);
  return { start: iso(best.start), end: iso(best.end), full: best.full };
}

const SAMPLE = ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Bucharest', 'Asia/Kolkata', 'Australia/Sydney'].map(z => person(z));

test('half hour, 45 minute and +12:45 offsets', () => {
  assert.equal(offsetAt('Asia/Kolkata', Z('2026-06-15T00:00Z')), 330);
  assert.equal(offsetAt('Asia/Kathmandu', Z('2026-06-15T00:00Z')), 345);
  assert.equal(offsetAt('Pacific/Chatham', Z('2026-06-15T00:00Z')), 765);
  assert.equal(offsetAt('Pacific/Chatham', Z('2026-01-15T00:00Z')), 825);
  assert.equal(offsetAt('Pacific/Pago_Pago', Z('2026-06-15T00:00Z')), -660);

  // Kathmandu 09:00 to 17:00 is 03:15 to 11:15 UTC: boundaries land on the quarter hour.
  const k = person('Asia/Kathmandu');
  assert.equal(statusAt(k, Z('2026-06-15T03:00Z')), 'early');
  assert.equal(statusAt(k, Z('2026-06-15T03:15Z')), 'work');
  assert.equal(statusAt(k, Z('2026-06-15T11:00Z')), 'work');
  assert.equal(statusAt(k, Z('2026-06-15T11:15Z')), 'late');
  assert.equal(hhmm('Asia/Kathmandu', Z('2026-06-15T03:15Z')), '09:00');

  // Chatham works 20:15 to 04:15 UTC, Mumbai 03:30 to 11:30 UTC: 45 minutes together.
  assert.deepEqual(best([person('Pacific/Chatham'), person('Asia/Kolkata')], '2026-06-15'),
    { start: '2026-06-15T03:30Z', end: '2026-06-15T04:15Z', full: true });
});

test("Lord Howe's 30 minute daylight saving", () => {
  assert.equal(offsetAt('Australia/Lord_Howe', Z('2026-06-15T00:00Z')), 630);
  assert.equal(offsetAt('Australia/Lord_Howe', Z('2026-01-15T00:00Z')), 660);
  // Clocks go from 02:00 to 02:30 on Sunday 4 October 2026 (15:30 UTC the day before).
  assert.deepEqual(clockChanges('Australia/Lord_Howe', Z('2026-09-25T00:00Z')), [{ at: Z('2026-10-03T15:30Z'), from: 630, to: 660 }]);
  assert.deepEqual(clockChanges('Australia/Lord_Howe', Z('2026-03-30T00:00Z')), [{ at: Z('2026-04-04T15:00Z'), from: 660, to: 630 }]);
  const spring = dayRange('2026-10-04', 'Australia/Lord_Howe');
  assert.equal((spring.end - spring.start) / HOUR_MS, 23.5);
  const autumn = dayRange('2026-04-05', 'Australia/Lord_Howe');
  assert.equal((autumn.end - autumn.start) / HOUR_MS, 24.5);
  assert.equal(analyze([person('Australia/Lord_Howe')], spring.start, spring.end).n, 94);
  // A Lord Howe person starts work at 22:30 UTC in June and 22:00 UTC in January.
  assert.equal(statusAt(person('Australia/Lord_Howe'), Z('2026-06-14T22:15Z')), 'early');
  assert.equal(statusAt(person('Australia/Lord_Howe'), Z('2026-06-14T22:30Z')), 'work');
  assert.equal(statusAt(person('Australia/Lord_Howe'), Z('2026-01-14T22:00Z')), 'work');
});

test('US and EU daylight saving mismatch moves the New York and London overlap', () => {
  const team = [person('America/New_York'), person('Europe/London')];
  assert.equal(offsetAt('America/New_York', Z('2026-03-15T12:00Z')), -240);
  assert.equal(offsetAt('Europe/London', Z('2026-03-15T12:00Z')), 0);
  // Normal winter: NY 14 to 22 UTC, London 9 to 17 UTC.
  assert.deepEqual(best(team, '2026-03-01'), { start: '2026-03-01T14:00Z', end: '2026-03-01T17:00Z', full: true });
  // US already on summer time, UK not yet: one extra hour together.
  assert.deepEqual(best(team, '2026-03-15'), { start: '2026-03-15T13:00Z', end: '2026-03-15T17:00Z', full: true });
  // Both on summer time again.
  assert.deepEqual(best(team, '2026-04-05'), { start: '2026-04-05T13:00Z', end: '2026-04-05T16:00Z', full: true });
  // In New York's own time the window is 09:00 to 13:00 during the mismatch.
  const { start, end } = dayRange('2026-03-15', 'America/New_York');
  const w = analyze(team, start, end).best;
  assert.equal(`${hhmm('America/New_York', w.start)} to ${hhmm('America/New_York', w.end)}`, '09:00 to 13:00');
  // The 14 day warning sees both switches.
  assert.equal(iso(clockChanges('America/New_York', Z('2026-03-01T00:00Z'))[0].at), '2026-03-08T07:00Z');
  assert.equal(iso(clockChanges('Europe/London', Z('2026-03-16T00:00Z'))[0].at), '2026-03-29T01:00Z');
  assert.deepEqual(clockChanges('Europe/London', Z('2026-06-15T00:00Z')), []);
});

test('23 and 25 hour days in the reference zone, and a skipped midnight', () => {
  const short = dayRange('2026-03-08', 'America/New_York');
  assert.equal((short.end - short.start) / HOUR_MS, 23);
  assert.equal(hhmm('America/New_York', short.start + 2 * HOUR_MS), '03:00');
  const long = dayRange('2026-11-01', 'America/New_York');
  assert.equal((long.end - long.start) / HOUR_MS, 25);
  assert.equal(hhmm('America/New_York', long.start + 2 * HOUR_MS), '01:00');
  assert.equal(analyze(SAMPLE, long.start, long.end).n, 100);
  // Chile moves clocks from 00:00 to 01:00, so the day starts at 01:00.
  const chile = dayRange('2026-09-06', 'America/Santiago');
  assert.equal(hhmm('America/Santiago', chile.start), '01:00');
  assert.equal(dateIn('America/Santiago', chile.start), '2026-09-06');
  assert.equal((chile.end - chile.start) / HOUR_MS, 23);
});

test('a team spanning the date line', () => {
  const team = [person('Pacific/Kiritimati'), person('Pacific/Pago_Pago')];
  assert.equal(offsetAt('Pacific/Kiritimati', Z('2026-06-15T00:00Z')), 840);
  // Kiritimati works 19:00 to 03:00 UTC, Pago Pago 20:00 to 04:00 UTC; the window crosses UTC midnight.
  assert.deepEqual(best(team, '2026-06-15'), { start: '2026-06-15T20:00Z', end: '2026-06-16T03:00Z', full: true });
  const at = Z('2026-06-15T20:00Z');
  assert.equal(dateIn('Pacific/Kiritimati', at), '2026-06-16');
  assert.equal(dateIn('Pacific/Pago_Pago', at), '2026-06-15');
  assert.equal(hhmm('Pacific/Kiritimati', at), '10:00');
  assert.equal(hhmm('Pacific/Pago_Pago', at), '09:00');
});

// Hand computed from UTC working hours (see README "How the best time is picked"):
// 2026-09-14 (also the June pattern): SF -7, NY -4, London +1, Bucharest +3, Mumbai +5:30, Sydney +10.
// No time has all six working. Cost per quarter hour (work 0, early/late 1, asleep 3) is lowest,
// 5 then 6, for 11:00 to 12:00 UTC: a 60 minute total of 22.
// 2026-03-15 (US switched, EU not yet, Sydney still +11): London 0, Bucharest +2.
// 14:00 to 15:00 and 16:00 to 17:00 UTC both total 20; the earlier one wins.
test('six city sample team on a normal date and on a DST mismatch date', () => {
  assert.deepEqual(best(SAMPLE, '2026-09-14'), { start: '2026-09-14T11:00Z', end: '2026-09-14T12:00Z', full: false });
  assert.deepEqual(best(SAMPLE, '2026-03-15'), { start: '2026-03-15T14:00Z', end: '2026-03-15T15:00Z', full: false });
  const at = Z('2026-09-14T11:00Z');
  assert.deepEqual(SAMPLE.map(p => rate(p, at, 60)), ['asleep', 'early', 'great', 'great', 'late', 'late']);
  assert.deepEqual(SAMPLE.map(p => hhmm(p.tz, at)), ['04:00', '07:00', '12:00', '14:00', '16:30', '21:00']);
  // Viewed from Bucharest the same instant is found.
  const { start, end } = dayRange('2026-09-14', 'Europe/Bucharest');
  assert.equal(iso(analyze(SAMPLE, start, end).best.start), '2026-09-14T11:00Z');
});

test('ratings and hours that cross midnight', () => {
  const p = person('UTC');
  assert.equal(rate(p, Z('2026-06-15T10:00Z'), 60), 'great');
  assert.equal(rate(p, Z('2026-06-15T09:00Z'), 60), 'fine');
  assert.equal(rate(p, Z('2026-06-15T16:30Z'), 60), 'late');
  assert.equal(rate(p, Z('2026-06-15T07:00Z'), 30), 'early');
  assert.equal(rate(p, Z('2026-06-15T03:00Z'), 60), 'asleep');
  const night = person('UTC', 22 * 60, 6 * 60);
  assert.equal(statusAt(night, Z('2026-06-15T23:00Z')), 'work');
  assert.equal(statusAt(night, Z('2026-06-15T03:00Z')), 'work');
  assert.equal(statusAt(night, Z('2026-06-15T07:00Z')), 'late');
  assert.equal(statusAt(night, Z('2026-06-15T20:00Z')), 'early');
  assert.equal(statusAt(night, Z('2026-06-15T14:00Z')), 'asleep');
  assert.equal(checkZone('Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(checkZone('utc'), 'UTC');
  assert.ok(checkZone('asia/kolkata'));
  assert.equal(checkZone('Mars/Olympus'), null);
});
