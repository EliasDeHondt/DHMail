import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';
import { all, now, run } from '../core/db';
import { getSecret } from '../core/secrets';
import { bus, log } from '../core/bus';
import { CalendarTransferResult } from '../../shared/types';
import { gapi } from './google';
import { graph } from './microsoft';
import { deleteCalendarObject, fetchCalendarObjects, putCalendarObject } from './caldav';

// Copies or moves every event of one calendar to another one, whatever the providers are. Repeating
// events stay one repeating event (RRULE / Outlook recurrence), changed or cancelled occurrences are kept,
// and in "move" mode an event is only removed from the source after its copy was created.

export interface Item {
  title: string; description: string; location: string; allDay: boolean;
  /** timed: the start instant; all-day: local midnight of the first day */
  start: Date; end: Date;
  /** RRULE value without the "RRULE:" prefix */
  rrule?: string;
  /** starts of occurrences that are left out (cancelled, or moved into their own exception event) */
  exdates: Date[];
  attendees: string[];
  /** original iCalendar object (CalDAV), copied as-is to another CalDAV calendar */
  raw?: string;
  /** what to delete in the source when moving; exceptions are deleted together with their series */
  source?: { id: string; url?: string; etag?: string | null };
  /** source id of the series an exception belongs to (a failed exception keeps its series in the source) */
  parent?: string;
  /** an override that is already inside the raw object of its series */
  partOfRaw?: boolean;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Brussels';
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** wall-clock time in this computer's time zone, e.g. 2026-11-12T08:00:00 */
export const wall = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const icsLocal = (d: Date) => wall(d).replace(/[-:]/g, '');
const icsDate = (d: Date) => ymd(d).replace(/-/g, '');
const localDate = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const sameSlot = (a: Date, b: Date, allDay: boolean) => allDay ? ymd(a) === ymd(b) : Math.abs(a.getTime() - b.getTime()) < 60_000;

// ---------------------------------------------------------------- recurrence conversion
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const INDEX: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

/** Outlook recurrence → RRULE */
export function graphToRrule(r: any): string | null {
  const p = r?.pattern, range = r?.range; if (!p) return null;
  const parts: string[] = [];
  const byDay = (p.daysOfWeek ?? []).map((d: string) => ICS_DAYS[DAYS.indexOf(String(d).toLowerCase())]).filter(Boolean).join(',');
  const interval = p.interval && p.interval > 1 ? `;INTERVAL=${p.interval}` : '';
  switch (p.type) {
    case 'daily': parts.push(`FREQ=DAILY${interval}`); break;
    case 'weekly': parts.push(`FREQ=WEEKLY${interval}`, `BYDAY=${byDay}`, 'WKST=MO'); break;
    case 'absoluteMonthly': parts.push(`FREQ=MONTHLY${interval}`, `BYMONTHDAY=${p.dayOfMonth}`); break;
    case 'relativeMonthly': parts.push(`FREQ=MONTHLY${interval}`, `BYDAY=${byDay}`, `BYSETPOS=${INDEX[p.index] ?? 1}`); break;
    case 'absoluteYearly': parts.push(`FREQ=YEARLY${interval}`, `BYMONTH=${p.month}`, `BYMONTHDAY=${p.dayOfMonth}`); break;
    case 'relativeYearly': parts.push(`FREQ=YEARLY${interval}`, `BYMONTH=${p.month}`, `BYDAY=${byDay}`, `BYSETPOS=${INDEX[p.index] ?? 1}`); break;
    default: return null;
  }
  if (range?.type === 'endDate' && range.endDate) parts.push(`UNTIL=${range.endDate.replace(/-/g, '')}T235959Z`);
  else if (range?.type === 'numbered' && range.numberOfOccurrences) parts.push(`COUNT=${range.numberOfOccurrences}`);
  return parts.join(';');
}

/** RRULE → Outlook recurrence (null when Outlook cannot express it) */
export function rruleToGraph(rrule: string, start: Date, allDay: boolean): any | null {
  const f: Record<string, string> = {}; for (const kv of rrule.split(';')) { const [k, v] = kv.split('='); if (k && v) f[k.toUpperCase()] = v.toUpperCase(); }
  const interval = Number(f['INTERVAL'] || 1);
  const days = (f['BYDAY'] || '').split(',').filter(Boolean);
  if (days.some(d => /^[+-]?\d/.test(d)) && f['BYSETPOS']) return null;
  const plainDays = days.map(d => d.replace(/^[+-]?\d+/, ''));
  const numbered = days.map(d => /^([+-]?\d+)/.exec(d)?.[1]).find(Boolean);
  const pos = Number(f['BYSETPOS'] || numbered || 0);
  const index = pos === -1 ? 'last' : ['', 'first', 'second', 'third', 'fourth'][pos] || null;
  const weekdays = plainDays.map(d => DAYS[ICS_DAYS.indexOf(d)]).filter(Boolean);
  if (f['BYHOUR'] || f['BYMINUTE'] || f['BYYEARDAY'] || f['BYWEEKNO'] || (f['BYMONTHDAY'] || '').includes(',') || (f['BYMONTH'] || '').includes(',')) return null;
  let pattern: any;
  switch (f['FREQ']) {
    case 'DAILY': if (days.length) return null; pattern = { type: 'daily', interval }; break;
    case 'WEEKLY': pattern = { type: 'weekly', interval, daysOfWeek: weekdays.length ? weekdays : [DAYS[start.getDay()]], firstDayOfWeek: 'monday' }; break;
    case 'MONTHLY': pattern = pos && weekdays.length ? (index ? { type: 'relativeMonthly', interval, daysOfWeek: weekdays, index } : null) : days.length ? null : { type: 'absoluteMonthly', interval, dayOfMonth: Number(f['BYMONTHDAY'] || start.getDate()) }; break;
    case 'YEARLY': { const month = Number(f['BYMONTH'] || start.getMonth() + 1); pattern = pos && weekdays.length ? (index ? { type: 'relativeYearly', interval, daysOfWeek: weekdays, index, month } : null) : days.length ? null : { type: 'absoluteYearly', interval, dayOfMonth: Number(f['BYMONTHDAY'] || start.getDate()), month }; break; }
    default: return null;
  }
  if (!pattern) return null;
  const startDate = ymd(start);
  let range: any = { type: 'noEnd', startDate };
  if (f['UNTIL']) { const u = f['UNTIL']; range = { type: 'endDate', startDate, endDate: `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}` }; }
  else if (f['COUNT']) range = { type: 'numbered', startDate, numberOfOccurrences: Number(f['COUNT']) };
  void allDay;
  return { pattern, range };
}

/** occurrence starts of a series between from and to (at most 3000) */
export function expand(item: Item, from: Date, to: Date): Date[] {
  if (!item.rrule) return item.start >= from && item.start < to ? [item.start] : [];
  const recur = ICAL.Recur.fromString(item.rrule);
  const dtstart = item.allDay ? ICAL.Time.fromDateString(ymd(item.start)) : ICAL.Time.fromData({ year: item.start.getFullYear(), month: item.start.getMonth() + 1, day: item.start.getDate(), hour: item.start.getHours(), minute: item.start.getMinutes(), second: item.start.getSeconds(), isDate: false });
  const it = recur.iterator(dtstart); const out: Date[] = []; let next: any; let guard = 0;
  while ((next = it.next()) && guard++ < 20000) {
    const d = item.allDay ? new Date(next.year, next.month - 1, next.day) : new Date(next.year, next.month - 1, next.day, next.hour, next.minute, next.second);
    if (d >= to) break;
    if (d >= from && !item.exdates.some(x => sameSlot(x, d, item.allDay))) out.push(d);
    if (out.length >= 3000) break;
  }
  return out;
}

// ---------------------------------------------------------------- iCalendar text
const esc = (s: string) => (s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export function itemToIcs(item: Item, uid: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Elias De Hondt//DHMail//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`];
  if (item.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDate(item.start)}`, `DTEND;VALUE=DATE:${icsDate(item.end)}`);
  else lines.push(`DTSTART;TZID=${TZ}:${icsLocal(item.start)}`, `DTEND;TZID=${TZ}:${icsLocal(item.end)}`);
  if (item.rrule) lines.push(`RRULE:${item.rrule}`);
  for (const x of item.exdates) lines.push(item.allDay ? `EXDATE;VALUE=DATE:${icsDate(x)}` : `EXDATE;TZID=${TZ}:${icsLocal(x)}`);
  lines.push(`SUMMARY:${esc(item.title)}`);
  if (item.description) lines.push(`DESCRIPTION:${esc(item.description)}`);
  if (item.location) lines.push(`LOCATION:${esc(item.location)}`);
  for (const a of item.attendees) lines.push(`ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${a}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(l => l.length > 73 ? l.match(/.{1,73}/g)!.join('\r\n ') : l).join('\r\n') + '\r\n';
}

/** VEVENTs of an iCalendar object → items (overrides become their own event + an EXDATE on the series) */
export function icsToItems(text: string): Item[] {
  const comp = new ICAL.Component(ICAL.parse(text.replace(/\r?\n/g, '\r\n')));
  for (const tz of comp.getAllSubcomponents('vtimezone')) { try { ICAL.TimezoneService.register(tz); } catch {} }
  const vevents = comp.getAllSubcomponents('vevent');
  const masters = new Map<string, Item>(); const out: Item[] = [];
  const toItem = (v: any): Item => {
    const ev = new ICAL.Event(v); const allDay = ev.startDate.isDate;
    const start = allDay ? localDate(ev.startDate.toString()) : ev.startDate.toJSDate();
    const end = ev.endDate ? (allDay ? localDate(ev.endDate.toString()) : ev.endDate.toJSDate()) : new Date(start.getTime() + (allDay ? 86400000 : 3600000));
    const rrule = v.getFirstPropertyValue('rrule');
    const exdates: Date[] = []; for (const p of v.getAllProperties('exdate')) for (const t of p.getValues()) exdates.push(t.isDate ? localDate(t.toString()) : t.toJSDate());
    const attendees = v.getAllProperties('attendee').map((p: any) => String(p.getFirstValue() ?? '').replace(/^mailto:/i, '')).filter(Boolean);
    return { title: ev.summary ?? '', description: ev.description ?? '', location: ev.location ?? '', allDay, start, end, rrule: rrule ? rrule.toString() : undefined, exdates, attendees };
  };
  for (const v of vevents) if (!v.getFirstPropertyValue('recurrence-id')) { const it = toItem(v); masters.set(String(v.getFirstPropertyValue('uid')), it); out.push(it); }
  for (const v of vevents) { const rid: any = v.getFirstPropertyValue('recurrence-id'); if (!rid) continue; const master = masters.get(String(v.getFirstPropertyValue('uid'))); if (master) master.exdates.push(rid.isDate ? localDate(rid.toString()) : rid.toJSDate()); if (String(v.getFirstPropertyValue('status') ?? '').toUpperCase() !== 'CANCELLED') { const it = toItem(v); it.rrule = undefined; it.exdates = []; out.push(it); } }
  return out;
}

// ---------------------------------------------------------------- readers
async function readGoogle(accountId: number, calId: string): Promise<Item[]> {
  const raw: any[] = []; let pageToken = '';
  do { const q = new URLSearchParams({ singleEvents: 'false', showDeleted: 'true', maxResults: '2500' }); if (pageToken) q.set('pageToken', pageToken); const data = await gapi(accountId, `/calendars/${encodeURIComponent(calId)}/events?${q}`); raw.push(...(data.items ?? [])); pageToken = data.nextPageToken ?? ''; } while (pageToken);
  const toItem = (e: any): Item => {
    const allDay = !!e.start?.date;
    const start = allDay ? localDate(e.start.date) : new Date(e.start.dateTime), end = allDay ? localDate(e.end.date) : new Date(e.end.dateTime);
    const rec: string[] = e.recurrence ?? []; const rrule = rec.find(l => l.startsWith('RRULE:'))?.slice(6);
    const exdates: Date[] = []; for (const l of rec.filter(x => x.startsWith('EXDATE'))) for (const v of l.slice(l.indexOf(':') + 1).split(',')) exdates.push(/^\d{8}$/.test(v) ? localDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`) : v.endsWith('Z') ? new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}Z`) : new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13), +v.slice(13, 15)));
    return { title: e.summary ?? '', description: e.description ?? '', location: e.location ?? '', allDay, start, end, rrule, exdates, attendees: (e.attendees ?? []).filter((a: any) => !a.self && !a.organizer).map((a: any) => a.email).filter(Boolean), source: { id: e.id } };
  };
  const masters = new Map<string, Item>(); const out: Item[] = [];
  for (const e of raw) if (!e.recurringEventId && e.status !== 'cancelled' && e.start) { const it = toItem(e); masters.set(e.id, it); out.push(it); }
  for (const e of raw) {
    if (!e.recurringEventId) continue;
    const master = masters.get(e.recurringEventId); const o = e.originalStartTime;
    if (master && o) master.exdates.push(o.date ? localDate(o.date) : new Date(o.dateTime));
    if (e.status !== 'cancelled' && e.start) { const it = toItem(e); it.rrule = undefined; it.exdates = []; it.source = undefined; it.parent = e.recurringEventId; out.push(it); }
  }
  return out;
}

const MS_FIELDS = 'id,subject,body,location,start,end,isAllDay,recurrence,type,attendees,isCancelled,originalStart';
async function graphPages(accountId: number, url: string) { const out: any[] = []; let next: string | null = url; while (next) { const data: any = await graph(accountId, next, { headers: { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' } }); out.push(...(data?.value ?? [])); next = data?.['@odata.nextLink'] ?? null; } return out; }
async function readOutlook(accountId: number, calId: string): Promise<Item[]> {
  const utc = (t: any) => new Date(String(t.dateTime).replace(/(\.\d+)?$/, '') + 'Z');
  const toItem = (e: any): Item => { const allDay = !!e.isAllDay; const s = utc(e.start), en = utc(e.end); return { title: e.subject ?? '', description: e.body?.content ?? '', location: e.location?.displayName ?? '', allDay, start: allDay ? localDate(String(e.start.dateTime)) : s, end: allDay ? localDate(String(e.end.dateTime)) : en, exdates: [], attendees: (e.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean), source: { id: e.id } }; };
  const list = await graphPages(accountId, `/me/calendars/${encodeURIComponent(calId)}/events?$top=100&$select=${MS_FIELDS}`);
  const out: Item[] = []; const horizon = new Date(); horizon.setFullYear(horizon.getFullYear() + 3);
  for (const e of list) {
    if (e.isCancelled) continue;
    const it = toItem(e);
    if (e.type === 'seriesMaster') {
      it.rrule = graphToRrule(e.recurrence) ?? undefined;
      const rangeEnd = e.recurrence?.range?.type === 'endDate' ? new Date(`${e.recurrence.range.endDate}T23:59:59`) : horizon;
      const until = rangeEnd < horizon ? rangeEnd : horizon;
      try {
        const inst = await graphPages(accountId, `/me/events/${encodeURIComponent(e.id)}/instances?startDateTime=${it.start.toISOString()}&endDateTime=${until.toISOString()}&$top=100&$select=${MS_FIELDS}`);
        const seen: Date[] = [];
        for (const i of inst) { const orig = i.originalStart ? new Date(String(i.originalStart).replace(/(\.\d+)?Z?$/, 'Z')) : utc(i.start); seen.push(it.allDay ? localDate(String(i.start.dateTime)) : orig); if (i.type === 'exception' && !i.isCancelled) { it.exdates.push(it.allDay ? localDate(String(i.start.dateTime)) : orig); const x = toItem(i); x.source = undefined; x.parent = e.id; out.push(x); } }
        // occurrences Outlook no longer returns were cancelled
        if (it.rrule) for (const d of expand(it, it.start, until)) if (!seen.some(s => sameSlot(s, d, it.allDay)) && !it.exdates.some(s => sameSlot(s, d, it.allDay))) it.exdates.push(d);
      } catch (err: any) { log('outlook instances failed', err?.message); }
    }
    out.push(it);
  }
  return out;
}

async function readCalDav(cal: any): Promise<Item[]> {
  const objects = await fetchCalendarObjects(cal.url, cal.username ?? '', getSecret(`calendar:${cal.id}:password`) ?? '', cal.remote_id, new Date('1990-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z'));
  const out: Item[] = [];
  for (const o of objects) { try { const items = icsToItems(o.data); items.forEach((it, i) => { if (i === 0) { it.raw = o.data; it.source = { id: o.url, url: o.url, etag: o.etag }; } else { it.partOfRaw = true; it.parent = o.url; } }); out.push(...items); } catch (err: any) { log('caldav object skipped', err?.message); } }
  return out;
}

function readStored(cal: any): Item[] {
  return all('SELECT * FROM events WHERE calendar_id = ? AND (recurrence_id IS NULL OR recurrence_id = \'\')', cal.id).map(r => ({ title: r.title, description: r.description, location: r.location, allDay: !!r.all_day, start: r.all_day ? localDate(r.start) : new Date(r.start), end: r.all_day ? localDate(r.end) : new Date(r.end), exdates: [], attendees: JSON.parse(r.attendees || '[]').map((a: any) => a.email).filter(Boolean), source: { id: String(r.id) } }));
}

// ---------------------------------------------------------------- writers
async function writeGoogle(accountId: number, calId: string, it: Item) {
  const body: any = { summary: it.title, description: it.description || undefined, location: it.location || undefined, start: it.allDay ? { date: ymd(it.start) } : { dateTime: wall(it.start), timeZone: TZ }, end: it.allDay ? { date: ymd(it.end) } : { dateTime: wall(it.end), timeZone: TZ } };
  if (it.rrule) body.recurrence = [`RRULE:${it.rrule}`, ...it.exdates.map(x => it.allDay ? `EXDATE;VALUE=DATE:${icsDate(x)}` : `EXDATE;TZID=${TZ}:${icsLocal(x)}`)];
  if (it.attendees.length) body.attendees = it.attendees.map(email => ({ email }));
  await gapi(accountId, `/calendars/${encodeURIComponent(calId)}/events?sendUpdates=none`, { method: 'POST', body: JSON.stringify(body) });
}
async function writeOutlook(accountId: number, calId: string, it: Item) {
  // guests are written into the text instead of the guest list: Outlook would e-mail every one of them again
  const note = it.attendees.length ? `\n\nDeelnemers: ${it.attendees.join(', ')}` : '';
  const recurrence = it.rrule ? rruleToGraph(it.rrule, it.start, it.allDay) : null;
  if (it.rrule && !recurrence) { for (const d of expand(it, it.start, horizonFor(it))) await writeOutlook(accountId, calId, { ...it, rrule: undefined, exdates: [], start: d, end: new Date(d.getTime() + (it.end.getTime() - it.start.getTime())) }); return; }
  const when = (d: Date) => ({ dateTime: it.allDay ? `${ymd(d)}T00:00:00` : wall(d), timeZone: TZ });
  const created = await graph(accountId, `/me/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: JSON.stringify({ subject: it.title, body: { contentType: 'text', content: (it.description ?? '') + note }, location: { displayName: it.location ?? '' }, isAllDay: it.allDay, start: when(it.start), end: when(it.end), ...(recurrence ? { recurrence } : {}) }) });
  if (recurrence && it.exdates.length && created?.id) {
    const from = new Date(Math.min(...it.exdates.map(d => d.getTime())) - 86400000), to = new Date(Math.max(...it.exdates.map(d => d.getTime())) + 2 * 86400000);
    const inst = await graphPages(accountId, `/me/events/${encodeURIComponent(created.id)}/instances?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=100&$select=id,start`);
    for (const i of inst) { const s = it.allDay ? localDate(String(i.start.dateTime)) : new Date(String(i.start.dateTime).replace(/(\.\d+)?$/, '') + 'Z'); if (it.exdates.some(x => sameSlot(x, s, it.allDay))) await graph(accountId, `/me/events/${encodeURIComponent(i.id)}`, { method: 'DELETE' }).catch(() => {}); }
  }
}
async function writeCalDav(cal: any, it: Item) {
  const uid = it.raw ? (/^UID:(.+)$/m.exec(it.raw)?.[1]?.trim() ?? randomUUID()) : randomUUID();
  await putCalendarObject(cal.url, cal.username ?? '', getSecret(`calendar:${cal.id}:password`) ?? '', cal.remote_id, `${encodeURIComponent(uid)}.ics`, it.raw ?? itemToIcs(it, uid));
}
const horizonFor = (it: Item) => { const h = new Date(); h.setFullYear(h.getFullYear() + 2); return it.start > h ? new Date(it.start.getTime() + 86400000) : h; };
function writeLocal(cal: any, it: Item) {
  const length = it.end.getTime() - it.start.getTime(); const stamp = now();
  // local calendars keep single events: a series is written out as its occurrences (up to two years ahead)
  for (const d of it.rrule ? expand(it, it.start, horizonFor(it)) : [it.start]) {
    const e = new Date(d.getTime() + length);
    run('INSERT INTO events(calendar_id, uid, title, description, location, start, end, all_day, status, attendees, recurring, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', cal.id, randomUUID(), it.title, it.description, it.location, it.allDay ? ymd(d) : d.toISOString(), it.allDay ? ymd(e) : e.toISOString(), it.allDay, 'CONFIRMED', JSON.stringify(it.attendees.map(email => ({ name: '', email, status: 'NEEDS-ACTION' }))), 0, stamp);
  }
}

async function removeSource(cal: any, src: NonNullable<Item['source']>) {
  if (cal.source === 'google') await gapi(cal.account_id, `/calendars/${encodeURIComponent(cal.remote_id)}/events/${encodeURIComponent(src.id)}?sendUpdates=none`, { method: 'DELETE' });
  else if (cal.source === 'microsoft') await graph(cal.account_id, `/me/events/${encodeURIComponent(src.id)}`, { method: 'DELETE' });
  else if (cal.source === 'caldav') await deleteCalendarObject(cal.url, cal.username ?? '', getSecret(`calendar:${cal.id}:password`) ?? '', src.url ?? src.id, src.etag ?? null);
  else if (cal.source === 'local') run('DELETE FROM events WHERE id = ? AND calendar_id = ?', Number(src.id), cal.id);
}

const WRITABLE = ['google', 'microsoft', 'caldav', 'local'];
export async function transferCalendar(from: any, to: any, mode: 'copy' | 'move', syncCalendar: (id: number) => Promise<void>): Promise<CalendarTransferResult> {
  if (!from || !to) throw Object.assign(new Error('Calendar not found'), { status: 404 });
  if (from.id === to.id) throw Object.assign(new Error('Choose two different calendars'), { status: 400 });
  if (!WRITABLE.includes(to.source) || to.read_only) throw Object.assign(new Error('The target calendar is read-only'), { status: 403 });
  const canDelete = mode === 'move' && WRITABLE.includes(from.source) && !from.read_only;
  const progress = (message: string) => bus.emitEvent('sync:state', { accountId: to.account_id, kind: 'calendar', busy: true, message });
  progress(from.name);
  const items = from.source === 'google' ? await readGoogle(from.account_id, from.remote_id) : from.source === 'microsoft' ? await readOutlook(from.account_id, from.remote_id) : from.source === 'caldav' ? await readCalDav(from) : readStored(from);
  const result: CalendarTransferResult = { total: items.length, copied: 0, failed: 0, deleted: 0, errors: [], movedAll: canDelete };
  // a source object (series + its exceptions) is only deleted when every part of it was copied
  const failedSources = new Set<string>();
  let n = 0;
  try {
    for (const it of items) {
      n++; if (n % 10 === 0) progress(`${from.name} → ${to.name} · ${n}/${items.length}`);
      if (it.partOfRaw && from.source === 'caldav' && to.source === 'caldav') { result.copied++; continue; }
      try {
        const copy = to.source === 'caldav' ? it : { ...it, raw: undefined };
        if (to.source === 'google') await writeGoogle(to.account_id, to.remote_id, copy);
        else if (to.source === 'microsoft') await writeOutlook(to.account_id, to.remote_id, copy);
        else if (to.source === 'caldav') await writeCalDav(to, from.source === 'caldav' ? it : { ...it, raw: undefined });
        else writeLocal(to, copy);
        result.copied++;
      } catch (err: any) { result.failed++; const owner = it.source?.id ?? it.parent; if (owner) failedSources.add(owner); if (result.errors.length < 10) result.errors.push(`${it.title || '(zonder titel)'}: ${err?.message ?? err}`); }
    }
    if (canDelete) for (const it of items) {
      if (!it.source || failedSources.has(it.source.id)) continue;
      try { await removeSource(from, it.source); result.deleted++; } catch (err: any) { result.movedAll = false; if (result.errors.length < 10) result.errors.push(`${it.title}: niet verwijderd uit de bron (${err?.message ?? err})`); }
    }
    if (failedSources.size) result.movedAll = false;
  } finally {
    bus.emitEvent('sync:state', { accountId: to.account_id, kind: 'calendar', busy: false });
    await syncCalendar(to.id).catch(() => {});
    if (canDelete) await syncCalendar(from.id).catch(() => {});
  }
  return result;
}
