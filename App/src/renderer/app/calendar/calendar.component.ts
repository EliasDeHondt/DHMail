import { Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { addDays, contrast, dayKey, htmlToPlain, isoWeek, sameDay, startOfDay, startOfWeek, timeShort, toLocalInput } from '../core/format';
import { IconComponent } from '../shared/icon.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService, MenuItem } from '../shared/dialogs.service';
import { COLOR_PRESETS } from '../shared/color-picker.component';
import { EventDialogComponent } from './event-dialog.component';
import { CalendarDialogComponent } from './calendar-dialog.component';
import { Calendar, CalendarEvent, EventInput } from '../../../shared/types';
export type View = 'day' | 'workweek' | 'week' | 'month';
export const HOUR_PX = 35;
const SNAP_MIN = 15;
export type DragMode = 'move' | 'start' | 'end';
export interface DragState { event: CalendarEvent; mode: DragMode; pointerId: number; x: number; y: number; grabOffset: number; moved: boolean; day: number; startMin: number; endMin: number; }
export interface Placed { event: CalendarEvent; top: number; height: number; left: number; width: number; start: Date; end: Date; }
export interface AllDayPlaced { event: CalendarEvent; col: number; span: number; row: number; }
@Component({ selector: 'app-calendar', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent, EventDialogComponent, CalendarDialogComponent], templateUrl: './calendar.component.html', styleUrl: './calendar.component.css' })
export class CalendarComponent implements OnDestroy {
  readonly store = inject(StoreService);
  private bridge = inject(BridgeService);
  private toast = inject(ToastService);
  private dialogs = inject(DialogsService);
  private translate = inject(TranslateService);
  readonly view = signal<View>('week');
  readonly cursor = signal<Date>(startOfDay(new Date()));
  readonly miniMonth = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly events = signal<CalendarEvent[]>([]);
  readonly loading = signal(false);
  readonly now = signal(new Date());
  readonly editing = signal<Partial<EventInput> & { readOnly?: boolean; event?: CalendarEvent } | null>(null);
  readonly addingCalendar = signal(false);
  readonly popover = signal<{ event: CalendarEvent; x: number; y: number } | null>(null);
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly hourPx = HOUR_PX;
  readonly Math = Math;
  readonly drag = signal<DragState | null>(null);
  readonly renaming = signal<number | null>(null);
  private suppressClick = false;
  private offs: (() => void)[] = [];
  private tick: any;
  private scrolledEl: HTMLElement | null = null;
  @ViewChild('gridScroll') set gridScroll(ref: ElementRef<HTMLElement> | undefined) { const el = ref?.nativeElement; if (!el || el === this.scrolledEl) return; this.scrolledEl = el; queueMicrotask(() => el.scrollTop = Math.max(0, this.store.settings().workDayStart - 1) * HOUR_PX); }
  readonly weekStart = computed(() => this.store.settings().weekStartsOn || 1);
  readonly range = computed(() => { const c = this.cursor(); const v = this.view(); if (v === 'day') return { start: startOfDay(c), end: addDays(startOfDay(c), 1) }; if (v === 'month') { const first = new Date(c.getFullYear(), c.getMonth(), 1); const start = startOfWeek(first, this.weekStart()); return { start, end: addDays(start, 42) }; } const start = startOfWeek(c, this.weekStart()); return { start, end: addDays(start, v === 'workweek' ? 5 : 7) }; });
  readonly days = computed(() => { const { start, end } = this.range(); const out: Date[] = []; for (let d = start; d < end; d = addDays(d, 1)) out.push(d); return out; });
  readonly title = computed(() => { const loc = this.store.locale(); const c = this.cursor(); const v = this.view(); if (v === 'day') return c.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); if (v === 'month') return c.toLocaleDateString(loc, { month: 'long', year: 'numeric' }); const { start, end } = this.range(); const last = addDays(end, -1); const same = start.getMonth() === last.getMonth(); const a = start.toLocaleDateString(loc, { day: 'numeric', month: same ? undefined : 'short' }); const b = last.toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }); return `${a} – ${b}, ${this.translate.instant('APP.CALENDAR.WEEK')} ${isoWeek(start)}`; });
  readonly groups = computed(() => { const cals = this.store.calendars(); const groups = new Map<string, Calendar[]>(); for (const c of cals) { const key = c.group || ''; groups.set(key, [...(groups.get(key) ?? []), c]); } return [...groups.entries()].map(([key, list]) => ({ key, label: key || this.translate.instant('APP.CALENDAR.OTHER_CALENDARS'), list })).sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1)); });
  readonly writable = computed(() => this.store.calendars().filter(c => !c.readOnly && c.source !== 'ics' && c.source !== 'birthdays'));
  readonly allDayByDay = computed(() => { const days = this.days(); const list = this.events().filter(e => this.isAllDayLike(e)); const rows: AllDayPlaced[] = []; const occupancy: boolean[][] = []; for (const e of list.sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))) { const s = this.eventStart(e), en = this.eventEnd(e); let col = days.findIndex(d => addDays(d, 1) > s); if (col < 0) continue; let endCol = days.findIndex(d => d >= en); if (endCol < 0) endCol = days.length; const span = Math.max(1, endCol - col); let row = 0; while (occupancy[row]?.slice(col, col + span).some(Boolean)) row++; occupancy[row] = occupancy[row] ?? []; for (let i = col; i < col + span; i++) occupancy[row][i] = true; rows.push({ event: e, col, span, row }); } return { items: rows, rows: occupancy.length }; });
  readonly timedByDay = computed<Placed[][]>(() => this.days().map(day => this.layout(day, this.events().filter(e => !this.isAllDayLike(e)))));
  readonly monthCells = computed(() => this.days().map(day => { const next = addDays(day, 1); const items = this.events().filter(e => this.eventStart(e) < next && this.eventEnd(e) > day).sort((a, b) => Number(this.isAllDayLike(b)) - Number(this.isAllDayLike(a)) || a.start.localeCompare(b.start)); return { day, items, inMonth: day.getMonth() === this.cursor().getMonth(), today: sameDay(day, this.now()) }; }));
  readonly miniDays = computed(() => { const m = this.miniMonth(); const start = startOfWeek(new Date(m.getFullYear(), m.getMonth(), 1), this.weekStart()); const out: { date: Date; inMonth: boolean; today: boolean; selected: boolean; week: number }[] = []; const { start: rs, end: re } = this.range(); for (let i = 0; i < 42; i++) { const d = addDays(start, i); out.push({ date: d, inMonth: d.getMonth() === m.getMonth(), today: sameDay(d, this.now()), selected: d >= rs && d < re, week: isoWeek(d) }); } return out; });
  readonly weekdayNames = computed(() => { const loc = this.store.locale(); const start = startOfWeek(new Date(2024, 0, 1), this.weekStart()); return Array.from({ length: 7 }, (_, i) => addDays(start, i).toLocaleDateString(loc, { weekday: 'short' })); });
  readonly nowTop = computed(() => (this.now().getHours() * 60 + this.now().getMinutes()) / 60 * HOUR_PX);
  constructor() { this.load(); this.offs.push(this.bridge.on('calendar:changed', () => this.load())); this.tick = setInterval(() => this.now.set(new Date()), 60_000); }
  ngOnDestroy() { this.offs.forEach(f => f()); clearInterval(this.tick); this.clearDragCursor(); }
  plain = htmlToPlain;
  isAllDayLike = (e: CalendarEvent) => e.allDay || new Date(e.end).getTime() - new Date(e.start).getTime() >= 24 * 3600 * 1000;
  eventStart = (e: CalendarEvent) => e.allDay ? parseLocalDate(e.start) : new Date(e.start);
  eventEnd = (e: CalendarEvent) => e.allDay ? parseLocalDate(e.end) : new Date(e.end);
  time = (d: Date) => timeShort(d, this.store.locale());
  textColor = contrast;
  dayLabel = (d: Date) => d.toLocaleDateString(this.store.locale(), { weekday: 'short' });
  isToday = (d: Date) => sameDay(d, this.now());
  hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
  eventTime = (e: CalendarEvent) => { if (e.allDay) { const s = parseLocalDate(e.start), en = addDays(parseLocalDate(e.end), -1); return sameDay(s, en) ? s.toLocaleDateString(this.store.locale(), { weekday: 'long', day: 'numeric', month: 'long' }) : `${s.toLocaleDateString(this.store.locale(), { day: 'numeric', month: 'short' })} – ${en.toLocaleDateString(this.store.locale(), { day: 'numeric', month: 'short' })}`; } const s = new Date(e.start), en = new Date(e.end); return `${s.toLocaleDateString(this.store.locale(), { weekday: 'long', day: 'numeric', month: 'long' })} · ${this.time(s)} – ${sameDay(s, en) ? '' : en.toLocaleDateString(this.store.locale(), { day: 'numeric', month: 'short' }) + ' '}${this.time(en)}`; };
  calendarOf = (id: number) => this.store.calendars().find(c => c.id === id) ?? null;
  private layout(day: Date, list: CalendarEvent[]): Placed[] { const dayStart = startOfDay(day), dayEnd = addDays(dayStart, 1); const items = list.filter(e => new Date(e.start) < dayEnd && new Date(e.end) > dayStart).map(e => { const s = new Date(Math.max(new Date(e.start).getTime(), dayStart.getTime())); const en = new Date(Math.min(new Date(e.end).getTime(), dayEnd.getTime())); return { event: e, start: s, end: en, top: (s.getTime() - dayStart.getTime()) / 3600000 * HOUR_PX, height: Math.max(22, (en.getTime() - s.getTime()) / 3600000 * HOUR_PX - 2), left: 0, width: 100, col: 0, cols: 1 }; }).sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime()); const columns: typeof items[] = []; let clusterEnd = 0; let cluster: typeof items = []; const finish = () => { for (const it of cluster) { it.cols = columns.length; it.width = 100 / columns.length; it.left = it.col * it.width; } columns.length = 0; cluster = []; }; for (const it of items) { if (cluster.length && it.start.getTime() >= clusterEnd) finish(); let placed = false; for (let c = 0; c < columns.length; c++) { if (columns[c].every(o => o.end.getTime() <= it.start.getTime() || o.start.getTime() >= it.end.getTime())) { columns[c].push(it); it.col = c; placed = true; break; } } if (!placed) { it.col = columns.length; columns.push([it]); } cluster.push(it); clusterEnd = Math.max(clusterEnd, it.end.getTime()); } finish(); return items; }
  async load() { const { start, end } = this.range(); this.loading.set(true); try { this.events.set(await this.bridge.invoke('calendar:events', start.toISOString(), end.toISOString())); } catch (err) { this.toast.error(err); } finally { this.loading.set(false); } }
  setView(v: View) { this.view.set(v); this.load(); }
  go(n: number) { const v = this.view(); const c = this.cursor(); const next = v === 'month' ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, n * (v === 'day' ? 1 : 7)); this.cursor.set(next); this.miniMonth.set(new Date(next.getFullYear(), next.getMonth(), 1)); this.load(); }
  today() { const t = startOfDay(new Date()); this.cursor.set(t); this.miniMonth.set(new Date(t.getFullYear(), t.getMonth(), 1)); this.load(); }
  pickDay(d: Date) { this.cursor.set(startOfDay(d)); if (this.view() === 'month' && d.getMonth() !== this.miniMonth().getMonth()) this.miniMonth.set(new Date(d.getFullYear(), d.getMonth(), 1)); this.load(); }
  openDay(d: Date) { this.cursor.set(startOfDay(d)); this.view.set('day'); this.load(); }
  miniGo(n: number) { const m = this.miniMonth(); this.miniMonth.set(new Date(m.getFullYear(), m.getMonth() + n, 1)); }
  async toggleCalendar(c: Calendar) { try { this.store.calendars.set(await this.bridge.invoke('calendar:update', c.id, { visible: !c.visible })); this.load(); } catch (err) { this.toast.error(err); } }
  async syncAll() { this.loading.set(true); try { this.store.calendars.set(await this.bridge.invoke('calendar:sync', null)); await this.load(); } catch (err) { this.toast.error(err); } finally { this.loading.set(false); } }
  calendarMenu(e: MouseEvent, c: Calendar) { const t = (k: string, p?: any) => this.translate.instant(k, p); const items: MenuItem[] = [{ label: t('APP.CALENDAR.REFRESH'), icon: 'refresh', action: () => this.bridge.invoke('calendar:sync', c.id).then(list => { this.store.calendars.set(list); this.load(); }).catch(err => this.toast.error(err)) }, { label: t('APP.CALENDAR.RENAME'), icon: 'edit', action: () => this.startRename(c) }, { label: t('APP.CALENDAR.COLOR'), icon: 'tag', children: COLOR_PRESETS.map(color => ({ label: color, color, checked: color.toLowerCase() === c.color.toLowerCase(), action: async () => { this.store.calendars.set(await this.bridge.invoke('calendar:update', c.id, { color })); this.load(); } })) }]; if (c.source !== 'birthdays' && !(c.source === 'google' || c.source === 'microsoft')) items.push({ separator: true }, { label: t('APP.COMMON.REMOVE'), icon: 'trash', danger: true, action: async () => { if (await this.dialogs.confirm(t('APP.CALENDAR.REMOVE_CONFIRM', { name: c.name }), t('APP.COMMON.REMOVE'), true)) { this.store.calendars.set(await this.bridge.invoke('calendar:remove', c.id)); this.load(); } } }); this.dialogs.openMenu(e, items); }
  newEvent(start?: Date, allDay = false) { const cal = this.writable()[0]; if (!cal) { this.toast.show(this.translate.instant('APP.CALENDAR.NO_WRITABLE'), 'error'); return; } const s = start ?? this.roundNow(); const en = new Date(s.getTime() + 60 * 60 * 1000); this.editing.set({ calendarId: cal.id, title: '', description: '', location: '', allDay, start: allDay ? dayKey(s) : toLocalInput(s), end: allDay ? dayKey(addDays(s, 1)) : toLocalInput(en) }); }
  private roundNow() { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); return d; }
  slotClick(day: Date, e: MouseEvent) { if (this.suppressClick || this.drag() || (e.target as HTMLElement).closest('.ev')) return; const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); const minutes = Math.floor((e.clientY - rect.top) / HOUR_PX * 60 / 30) * 30; const s = new Date(day); s.setHours(0, minutes, 0, 0); this.newEvent(s); }
  showEvent(ev: CalendarEvent, e: MouseEvent) { e.stopPropagation(); if (this.suppressClick) { this.suppressClick = false; return; } this.popover.set({ event: ev, x: Math.min(e.clientX, window.innerWidth - 340), y: Math.min(e.clientY, window.innerHeight - 260) }); }
  editEvent(ev: CalendarEvent) { this.popover.set(null); this.editing.set({ id: ev.id, calendarId: ev.calendarId, title: ev.title, description: ev.description, location: ev.location, allDay: ev.allDay, start: ev.allDay ? ev.start.slice(0, 10) : toLocalInput(new Date(ev.start)), end: ev.allDay ? ev.end.slice(0, 10) : toLocalInput(new Date(ev.end)), readOnly: ev.readOnly, event: ev }); }
  async deleteEvent(ev: CalendarEvent) { this.popover.set(null); if (!await this.dialogs.confirm(this.translate.instant('APP.CALENDAR.DELETE_CONFIRM', { title: ev.title }), this.translate.instant('APP.COMMON.DELETE'), true)) return; try { await this.bridge.invoke('calendar:deleteEvent', ev.id); this.editing.set(null); await this.load(); } catch (err) { this.toast.error(err); } }
  onSaved() { this.editing.set(null); this.load(); }
  startRename(c: Calendar) { this.renaming.set(c.id); setTimeout(() => { const el = document.querySelector<HTMLInputElement>('.cal-rename'); el?.focus(); el?.select(); }); }
  async finishRename(c: Calendar, value: string, save: boolean) { if (this.renaming() !== c.id) return; this.renaming.set(null); const name = value.trim(); if (!save || !name || name === c.name) return; try { this.store.calendars.set(await this.bridge.invoke('calendar:update', c.id, { name })); } catch (err) { this.toast.error(err); } }
  canDrag = (e: CalendarEvent) => !e.readOnly && !this.isAllDayLike(e) && sameDay(new Date(e.start), new Date(new Date(e.end).getTime() - 1)) && !!this.writable().find(c => c.id === e.calendarId);
  private columns() { return Array.from(document.querySelectorAll<HTMLElement>('.grid-body .day-col')).map(el => el.getBoundingClientRect()); }
  private minuteAt(rect: DOMRect, y: number) { return (y - rect.top) / HOUR_PX * 60; }
  startDrag(e: PointerEvent, p: Placed, mode: DragMode) { if (e.button !== 0 || !this.canDrag(p.event)) return; e.stopPropagation(); const cols = this.columns(); const day = this.days().findIndex(d => sameDay(d, p.start)); if (day < 0 || !cols[day]) return; const start = new Date(p.event.start), end = new Date(p.event.end); const dayStart = startOfDay(start).getTime(); const startMin = (start.getTime() - dayStart) / 60000, endMin = (end.getTime() - dayStart) / 60000; e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); document.documentElement.classList.add(mode === 'move' ? 'ev-drag-move' : 'ev-drag-resize'); this.drag.set({ event: p.event, mode, pointerId: e.pointerId, x: e.clientX, y: e.clientY, grabOffset: this.minuteAt(cols[day], e.clientY) - (mode === 'end' ? endMin : startMin), moved: false, day, startMin, endMin }); }
  onDragMove(e: PointerEvent) { const d = this.drag(); if (!d || e.pointerId !== d.pointerId) return; if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return; const cols = this.columns(); const snap = (m: number) => Math.round(m / SNAP_MIN) * SNAP_MIN; const duration = (new Date(d.event.end).getTime() - new Date(d.event.start).getTime()) / 60000; if (d.mode === 'end') { const endMin = Math.max(d.startMin + SNAP_MIN, Math.min(24 * 60, snap(this.minuteAt(cols[d.day], e.clientY) - d.grabOffset))); this.drag.set({ ...d, moved: true, endMin }); return; } if (d.mode === 'start') { const startMin = Math.min(d.endMin - SNAP_MIN, Math.max(0, snap(this.minuteAt(cols[d.day], e.clientY) - d.grabOffset))); this.drag.set({ ...d, moved: true, startMin }); return; } let day = cols.findIndex(r => e.clientX >= r.left && e.clientX < r.right); if (day < 0) day = d.day; const startMin = Math.max(0, Math.min(24 * 60 - SNAP_MIN, snap(this.minuteAt(cols[day], e.clientY) - d.grabOffset))); this.drag.set({ ...d, moved: true, day, startMin, endMin: startMin + duration }); }
  async endDrag(e: PointerEvent) { const d = this.drag(); if (!d || e.pointerId !== d.pointerId) return; this.clearDragCursor(); this.drag.set(null); if (!d.moved) return; this.suppressClick = true; setTimeout(() => this.suppressClick = false, 0); const base = startOfDay(d.mode === 'move' ? this.days()[d.day] : new Date(d.event.start)); const start = new Date(base.getTime() + d.startMin * 60000); const end = new Date(base.getTime() + d.endMin * 60000); if (start.getTime() === new Date(d.event.start).getTime() && end.getTime() === new Date(d.event.end).getTime()) return; const ev = d.event; this.events.update(list => list.map(x => x.id === ev.id ? { ...x, start: start.toISOString(), end: end.toISOString() } : x)); try { await this.bridge.invoke('calendar:saveEvent', { id: ev.id, calendarId: ev.calendarId, title: ev.title, description: ev.description, location: ev.location, start: start.toISOString(), end: end.toISOString(), allDay: false }); } catch (err) { this.toast.error(err); } await this.load(); }
  cancelDrag() { this.clearDragCursor(); if (this.drag()) this.drag.set(null); }
  private clearDragCursor() { document.documentElement.classList.remove('ev-drag-move', 'ev-drag-resize'); }
  @HostListener('document:keydown.escape') onEscape() { this.cancelDrag(); }
  dragLabel = (d: DragState) => { const base = startOfDay(d.mode === 'move' ? this.days()[d.day] ?? new Date() : new Date(d.event.start)); return `${this.time(new Date(base.getTime() + d.startMin * 60000))} – ${this.time(new Date(base.getTime() + d.endMin * 60000))}`; };
}
export const parseLocalDate = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
