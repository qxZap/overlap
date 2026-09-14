import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../public/js/state.js';

test('URL state round trip keeps the identical team', () => {
  const state = {
    date: '2026-03-15',
    people: [
      { name: 'Ana, "the boss"; & co #1 = 100%+', city: 'San Francisco', tz: 'America/Los_Angeles', start: 540, end: 1020 },
      { name: 'Zoë 🌏 Łukasz 李', city: 'São Paulo', tz: 'America/Sao_Paulo', start: 600, end: 1110 },
      { name: '', city: '', tz: 'Asia/Kolkata', start: 1320, end: 360 },
      { name: 'Tab\tand\nnewline', city: 'Kathmandu', tz: 'Asia/Kathmandu', start: 525, end: 1005 },
      { name: 'Etc', city: '', tz: 'Etc/GMT+5', start: 540, end: 1020 },
    ],
    slots: [{ start: 840, len: 60 }, { start: 1410, len: 90 }],
    utc: true,
  };
  const hash = encode(state);
  assert.deepEqual(decode('#' + hash), state);
  // Readable, not a blob.
  assert.match(hash, /^d=2026-03-15&p=Ana%2C\+"the\+boss"%3B\+%26\+co\+%231\+%3D\+100%25%2B,San\+Francisco,America\/Los_Angeles;/);
  assert.match(hash, /Zoë\+🌏/);
  assert.match(hash, /;,,Asia\/Kolkata,2200-0600;/);
  assert.match(hash, /&c=1400-1500,2330-0100&z=utc$/);
  // What a browser hands back after percent-encoding the fragment decodes the same.
  assert.deepEqual(decode('#' + new URL('https://x.test/#' + hash).hash.slice(1)), state);
});

test('decode ignores junk and keeps defaults', () => {
  assert.deepEqual(decode(''), { date: '', people: [], slots: [], utc: false });
  const s = decode('#p=Bad,Nowhere,Mars/Olympus;Ok,London,Europe/London,2500-1700;%E0%A4%A,x,UTC&d=2026-99-99&c=nope');
  assert.deepEqual(s.people, [
    { name: 'Ok', city: 'London', tz: 'Europe/London', start: 540, end: 1020 },
    { name: '%E0%A4%A', city: 'x', tz: 'UTC', start: 540, end: 1020 },
  ]);
  assert.equal(s.date, '');
  assert.deepEqual(s.slots, []);
});
