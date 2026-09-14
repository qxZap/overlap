import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ics } from '../public/js/ics.js';
import { hhmm } from '../public/js/tz.js';

test('.ics is valid RFC 5545 and lands on the right local time', () => {
  const start = Date.parse('2026-03-15T14:00Z');
  const description = 'Local times: Nadia 10:00 New York (fine), Leo 14:00 London, Arjun 19:30 Mumbai (late); Zoë 🌏 in São Paulo\\back\nsecond line '.repeat(3);
  const text = ics({ start, end: start + 3600000, summary: 'Team sync, weekly; planning', description, now: Date.parse('2026-03-01T08:30:15Z'), uid: 'test@overlap' });

  assert.ok(text.endsWith('\r\n'));
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /[\r\n]/, 'only CRLF line breaks');
  const raw = text.slice(0, -2).split('\r\n');
  for (const line of raw) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `folded to 75 octets: ${line}`);
  assert.ok(raw.some(l => l.startsWith(' ')), 'long description is folded');

  const lines = text.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
  assert.deepEqual([lines[0], lines[1], lines.at(-2), lines.at(-1)], ['BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VEVENT', 'END:VCALENDAR']);
  const props = Object.fromEntries(lines.map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));
  assert.ok(props.PRODID);
  assert.equal(props.UID, 'test@overlap');
  assert.equal(props.DTSTAMP, '20260301T083015Z');
  assert.equal(props.DTSTART, '20260315T140000Z');
  assert.equal(props.DTEND, '20260315T150000Z');
  assert.equal(props.SUMMARY, 'Team sync\\, weekly\\; planning');
  assert.ok(props.DESCRIPTION.includes('São Paulo\\\\back\\nsecond'), 'escaped text survives folding intact');
  assert.equal(lines.filter(l => l === 'BEGIN:VEVENT').length, 1);

  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(props.DTSTART);
  const at = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
  assert.equal(hhmm('America/New_York', at), '10:00');
  assert.equal(hhmm('Asia/Kolkata', at), '19:30');
  assert.equal(hhmm('Australia/Sydney', at), '01:00');
});
