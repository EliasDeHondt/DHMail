const test = require('node:test');
const assert = require('node:assert');
const { easterSunday, belgianHolidays, isBuiltInExtraCalendar } = require('../dist/main/main/calendar/holidays.js');

test('easter dates are correct', () => {
  assert.strictEqual(easterSunday(2025).toISOString().slice(0, 10), '2025-04-20');
  assert.strictEqual(easterSunday(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.strictEqual(easterSunday(2027).toISOString().slice(0, 10), '2027-03-28');
});

test('belgian holidays for 2026', () => {
  const list = belgianHolidays(new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T23:59:59Z'), 'nl');
  const byTitle = Object.fromEntries(list.map(e => [e.title, e.start]));
  assert.strictEqual(list.length, 12);
  assert.strictEqual(byTitle['Paasmaandag'], '2026-04-06');
  assert.strictEqual(byTitle['O.L.H. Hemelvaart'], '2026-05-14');
  assert.strictEqual(byTitle['Pinkstermaandag'], '2026-05-25');
  assert.strictEqual(byTitle['Nationale feestdag'], '2026-07-21');
  assert.strictEqual(byTitle['Wapenstilstand'], '2026-11-11');
  assert.ok(list.every(e => e.allDay));
});

test('provider birthday and holiday calendars are recognised', () => {
  assert.ok(isBuiltInExtraCalendar('addressbook#contacts@group.v.calendar.google.com', 'Contacts'));
  assert.ok(isBuiltInExtraCalendar('nl.be#holiday@group.v.calendar.google.com', 'Feestdagen in België'));
  assert.ok(isBuiltInExtraCalendar('AAMkAD', 'Verjaardagen'));
  assert.ok(isBuiltInExtraCalendar('AAMkAD', 'Holidays in Belgium'));
  assert.ok(!isBuiltInExtraCalendar('AAMkAD', 'Agenda'));
  assert.ok(!isBuiltInExtraCalendar('elias@gmail.com', 'Werk'));
});
