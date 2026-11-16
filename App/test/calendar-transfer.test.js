/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

const test = require('node:test');
const assert = require('node:assert');
const { graphToRrule, rruleToGraph, expand, icsToItems, itemToIcs } = require('../dist/main/main/calendar/transfer.js');

test('outlook recurrence <-> RRULE', () => {
  const weekly = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'endDate', startDate: '2024-01-01', endDate: '2026-12-31' } };
  const r = graphToRrule(weekly);
  assert.strictEqual(r, 'FREQ=WEEKLY;BYDAY=MO,WE;WKST=MO;UNTIL=20261231T235959Z');
  const back = rruleToGraph(r, new Date(2024, 0, 1, 8, 0), false);
  assert.deepStrictEqual(back.pattern.daysOfWeek, ['monday', 'wednesday']);
  assert.strictEqual(back.range.type, 'endDate');
  assert.strictEqual(back.range.endDate, '2026-12-31');
  assert.strictEqual(graphToRrule({ pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['tuesday'], index: 'second' }, range: { type: 'numbered', numberOfOccurrences: 10 } }), 'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2;COUNT=10');
  assert.deepStrictEqual(rruleToGraph('FREQ=MONTHLY;BYDAY=2TU', new Date(2024, 0, 9), false).pattern, { type: 'relativeMonthly', interval: 1, daysOfWeek: ['tuesday'], index: 'second' });
  assert.deepStrictEqual(rruleToGraph('FREQ=DAILY;INTERVAL=2', new Date(2024, 0, 1), false).pattern, { type: 'daily', interval: 2 });
  assert.strictEqual(rruleToGraph('FREQ=MINUTELY', new Date(), false), null);
});

test('series expansion leaves out cancelled occurrences', () => {
  const start = new Date(2026, 10, 2, 8, 0);
  const item = { title: 'Biking', description: '', location: '', allDay: false, start, end: new Date(2026, 10, 2, 8, 15), rrule: 'FREQ=DAILY;COUNT=5', exdates: [new Date(2026, 10, 4, 8, 0)], attendees: [] };
  const days = expand(item, start, new Date(2027, 0, 1)).map(d => d.getDate());
  assert.deepStrictEqual(days, [2, 3, 5, 6]);
});

test('iCalendar series with a changed occurrence becomes series + EXDATE + single event', () => {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:s1', 'DTSTART:20261102T070000Z', 'DTEND:20261102T080000Z', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Morning Routine', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:s1', 'RECURRENCE-ID:20261109T070000Z', 'DTSTART:20261109T090000Z', 'DTEND:20261109T100000Z', 'SUMMARY:Morning Routine (later)', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const items = icsToItems(ics);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].rrule, 'FREQ=WEEKLY;COUNT=4');
  assert.strictEqual(items[0].exdates.length, 1);
  assert.strictEqual(items[0].exdates[0].toISOString(), '2026-11-09T07:00:00.000Z');
  assert.strictEqual(items[1].title, 'Morning Routine (later)');
  assert.strictEqual(items[1].rrule, undefined);
  const out = itemToIcs(items[0], 'new-uid');
  assert.ok(out.includes('RRULE:FREQ=WEEKLY;COUNT=4'));
  assert.ok(/EXDATE;TZID=[^:]+:20261109T/.test(out));
  // round trip keeps the series
  const again = icsToItems(out);
  assert.strictEqual(again[0].rrule, 'FREQ=WEEKLY;COUNT=4');
});