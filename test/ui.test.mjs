import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, groupPeople, moveGroup, initials, runs, windowStart, stepKey, typeahead, shiftDate, highlight } from '../public/js/ui.js';
import { decode } from '../public/js/state.js';
import { checkZone } from '../public/js/tz.js';

test('presets decode to valid, distinct teams', () => {
  assert.deepEqual(PRESETS.map(p => p.label), ['Sample team', 'US + Europe', 'Europe + India', 'Americas + Asia Pacific']);
  for (const p of PRESETS) {
    const people = decode(p.hash).people;
    assert.equal(people.length, p.hash.split(';').length, p.label);
    assert.ok(people.length >= 4, p.label);
    for (const x of people) assert.equal(checkZone(x.tz), x.tz);
    assert.equal(new Set(people.map(x => x.city)).size, people.length, `${p.label} repeats a city`);
  }
  assert.deepEqual(decode(PRESETS[0].hash).people.map(x => x.city), ['San Francisco', 'New York', 'London', 'Bucharest', 'Mumbai', 'Sydney']);
  assert.equal(decode(PRESETS[3].hash).people[1].city, 'São Paulo');
});

test('group by city keeps first appearance order, move swaps whole groups', () => {
  const p = (name, city, tz) => ({ name, city, tz, start: 540, end: 1020 });
  const a = p('Ana', 'London', 'Europe/London'), b = p('Raj', 'Mumbai', 'Asia/Kolkata'), c = p('Leo', 'London', 'Europe/London'), d = p('', '', 'Asia/Kolkata');
  assert.deepEqual(groupPeople([a, b, c, d]), [[a, c], [b], [d]]); // a raw zone is its own "city" (Kolkata), not Mumbai
  assert.deepEqual(moveGroup([a, b, c, d], 'Mumbai|Asia/Kolkata', -1), [b, a, c, d]);
  assert.deepEqual(moveGroup([a, b, c, d], 'London|Europe/London', 1), [b, a, c, d]);
  assert.deepEqual(moveGroup([a, b, c, d], 'London|Europe/London', -1), [a, b, c, d]);
  assert.deepEqual(moveGroup([a, b], 'Nowhere|UTC', 1), [a, b]);
});

test('initials', () => {
  assert.equal(initials('San Francisco'), 'SF');
  assert.equal(initials('Leo'), 'L');
  assert.equal(initials('ana maria de souza'), 'AS');
  assert.equal(initials('Zoë 🌏'), 'Z🌏');
  assert.equal(initials('  '), '?');
});

test('status runs merge early and late into awake', () => {
  assert.deepEqual(runs(['asleep', 'asleep', 'early', 'work', 'work', 'late', 'late']), [
    { s: 'asleep', from: 0, to: 2 }, { s: 'awake', from: 2, to: 3 }, { s: 'work', from: 3, to: 5 }, { s: 'awake', from: 5, to: 7 },
  ]);
  assert.deepEqual(runs([]), []);
});

test('pointer x maps to a 15 minute meeting window that fits the day', () => {
  // 96 slots on 960 px: 10 px a slot. A one hour window (4 slots) centres on the pointer.
  assert.equal(windowStart(100, 960, 96, 4), 8);
  assert.equal(windowStart(104, 960, 96, 4), 8);
  assert.equal(windowStart(106, 960, 96, 4), 9);
  assert.equal(windowStart(0, 960, 96, 4), 0);
  assert.equal(windowStart(955, 960, 96, 4), 92);
  assert.equal(windowStart(-50, 960, 96, 4), 0);
  // Dragging keeps the grab point: held 1 slot in, pointer at slot 30 means the window starts at 29.
  assert.equal(windowStart(300, 960, 96, 4, 1), 29);
  // A 25 hour day and a window longer than the day.
  assert.equal(windowStart(960, 960, 100, 8), 92);
  assert.equal(windowStart(500, 960, 4, 8), 0);
});

test('keyboard steps for the meeting window and the time picker', () => {
  assert.equal(stepKey('ArrowRight', 10, 92), 11);
  assert.equal(stepKey('ArrowUp', 10, 92), 11);
  assert.equal(stepKey('ArrowLeft', 0, 92), 0);
  assert.equal(stepKey('PageUp', 90, 92), 92);
  assert.equal(stepKey('PageDown', 10, 92), 6);
  assert.equal(stepKey('Home', 50, 92), 0);
  assert.equal(stepKey('End', 50, 92), 92);
  assert.equal(stepKey('Enter', 50, 92), null);
  assert.equal(stepKey('toString', 50, 92), null);
  assert.equal(stepKey('ArrowDown', 36, 95, { list: true }), 37);
  assert.equal(stepKey('ArrowUp', 36, 95, { list: true }), 35);
  assert.equal(stepKey('PageDown', 36, 95, { list: true }), 40);
  assert.equal(stepKey('ArrowRight', 36, 95, { list: true }), null);
});

test('typing a time jumps to it', () => {
  const quarter = Array.from({ length: 96 }, (_, i) => i * 15);
  assert.equal(quarter[typeahead('9', quarter)], 540);
  assert.equal(quarter[typeahead('09', quarter)], 540);
  assert.equal(quarter[typeahead('1', quarter)], 60);
  assert.equal(quarter[typeahead('17', quarter)], 1020);
  assert.equal(quarter[typeahead('930', quarter)], 570);
  assert.equal(quarter[typeahead('22:45', quarter)], 1365);
  assert.equal(typeahead('99', quarter), -1);
  assert.equal(typeahead('', quarter), -1);
});

test('date shifting crosses months, years and leap days', () => {
  assert.equal(shiftDate('2026-09-14', 1), '2026-09-15');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDate('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});

test('search highlight ignores case and accents', () => {
  assert.deepEqual(highlight('São Paulo', 'sao'), [[0, 3]]);
  assert.deepEqual(highlight('São Paulo', 'PAUL'), [[4, 8]]);
  assert.deepEqual(highlight('Bengaluru', 'bangalore'), []);
  assert.deepEqual(highlight('Łódź', 'od'), [[1, 3]]);
  assert.deepEqual(highlight('x', ' '), []);
});
