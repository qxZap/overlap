// iCalendar (RFC 5545) for one meeting. Pure module, importable from Node.

const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const octets = ch => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };

// Lines longer than 75 octets continue on the next line after a single space.
function fold(line) {
  let out = '', used = 0;
  for (const ch of line) {
    const n = octets(ch);
    if (used + n > 75) { out += '\r\n '; used = 1; }
    out += ch;
    used += n;
  }
  return out;
}

export function ics({ start, end, summary, description = '', now = Date.now(), uid }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Overlap//Team time zone overlap//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + (uid || `${stamp(start)}-${Math.random().toString(36).slice(2, 10)}@overlap`),
    'DTSTAMP:' + stamp(now),
    'DTSTART:' + stamp(start),
    'DTEND:' + stamp(end),
    'SUMMARY:' + escape(summary),
  ];
  if (description) lines.push('DESCRIPTION:' + escape(description));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
