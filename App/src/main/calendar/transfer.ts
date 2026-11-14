import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';
import { all, get, now, run } from '../core/db';
import { getSecret } from '../core/secrets';
import { bus, log } from '../core/bus';
import { CalendarLabelsResult, CalendarTransferResult } from '../../shared/types';
import { gapi } from './google';
import { graph, outlookCategoryColors } from './microsoft';
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
  showAs?: string;
  isPrivate?: boolean;
  /** iCalendar UID (DHMail keeps labels of non-Outlook events per calendar + UID) */
  uid?: string;
  /** provider id of this exact event or exception (Google / Outlook) */
  remoteId?: string;
  /** label (category) names */
  categories?: string[];
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
  // guests go into the text, not as ATTENDEE: Google (CalDAV) e-mails every attendee an invitation, and when the
  // event is later removed a cancellation — which made Outlook delete its own copy of the event
  const guests = item.attendees.length ? `${item.description ? '\n\n' : ''}Deelnemers: ${item.attendees.join(', ')}` : '';
  if (item.description || guests) lines.push(`DESCRIPTION:${esc((item.description ?? '') + guests)}`);
  if (item.location) lines.push(`LOCATION:${esc(item.location)}`);
  if (item.categories?.length) lines.push(`CATEGORIES:${item.categories.map(esc).join(',')}`);
  const show = item.showAs ?? 'busy'; lines.push(`TRANSP:${show === 'free' ? 'TRANSPARENT' : 'OPAQUE'}`, `X-MICROSOFT-CDO-BUSYSTATUS:${({ busy: 'BUSY', free: 'FREE', tentative: 'TENTATIVE', oof: 'OOF', elsewhere: 'WORKINGELSEWHERE' } as any)[show] ?? 'BUSY'}`); if (item.isPrivate) lines.push('CLASS:PRIVATE');
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
    const busy = String(v.getFirstPropertyValue('x-microsoft-cdo-busystatus') ?? '').toUpperCase(); const showAs = busy === 'OOF' ? 'oof' : busy === 'WORKINGELSEWHERE' ? 'elsewhere' : busy === 'TENTATIVE' || String(v.getFirstPropertyValue('status') ?? '').toUpperCase() === 'TENTATIVE' ? 'tentative' : busy === 'FREE' || String(v.getFirstPropertyValue('transp') ?? '').toUpperCase() === 'TRANSPARENT' ? 'free' : 'busy';
    const categories = v.getAllProperties('categories').flatMap((p: any) => p.getValues().map((x: any) => String(x).trim())).filter(Boolean);
    return { title: ev.summary ?? '', description: ev.description ?? '', location: ev.location ?? '', allDay, start, end, rrule: rrule ? rrule.toString() : undefined, exdates, attendees, showAs, isPrivate: /^(PRIVATE|CONFIDENTIAL)$/i.test(String(v.getFirstPropertyValue('class') ?? '')), uid: String(v.getFirstPropertyValue('uid') ?? '') || undefined, categories };
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
    return { title: e.summary ?? '', description: e.description ?? '', location: e.location ?? '', allDay, start, end, rrule, exdates, attendees: (e.attendees ?? []).filter((a: any) => !a.self && !a.organizer).map((a: any) => a.email).filter(Boolean), source: { id: e.id }, showAs: e.eventType === 'outOfOffice' ? 'oof' : e.eventType === 'workingLocation' ? 'elsewhere' : e.status === 'tentative' ? 'tentative' : e.transparency === 'transparent' ? 'free' : 'busy', isPrivate: e.visibility === 'private' || e.visibility === 'confidential', uid: e.iCalUID ?? e.id, remoteId: e.id };
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

const MS_FIELDS = 'id,iCalUId,categories,subject,body,location,start,end,isAllDay,recurrence,type,attendees,isCancelled,originalStart,showAs,sensitivity';
async function graphPages(accountId: number, url: string) { const out: any[] = []; let next: string | null = url; while (next) { const data: any = await graph(accountId, next, { headers: { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' } }); out.push(...(data?.value ?? [])); next = data?.['@odata.nextLink'] ?? null; } return out; }
async function readOutlook(accountId: number, calId: string): Promise<Item[]> {
  const utc = (t: any) => new Date(String(t.dateTime).replace(/(\.\d+)?$/, '') + 'Z');
  const toItem = (e: any): Item => { const allDay = !!e.isAllDay; const s = utc(e.start), en = utc(e.end); return { title: e.subject ?? '', description: e.body?.content ?? '', location: e.location?.displayName ?? '', allDay, start: allDay ? localDate(String(e.start.dateTime)) : s, end: allDay ? localDate(String(e.end.dateTime)) : en, exdates: [], attendees: (e.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean), source: { id: e.id }, showAs: ({ free: 'free', tentative: 'tentative', oof: 'oof', workingElsewhere: 'elsewhere' } as any)[e.showAs] ?? 'busy', isPrivate: e.sensitivity === 'private' || e.sensitivity === 'confidential', uid: e.iCalUId ?? e.id, remoteId: e.id, categories: (e.categories ?? []).map((c: any) => String(c).trim()).filter(Boolean) }; };
  const list = await graphPages(accountId, `/me/calendars/${encodeURIComponent(calId)}/events?$top=100&$select=${MS_FIELDS}`);
  const out: Item[] = []; const horizon = new Date(); horizon.setFullYear(horizon.getFullYear() + 3);
  for (const e of list) {
    if (e.isCancelled) continue;
    const it = toItem(e);
    if (e.type === 'seriesMaster') {
      it.rrule = graphToRrule(e.recurrence) ?? undefined;
      const rangeEnd = e.recurrence?.range?.type === 'endDate' ? new Date(`${e.recurrence.range.endDate}T23:59:59`) : horizon;
      const until = rangeEnd < horizon ? rangeEnd : horizon;
      // Outlook answers at most 5 years per request
      const oldest = new Date(until); oldest.setFullYear(oldest.getFullYear() - 5); oldest.setDate(oldest.getDate() + 2);
      const since = it.start > oldest ? it.start : oldest;
      try {
        const inst = await graphPages(accountId, `/me/events/${encodeURIComponent(e.id)}/instances?startDateTime=${since.toISOString()}&endDateTime=${until.toISOString()}&$top=100&$select=${MS_FIELDS}`);
        const seen: Date[] = [];
        for (const i of inst) { const orig = i.originalStart ? new Date(String(i.originalStart).replace(/(\.\d+)?Z?$/, 'Z')) : utc(i.start); seen.push(it.allDay ? localDate(String(i.start.dateTime)) : orig); if (i.type === 'exception' && !i.isCancelled) { it.exdates.push(it.allDay ? localDate(String(i.start.dateTime)) : orig); const x = toItem(i); x.source = undefined; x.parent = e.id; out.push(x); } }
        // occurrences Outlook no longer returns were cancelled
        if (it.rrule) for (const d of expand(it, since, until)) if (!seen.some(s => sameSlot(s, d, it.allDay)) && !it.exdates.some(s => sameSlot(s, d, it.allDay))) it.exdates.push(d);
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
  return all('SELECT * FROM events WHERE calendar_id = ? AND (recurrence_id IS NULL OR recurrence_id = \'\')', cal.id).map(r => ({ title: r.title, description: r.description, location: r.location, allDay: !!r.all_day, start: r.all_day ? localDate(r.start) : new Date(r.start), end: r.all_day ? localDate(r.end) : new Date(r.end), exdates: [], attendees: JSON.parse(r.attendees || '[]').map((a: any) => a.email).filter(Boolean), source: { id: String(r.id) }, showAs: r.show_as || 'busy', isPrivate: !!r.private, uid: r.uid, categories: JSON.parse(r.categories || '[]').map((c: any) => String(c?.name ?? '').trim()).filter(Boolean) }));
}

// ---------------------------------------------------------------- writers
async function writeGoogle(accountId: number, calId: string, it: Item) {
  const body: any = { summary: it.title, description: it.description || undefined, location: it.location || undefined, start: it.allDay ? { date: ymd(it.start) } : { dateTime: wall(it.start), timeZone: TZ }, end: it.allDay ? { date: ymd(it.end) } : { dateTime: wall(it.end), timeZone: TZ } };
  if (it.rrule) body.recurrence = [`RRULE:${it.rrule}`, ...it.exdates.map(x => it.allDay ? `EXDATE;VALUE=DATE:${icsDate(x)}` : `EXDATE;TZID=${TZ}:${icsLocal(x)}`)];
  if (it.attendees.length) body.attendees = it.attendees.map(email => ({ email }));
  body.transparency = it.showAs === 'free' ? 'transparent' : 'opaque'; if (it.isPrivate) body.visibility = 'private';
  const colorId = googleColorId(it.categories); if (colorId) body.colorId = colorId;
  const created = await gapi(accountId, `/calendars/${encodeURIComponent(calId)}/events?sendUpdates=none`, { method: 'POST', body: JSON.stringify(body) });
  return [String(created?.iCalUID ?? created?.id ?? '')].filter(Boolean);
}
async function writeOutlook(accountId: number, calId: string, it: Item): Promise<string[]> {
  // guests are written into the text instead of the guest list: Outlook would e-mail every one of them again
  const note = it.attendees.length ? `\n\nDeelnemers: ${it.attendees.join(', ')}` : '';
  const recurrence = it.rrule ? rruleToGraph(it.rrule, it.start, it.allDay) : null;
  if (it.rrule && !recurrence) { for (const d of expand(it, it.start, horizonFor(it))) await writeOutlook(accountId, calId, { ...it, rrule: undefined, exdates: [], start: d, end: new Date(d.getTime() + (it.end.getTime() - it.start.getTime())) }); return []; }
  const when = (d: Date) => ({ dateTime: it.allDay ? `${ymd(d)}T00:00:00` : wall(d), timeZone: TZ });
  const created = await graph(accountId, `/me/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: JSON.stringify({ subject: it.title, body: { contentType: 'text', content: (it.description ?? '') + note }, location: { displayName: it.location ?? '' }, isAllDay: it.allDay, start: when(it.start), end: when(it.end), showAs: it.showAs === 'elsewhere' ? 'workingElsewhere' : it.showAs ?? 'busy', sensitivity: it.isPrivate ? 'private' : 'normal', isReminderOn: false, ...(it.categories?.length ? { categories: it.categories } : {}), ...(recurrence ? { recurrence } : {}) }) });
  if (recurrence && it.exdates.length && created?.id) {
    const from = new Date(Math.min(...it.exdates.map(d => d.getTime())) - 86400000), to = new Date(Math.max(...it.exdates.map(d => d.getTime())) + 2 * 86400000);
    const inst = await graphPages(accountId, `/me/events/${encodeURIComponent(created.id)}/instances?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=100&$select=id,start`);
    for (const i of inst) { const s = it.allDay ? localDate(String(i.start.dateTime)) : new Date(String(i.start.dateTime).replace(/(\.\d+)?$/, '') + 'Z'); if (it.exdates.some(x => sameSlot(x, s, it.allDay))) await graph(accountId, `/me/events/${encodeURIComponent(i.id)}`, { method: 'DELETE' }).catch(() => {}); }
  }
  // Outlook keeps the labels on the event itself
  return [];
}
async function writeCalDav(cal: any, it: Item) {
  const uid = it.raw ? (/^UID:(.+)$/m.exec(it.raw)?.[1]?.trim() ?? randomUUID()) : randomUUID();
  await putCalendarObject(cal.url, cal.username ?? '', getSecret(`calendar:${cal.id}:password`) ?? '', cal.remote_id, `${encodeURIComponent(uid)}.ics`, it.raw ?? itemToIcs(it, uid));
  return [uid];
}
const horizonFor = (it: Item) => { const h = new Date(); h.setFullYear(h.getFullYear() + 2); return it.start > h ? new Date(it.start.getTime() + 86400000) : h; };
function writeLocal(cal: any, it: Item): string[] {
  const length = it.end.getTime() - it.start.getTime(); const stamp = now(); const uids: string[] = [];
  // local calendars keep single events: a series is written out as its occurrences (up to two years ahead)
  for (const d of it.rrule ? expand(it, it.start, horizonFor(it)) : [it.start]) {
    const e = new Date(d.getTime() + length); const uid = randomUUID(); uids.push(uid);
    run('INSERT INTO events(calendar_id, uid, title, description, location, start, end, all_day, status, attendees, recurring, show_as, private, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cal.id, uid, it.title, it.description, it.location, it.allDay ? ymd(d) : d.toISOString(), it.allDay ? ymd(e) : e.toISOString(), it.allDay, 'CONFIRMED', JSON.stringify(it.attendees.map(email => ({ name: '', email, status: 'NEEDS-ACTION' }))), 0, it.showAs ?? 'busy', !!it.isPrivate, stamp);
  }
  return uids;
}

// ---------------------------------------------------------------- labels
/** Google Calendar's fixed event colours (colorId 1-11) */
const GOOGLE_COLORS: [string, string][] = [['1', '#7986cb'], ['2', '#33b679'], ['3', '#8e24aa'], ['4', '#e67c73'], ['5', '#f6bf26'], ['6', '#f4511e'], ['7', '#039be5'], ['8', '#616161'], ['9', '#3f51b5'], ['10', '#0b8043'], ['11', '#d50000']];
const rgb = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const labelColor = (name: string) => get<{ color: string }>('SELECT color FROM categories WHERE lower(name) = lower(?)', name)?.color;
/** Google has no labels: the event gets the Google colour closest to its first label, so it also stands out in Google Calendar itself */
function googleColorId(names?: string[]): string | null {
  const c = names?.length ? rgb(labelColor(names[0]) ?? '') : null; if (!c) return null;
  let best: string | null = null, dist = Infinity;
  for (const [id, hex] of GOOGLE_COLORS) { const g = rgb(hex)!; const d = (c[0] - g[0]) ** 2 + (c[1] - g[1]) ** 2 + (c[2] - g[2]) ** 2; if (d < dist) { dist = d; best = id; } }
  return best;
}
const merge = (a: string[] | undefined, b: string[] | undefined) => { const out: string[] = []; for (const n of [...(a ?? []), ...(b ?? [])]) if (n && !out.some(x => x.toLowerCase() === n.toLowerCase())) out.push(n); return out.slice(0, 25); };
/** labels DHMail keeps itself for non-Outlook events (set in DHMail on a Google / CalDAV / local event) */
function withStoredLabels(cal: any, items: Item[]) {
  if (cal.source === 'microsoft') return;
  const stored = new Map(all<{ uid: string; names: string }>('SELECT uid, names FROM event_categories WHERE calendar_id = ?', cal.id).map(r => [r.uid, JSON.parse(r.names || '[]') as string[]]));
  for (const it of items) { const extra = it.uid ? stored.get(it.uid) : undefined; if (extra?.length) it.categories = merge(it.categories, extra); }
}
/** every label used gets a DHMail label (with the Outlook colour when the source is Outlook), so it shows in colour */
async function ensureLabels(from: any, labelNames: string[]) {
  const names = merge([], labelNames); if (!names.length) return;
  const outlook = from.source === 'microsoft' && from.account_id ? await outlookCategoryColors(from.account_id).catch(() => new Map<string, string>()) : new Map<string, string>();
  const colors = new Map([...outlook].map(([n, c]) => [n.toLowerCase(), c]));
  for (const name of names) {
    if (labelColor(name)) continue;
    const order = (get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories')?.m ?? 0) + 1;
    run('INSERT INTO categories(name, color, sort_order) VALUES(?,?,?)', name, colors.get(name.toLowerCase()) ?? '#4f94f0', order);
  }
}
function storeLabels(calendarId: number, uid: string, names: string[]) {
  const cur = get<{ names: string }>('SELECT names FROM event_categories WHERE calendar_id = ? AND uid = ?', calendarId, uid);
  const next = merge(cur ? JSON.parse(cur.names || '[]') : [], names); if (!next.length) return;
  run('INSERT INTO event_categories(calendar_id, uid, names) VALUES(?,?,?) ON CONFLICT(calendar_id, uid) DO UPDATE SET names = excluded.names', calendarId, uid, JSON.stringify(next));
}
async function readItems(cal: any): Promise<Item[]> {
  const items = cal.source === 'google' ? await readGoogle(cal.account_id, cal.remote_id) : cal.source === 'microsoft' ? await readOutlook(cal.account_id, cal.remote_id) : cal.source === 'caldav' ? await readCalDav(cal) : readStored(cal);
  withStoredLabels(cal, items);
  return items;
}

/** the same event in two calendars: same title and same start */
export const matchKey = (it: { title: string; allDay: boolean; start: Date }) => `${it.allDay ? 'd' : 't'}|${(it.title ?? '').trim().toLowerCase()}|${it.allDay ? ymd(it.start) : Math.round(it.start.getTime() / 60000)}`;
/** for "is it already there": a repeating series only matches a series, a single event only a single event
 *  (a series that matched just its first occurrence was removed as a "double" while the rest existed nowhere else) */
const sameKey = (it: Item) => `${matchKey(it)}|${it.rrule ? 'series' : 'single'}`;
const byKey = (items: Item[]) => { const m = new Map<string, Item[]>(); for (const it of items) { const k = sameKey(it); m.set(k, [...(m.get(k) ?? []), it]); } return m; };

/**
 * Where an event in the target finds its labels:
 * 1. the same event (title + start) in the source calendar, as it is now or as DHMail last synced it
 *    (so events an earlier move already removed from the source still have theirs);
 * 2. otherwise the label (nearly) every source event with that title has, e.g. "Biking" → 🚲Biking🚲.
 */
export function labelFinder(sourceItems: Item[], stored: { title: string; start: string; all_day: number | boolean; categories?: string | null; names?: string | null }[]) {
  const exact = new Map<string, string[]>(); const byTitle = new Map<string, { all: number; labels: Map<string, number> }>();
  const add = (k: string, title: string, names: string[]) => {
    const t = (title ?? '').trim().toLowerCase(); const s = byTitle.get(t) ?? { all: 0, labels: new Map<string, number>() }; s.all++; byTitle.set(t, s);
    if (!names.length) return; if (!exact.has(k)) exact.set(k, names);
    const j = JSON.stringify(names); s.labels.set(j, (s.labels.get(j) ?? 0) + 1);
  };
  for (const it of sourceItems) add(matchKey(it), it.title, it.categories ?? []);
  for (const r of stored) {
    const names = merge(JSON.parse(r.categories || '[]').map((c: any) => String(c?.name ?? '').trim()), JSON.parse(r.names || '[]'));
    const allDay = !!r.all_day; const start = allDay ? localDate(r.start) : new Date(r.start); if (isNaN(start.getTime())) continue;
    add(matchKey({ title: r.title, allDay, start }), r.title, names);
  }
  const names = merge([], [...exact.values()].flat());
  const find = (it: Item): string[] | undefined => {
    const hit = exact.get(matchKey(it)); if (hit) return hit;
    const s = byTitle.get((it.title ?? '').trim().toLowerCase()); if (!s || !s.labels.size) return undefined;
    let best = '', n = 0, labelled = 0; for (const [j, c] of s.labels) { labelled += c; if (c > n) { n = c; best = j; } }
    // only when that title is mostly labelled, and mostly with the same label
    return labelled / s.all >= 0.5 && n / labelled >= 0.75 ? JSON.parse(best) : undefined;
  };
  return { find, names };
}
/** what a calendar tells about labels: nothing when it has no labels at all (its unlabelled events would only water down the title rule) */
async function labelSources(cals: { cal: any; items: Item[] }[]) {
  const items: Item[] = []; const stored: any[] = [];
  for (const { cal, items: list } of cals) { const rows = storedLabels(cal); const has = list.some(it => it.categories?.length) || rows.some((r: any) => (r.categories && r.categories !== '[]') || r.names); if (has) { items.push(...list); stored.push(...rows); } }
  return labelFinder(items, stored);
}
/** labels as DHMail last synced them for the source calendar (Outlook keeps them on the event, others in event_categories) */
const storedLabels = (cal: any) => all<any>('SELECT e.title, e.start, e.all_day, e.categories, ec.names FROM events e LEFT JOIN event_categories ec ON ec.calendar_id = e.calendar_id AND ec.uid = e.uid WHERE e.calendar_id = ?', cal.id);

/** gives every target event without its labels yet the labels the finder knows; returns how many changed */
async function applyLabels(to: any, targets: Item[], find: (it: Item) => string[] | undefined, errors: string[]) {
  let changed = 0; const doneUids = new Set<string>();
  for (const t of targets) {
    const names = find(t); if (!names?.length) continue;
    const next = merge(t.categories, names); if (next.length === (t.categories ?? []).length) continue;
    try {
      if (to.source === 'microsoft') { if (!t.remoteId) continue; await patient(() => graph(to.account_id, `/me/events/${encodeURIComponent(t.remoteId!)}`, { method: 'PATCH', body: JSON.stringify({ categories: next }) })); }
      else {
        if (!t.uid) continue;
        if (!doneUids.has(t.uid)) { storeLabels(to.id, t.uid, next); doneUids.add(t.uid); }
        const colorId = to.source === 'google' && t.remoteId ? googleColorId(next) : null;
        if (colorId) await patient(() => gapi(to.account_id, `/calendars/${encodeURIComponent(to.remote_id)}/events/${encodeURIComponent(t.remoteId!)}?sendUpdates=none`, { method: 'PATCH', body: JSON.stringify({ colorId }) }));
      }
      t.categories = next; changed++;
    } catch (err: any) { if (errors.length < 10) errors.push(`${t.title || '(zonder titel)'}: label niet gezet (${err?.message ?? err})`); }
  }
  return changed;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** retries a call that failed because the server is busy or throttling (Outlook and Google both do with thousands of calls) */
async function patient<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err: any) {
      const transient = [429, 500, 502, 503, 504].includes(err?.status) || /\b(429|500|502|503|504)\b|rate ?limit|throttl|too many|quota/i.test(String(err?.message ?? ''));
      if (!transient || i >= 4) throw err;
      await sleep([2000, 5000, 10000, 20000][i]);
    }
  }
}

async function removeSource(cal: any, src: NonNullable<Item['source']>) {
  // already gone (e.g. removed by an earlier run) counts as removed
  if (cal.source === 'google') await gapi(cal.account_id, `/calendars/${encodeURIComponent(cal.remote_id)}/events/${encodeURIComponent(src.id)}?sendUpdates=none`, { method: 'DELETE' }).catch((err: any) => { if (err?.status !== 404 && err?.status !== 410) throw err; });
  else if (cal.source === 'microsoft') await graph(cal.account_id, `/me/events/${encodeURIComponent(src.id)}`, { method: 'DELETE' }).catch((err: any) => { if (err?.status !== 404) throw err; });
  else if (cal.source === 'caldav') await deleteCalendarObject(cal.url, cal.username ?? '', getSecret(`calendar:${cal.id}:password`) ?? '', src.url ?? src.id, src.etag ?? null);
  else if (cal.source === 'local') run('DELETE FROM events WHERE id = ? AND calendar_id = ?', Number(src.id), cal.id);
}

const WRITABLE = ['google', 'microsoft', 'caldav', 'local'];
/**
 * Events that are already in the target (same title + start, e.g. from an earlier copy or a move that stopped
 * halfway) are not written again: they only get their labels, and when moving the source copy is still removed.
 * So running a move again finishes it without making doubles.
 */
export async function transferCalendar(from: any, to: any, mode: 'copy' | 'move', syncCalendar: (id: number) => Promise<void>): Promise<CalendarTransferResult> {
  if (!from || !to) throw Object.assign(new Error('Calendar not found'), { status: 404 });
  if (from.id === to.id) throw Object.assign(new Error('Choose two different calendars'), { status: 400 });
  if (!WRITABLE.includes(to.source) || to.read_only) throw Object.assign(new Error('The target calendar is read-only'), { status: 403 });
  const canDelete = mode === 'move' && WRITABLE.includes(from.source) && !from.read_only;
  const progress = (message: string) => bus.emitEvent('sync:state', { accountId: to.account_id, kind: 'calendar', busy: true, message });
  progress(from.name);
  const items = await readItems(from);
  const existing = await readItems(to); const present = byKey(existing);
  // labels are known from both sides: e.g. moving back from Google to Outlook, Outlook's own events tell which label a title gets
  const labels = await labelSources([{ cal: from, items }, { cal: to, items: existing }]);
  await ensureLabels(from.source === 'microsoft' ? from : to, [...items.flatMap(it => it.categories ?? []), ...labels.names]);
  const result: CalendarTransferResult = { total: items.length, copied: 0, skipped: 0, labelled: 0, failed: 0, deleted: 0, errors: [], movedAll: canDelete };
  // a source object (series + its exceptions) is only deleted when every part of it was copied
  const failedSources = new Set<string>();
  let n = 0;
  try {
    for (const it of items) {
      n++; if (n % 10 === 0) progress(`${from.name} → ${to.name} · ${n}/${items.length}`);
      if (it.partOfRaw && from.source === 'caldav' && to.source === 'caldav') { result.copied++; continue; }
      if (present.has(sameKey(it))) { result.skipped++; continue; }
      try {
        // labels the event has, else the ones the other events tell (written along: Outlook keeps them on the event, Google gets a colour)
        const names = it.categories?.length ? it.categories : labels.find(it) ?? [];
        const copy = to.source === 'caldav' ? { ...it, categories: names } : { ...it, raw: undefined, categories: names };
        const uids = await patient(() => to.source === 'google' ? writeGoogle(to.account_id, to.remote_id, copy)
          : to.source === 'microsoft' ? writeOutlook(to.account_id, to.remote_id, copy)
          : to.source === 'caldav' ? writeCalDav(to, from.source === 'caldav' ? copy : { ...copy, raw: undefined })
          : Promise.resolve(writeLocal(to, copy)));
        if (names.length) { for (const uid of uids) storeLabels(to.id, uid, names); result.labelled++; }
        result.copied++;
      } catch (err: any) { result.failed++; const owner = it.source?.id ?? it.parent; if (owner) failedSources.add(owner); if (result.errors.length < 10) result.errors.push(`${it.title || '(zonder titel)'}: ${err?.message ?? err}`); }
    }
    // events that were already there (earlier copy / half-finished move) get their labels now
    progress(`${to.name} · labels`);
    const copiedKeys = new Set(items.map(sameKey));
    result.labelled += await applyLabels(to, existing.filter(t => copiedKeys.has(sameKey(t))), labels.find, result.errors);
    if (canDelete) for (const it of items) {
      if (!it.source || failedSources.has(it.source.id)) continue;
      if (result.deleted % 10 === 0) progress(`${from.name} · ${result.deleted} verwijderd`);
      try { await patient(() => removeSource(from, it.source!)); result.deleted++; } catch (err: any) { result.movedAll = false; if (result.errors.length < 10) result.errors.push(`${it.title}: niet verwijderd uit de bron (${err?.message ?? err})`); }
    }
    if (failedSources.size) result.movedAll = false;
  } finally {
    bus.emitEvent('sync:state', { accountId: to.account_id, kind: 'calendar', busy: false });
    await syncCalendar(to.id).catch(() => {});
    if (canDelete) await syncCalendar(from.id).catch(() => {});
  }
  return result;
}

// ---------------------------------------------------------------- labels only
/** Puts the labels of the events in one calendar onto the same events in another one (matched on title + start,
 *  else on title), e.g. after a copy made before labels were carried over. Nothing is created or deleted. */
export async function copyCalendarLabels(from: any, to: any, syncCalendar: (id: number) => Promise<void>): Promise<CalendarLabelsResult> {
  if (!from || !to) throw Object.assign(new Error('Calendar not found'), { status: 404 });
  if (from.id === to.id) throw Object.assign(new Error('Choose two different calendars'), { status: 400 });
  if (!WRITABLE.includes(to.source) || to.read_only) throw Object.assign(new Error('The target calendar is read-only'), { status: 403 });
  const progress = (message: string) => bus.emitEvent('sync:state', { accountId: to.account_id, kind: 'calendar', busy: true, message });
  progress(`${from.name} → ${to.name}`);
  const result: CalendarLabelsResult = { total: 0, updated: 0, unmatched: 0, failed: 0, errors: [] };
  try {
    const targets = await readItems(to);
    const labels = await labelSources([{ cal: from, items: await readItems(from) }, { cal: to, items: targets }]);
    await ensureLabels(from.source === 'microsoft' ? from : to, labels.names);
    result.total = targets.length;
    result.updated = await applyLabels(to, targets, labels.find, result.errors);
    result.failed = result.errors.length;
    result.unmatched = targets.filter(t => !t.categories?.length).length;
  } finally {
    bus.emitEvent('sync:state', { accountId: to.account_id, kind: 'calendar', busy: false });
    await syncCalendar(to.id).catch(() => {});
  }
  return result;
}

/** what a transfer would do, without changing anything */
export async function previewTransfer(from: any, to: any) {
  const items = await readItems(from); const existing = await readItems(to); const present = byKey(existing);
  const labels = await labelSources([{ cal: from, items }, { cal: to, items: existing }]);
  const todo = items.filter(it => !present.has(sameKey(it)));
  const withLabels = todo.filter(it => (it.categories?.length ? it.categories : labels.find(it))?.length);
  const titles = new Map<string, string>(); for (const it of todo) if (!titles.has(it.title)) titles.set(it.title, (it.categories?.length ? it.categories : labels.find(it) ?? []).join(', ') || '-');
  return { source: items.length, target: existing.length, alreadyThere: items.length - todo.length, toCopy: todo.length, toCopyWithLabels: withLabels.length, series: todo.filter(it => it.rrule).length, titles: [...titles] };
}
