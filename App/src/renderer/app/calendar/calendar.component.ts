import { Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { addDays, contrast, dayKey, htmlToPlain, isoWeek, sameDay, startOfDay, startOfWeek, timeShort, toLocalInput } from '../core/format';
import { IconComponent } from '../shared/icon.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService, MenuItem } from '../shared/dialogs.service';
import { COLOR_PRESETS } from '../shared/color-picker/color-picker.component';
import { EventDialogComponent } from './event-dialog.component';
import { CalendarDialogComponent } from './calendar-dialog.component';
import { Calendar, CalendarEvent, CalendarLabels, EventInput } from '../../../shared/types';
/** a label row under a calendar in the sidebar; key '' is "no label" */
export interface LabelRow { key: string; name: string; color: string; }
export type View = 'day' | 'workweek' | 'week' | 'month';
export const HOUR_PX = 40;
/** Smallest drawn event. A 15-minute event is drawn a little taller than its slot so its title stays readable, but it is still laid out by its real time, so it never pushes the next event aside. */
const MIN_EVENT_PX = 13;
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
  private router = inject(Router);
  private translate = inject(TranslateService);
  readonly view = signal<View>('week');
  readonly cursor = signal<Date>(startOfDay(new Date()));
  readonly miniMonth = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  private readonly rawEvents = signal<CalendarEvent[]>([]);
  /** events with the current label colours, so changing a label's colour recolours the agenda right away */
  readonly events = computed(() => { const colors = new Map(this.store.categories().map(c => [c.name.trim().toLowerCase(), c.color])); return this.rawEvents().map(ev => { if (!ev.categories.length) return ev; let changed = false; const categories = ev.categories.map(c => { const color = colors.get(c.name.trim().toLowerCase()); if (!color || color === c.color) return c; changed = true; return { ...c, color }; }); return changed ? { ...ev, categories, color: categories[0].color } : ev; }).filter(ev => this.labelVisible(ev)); });
  readonly loading = signal(false);
  /** labels per calendar, for the label filter in the sidebar */
  readonly calendarLabels = signal<Map<number, CalendarLabels>>(new Map());
  /** calendars whose labels are unfolded in the sidebar */
  readonly expanded = signal<Set<number>>(new Set());
  readonly hiddenLabels = computed(() => this.store.settings().calendarHiddenLabels ?? {});
  readonly labelRows = computed(() => { const colors = new Map(this.store.categories().map(c => [c.name.trim().toLowerCase(), c.color])); const out = new Map<number, LabelRow[]>(); for (const [id, info] of this.calendarLabels()) { const rows: LabelRow[] = info.labels.map(name => ({ key: name.toLowerCase(), name, color: colors.get(name.toLowerCase()) ?? this.calendarOf(id)?.color ?? '' })); if (info.unlabeled && rows.length) rows.push({ key: '', name: this.translate.instant('APP.CALENDAR.NO_LABEL'), color: this.calendarOf(id)?.color ?? '' }); if (rows.length) out.set(id, rows); } return out; });
  readonly now = signal(new Date());
  readonly editing = signal<Partial<EventInput> & { readOnly?: boolean; event?: CalendarEvent } | null>(null);
  readonly addingCalendar = signal(false);
  /** calendar open in the edit window */
  readonly editingCalendar = signal<Calendar | null>(null);
  readonly popover = signal<{ event: CalendarEvent; x: number; y: number } | null>(null);
  /** clicked event (Ctrl+C / Ctrl+X / Delete act on it) */
  readonly selectedId = signal<number | null>(null);
  /** event on the clipboard; 'cut' moves it on paste */
  readonly clip = signal<{ event: CalendarEvent; mode: 'copy' | 'cut' } | null>(null);
  /** slot under the mouse: where Ctrl+V pastes */
  private hoverSlot: { day: Date; minutes: number | null } | null = null;
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
  readonly writable = computed(() => this.store.calendars().filter(c => !c.readOnly && c.source !== 'ics' && c.source !== 'birthdays' && c.source !== 'holidays'));
  readonly allDayByDay = computed(() => { const days = this.days(); const list = this.events().filter(e => this.isAllDayLike(e)); const rows: AllDayPlaced[] = []; const occupancy: boolean[][] = []; for (const e of list.sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))) { const s = this.eventStart(e), en = this.eventEnd(e); let col = days.findIndex(d => addDays(d, 1) > s); if (col < 0) continue; let endCol = days.findIndex(d => d >= en); if (endCol < 0) endCol = days.length; const span = Math.max(1, endCol - col); let row = 0; while (occupancy[row]?.slice(col, col + span).some(Boolean)) row++; occupancy[row] = occupancy[row] ?? []; for (let i = col; i < col + span; i++) occupancy[row][i] = true; rows.push({ event: e, col, span, row }); } return { items: rows, rows: occupancy.length }; });
  readonly timedByDay = computed<Placed[][]>(() => this.days().map(day => this.layout(day, this.events().filter(e => !this.isAllDayLike(e)))));
  readonly monthCells = computed(() => this.days().map(day => { const next = addDays(day, 1); const items = this.events().filter(e => this.eventStart(e) < next && this.eventEnd(e) > day).sort((a, b) => Number(this.isAllDayLike(b)) - Number(this.isAllDayLike(a)) || a.start.localeCompare(b.start)); return { day, items, inMonth: day.getMonth() === this.cursor().getMonth(), today: sameDay(day, this.now()) }; }));
  readonly miniDays = computed(() => { const m = this.miniMonth(); const start = startOfWeek(new Date(m.getFullYear(), m.getMonth(), 1), this.weekStart()); const out: { date: Date; inMonth: boolean; today: boolean; selected: boolean; week: number }[] = []; const { start: rs, end: re } = this.range(); for (let i = 0; i < 42; i++) { const d = addDays(start, i); out.push({ date: d, inMonth: d.getMonth() === m.getMonth(), today: sameDay(d, this.now()), selected: d >= rs && d < re, week: isoWeek(d) }); } return out; });
  readonly weekdayNames = computed(() => { const loc = this.store.locale(); const start = startOfWeek(new Date(2024, 0, 1), this.weekStart()); return Array.from({ length: 7 }, (_, i) => addDays(start, i).toLocaleDateString(loc, { weekday: 'short' })); });
  readonly nowTop = computed(() => (this.now().getHours() * 60 + this.now().getMinutes()) / 60 * HOUR_PX);
  constructor() { this.load(); this.loadLabels(); this.offs.push(this.bridge.on('calendar:changed', () => { this.load(); this.loadLabels(); })); this.tick = setInterval(() => this.now.set(new Date()), 60_000); }
  ngOnDestroy() { this.offs.forEach(f => f()); clearInterval(this.tick); this.clearDragCursor(); }
  plain = htmlToPlain;
  /** only real all-day events go to the row at the top; timed events stay in the time grid, also when they run over several days */
  isAllDayLike = (e: CalendarEvent) => e.allDay;
  /** 15:00 – 17:00, or 15:00 – di 17:00 when the event ends on another day */
  rangeLabel(e: CalendarEvent) { const s = new Date(e.start), en = new Date(e.end); const day = (d: Date) => d.toLocaleDateString(this.store.locale(), { weekday: 'short' }); return sameDay(s, new Date(en.getTime() - 1)) ? `${this.time(s)} – ${this.time(en)}` : `${day(s)} ${this.time(s)} – ${day(en)} ${this.time(en)}`; }
  eventStart = (e: CalendarEvent) => e.allDay ? parseLocalDate(e.start) : new Date(e.start);
  eventEnd = (e: CalendarEvent) => e.allDay ? parseLocalDate(e.end) : new Date(e.end);
  time = (d: Date) => timeShort(d, this.store.locale());
  textColor = contrast;
  dayLabel = (d: Date) => d.toLocaleDateString(this.store.locale(), { weekday: 'short' });
  isToday = (d: Date) => sameDay(d, this.now());
  hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
  eventTime = (e: CalendarEvent) => { if (e.allDay) { const s = parseLocalDate(e.start), en = addDays(parseLocalDate(e.end), -1); return sameDay(s, en) ? s.toLocaleDateString(this.store.locale(), { weekday: 'long', day: 'numeric', month: 'long' }) : `${s.toLocaleDateString(this.store.locale(), { day: 'numeric', month: 'short' })} – ${en.toLocaleDateString(this.store.locale(), { day: 'numeric', month: 'short' })}`; } const s = new Date(e.start), en = new Date(e.end); return `${s.toLocaleDateString(this.store.locale(), { weekday: 'long', day: 'numeric', month: 'long' })} · ${this.time(s)} – ${sameDay(s, en) ? '' : en.toLocaleDateString(this.store.locale(), { day: 'numeric', month: 'short' }) + ' '}${this.time(en)}`; };
  calendarOf = (id: number) => this.store.calendars().find(c => c.id === id) ?? null;
  private layout(day: Date, list: CalendarEvent[]): Placed[] { const dayStart = startOfDay(day), dayEnd = addDays(dayStart, 1); const items = list.filter(e => new Date(e.start) < dayEnd && new Date(e.end) > dayStart).map(e => { const s = new Date(Math.max(new Date(e.start).getTime(), dayStart.getTime())); const en = new Date(Math.min(new Date(e.end).getTime(), dayEnd.getTime())); const visualEnd = new Date(Math.max(en.getTime(), s.getTime() + (MIN_EVENT_PX - 4) / HOUR_PX * 3600000)); return { event: e, start: s, end: en, visualEnd, top: (s.getTime() - dayStart.getTime()) / 3600000 * HOUR_PX, height: Math.max(MIN_EVENT_PX, (en.getTime() - s.getTime()) / 3600000 * HOUR_PX - 1), left: 0, width: 100, col: 0, cols: 1 }; }).sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime()); const columns: typeof items[] = []; let clusterEnd = 0; let cluster: typeof items = []; const finish = () => { for (const it of cluster) { it.cols = columns.length; it.width = 100 / columns.length; it.left = it.col * it.width; } columns.length = 0; cluster = []; }; for (const it of items) { if (cluster.length && it.start.getTime() >= clusterEnd) finish(); let placed = false; for (let c = 0; c < columns.length; c++) { if (columns[c].every(o => o.visualEnd.getTime() <= it.start.getTime() || o.start.getTime() >= it.visualEnd.getTime())) { columns[c].push(it); it.col = c; placed = true; break; } } if (!placed) { it.col = columns.length; columns.push([it]); } cluster.push(it); clusterEnd = Math.max(clusterEnd, it.visualEnd.getTime()); } finish(); return items; }
  async load() { const { start, end } = this.range(); this.loading.set(true); try { this.rawEvents.set(await this.bridge.invoke('calendar:events', start.toISOString(), end.toISOString())); } catch (err) { this.toast.error(err); } finally { this.loading.set(false); } }
  loadLabels() { this.bridge.invoke('calendar:labels').then(list => this.calendarLabels.set(new Map(list.map(l => [l.calendarId, l])))).catch(() => {}); }
  /** an event stays visible while at least one of its labels (or "no label") is switched on for its calendar */
  private labelVisible(ev: CalendarEvent) { const hidden = this.hiddenLabels()[ev.calendarId]; if (!hidden?.length) return true; const keys = ev.categories.length ? ev.categories.map(c => c.name.trim().toLowerCase()) : ['']; return keys.some(k => !hidden.includes(k)); }
  labelOn(c: Calendar, key: string) { return !this.hiddenLabels()[c.id]?.includes(key); }
  filtered(c: Calendar) { return !!this.hiddenLabels()[c.id]?.length; }
  /** clicking a calendar unfolds its labels; a calendar without labels still shows/hides on click */
  calendarClick(c: Calendar) { if (this.labelRows().has(c.id)) this.toggleExpand(c); else this.toggleCalendar(c); }
  toggleExpand(c: Calendar) { this.expanded.update(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; }); }
  toggleLabel(c: Calendar, key: string) { const cur = this.hiddenLabels()[c.id] ?? []; this.setHidden(c, cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]); }
  onlyLabel(c: Calendar, key: string) { this.setHidden(c, (this.labelRows().get(c.id) ?? []).map(r => r.key).filter(k => k !== key)); }
  showAllLabels(c: Calendar) { this.setHidden(c, []); }
  private setHidden(c: Calendar, keys: string[]) { const next = { ...this.hiddenLabels() }; if (keys.length) next[c.id] = keys; else delete next[c.id]; this.store.saveSettings({ calendarHiddenLabels: next }).catch(err => this.toast.error(err)); }
  labelMenu(e: MouseEvent, c: Calendar, row: LabelRow) { const t = (k: string) => this.translate.instant(k); this.dialogs.openMenu(e, [{ label: t('APP.CALENDAR.ONLY_THIS_LABEL'), icon: 'eye', action: () => this.onlyLabel(c, row.key) }, { label: t('APP.CALENDAR.SHOW_ALL_LABELS'), icon: 'tag', disabled: !this.filtered(c), action: () => this.showAllLabels(c) }]); }
  setView(v: View) { this.view.set(v); this.load(); }
  go(n: number) { const v = this.view(); const c = this.cursor(); const next = v === 'month' ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, n * (v === 'day' ? 1 : 7)); this.cursor.set(next); this.miniMonth.set(new Date(next.getFullYear(), next.getMonth(), 1)); this.load(); }
  today() { const t = startOfDay(new Date()); this.cursor.set(t); this.miniMonth.set(new Date(t.getFullYear(), t.getMonth(), 1)); this.load(); }
  pickDay(d: Date) { this.cursor.set(startOfDay(d)); if (this.view() === 'month' && d.getMonth() !== this.miniMonth().getMonth()) this.miniMonth.set(new Date(d.getFullYear(), d.getMonth(), 1)); this.load(); }
  openDay(d: Date) { this.cursor.set(startOfDay(d)); this.view.set('day'); this.load(); }
  miniGo(n: number) { const m = this.miniMonth(); this.miniMonth.set(new Date(m.getFullYear(), m.getMonth() + n, 1)); }
  async toggleCalendar(c: Calendar) { try { this.store.calendars.set(await this.bridge.invoke('calendar:update', c.id, { visible: !c.visible })); this.load(); } catch (err) { this.toast.error(err); } }
  async syncAll() { this.loading.set(true); try { this.store.calendars.set(await this.bridge.invoke('calendar:sync', null)); await this.load(); } catch (err) { this.toast.error(err); } finally { this.loading.set(false); } }
  /** show only one calendar (whatever the provider) */
  async showOnly(c: Calendar) { for (const x of this.store.calendars()) if (x.visible !== (x.id === c.id)) this.store.calendars.set(await this.bridge.invoke('calendar:update', x.id, { visible: x.id === c.id })); this.load(); }
  async showAll() { for (const x of this.store.calendars()) if (!x.visible) this.store.calendars.set(await this.bridge.invoke('calendar:update', x.id, { visible: true })); this.load(); }
  /** copy or move every event of one calendar to another one */
  async transfer(from: Calendar, to: Calendar, mode: 'copy' | 'move') {
    const t = (k: string, p?: any) => this.translate.instant(k, p);
    if (!await this.dialogs.confirm(t(mode === 'move' ? 'APP.CALENDAR.MOVE_CONFIRM' : 'APP.CALENDAR.COPY_CONFIRM', { from: from.name, to: to.name }), t(mode === 'move' ? 'APP.CALENDAR.MOVE_START' : 'APP.CALENDAR.COPY_START'), mode === 'move')) return;
    this.toast.show(t('APP.CALENDAR.TRANSFER_BUSY', { from: from.name, to: to.name }), 'info');
    try {
      const r = await this.bridge.invoke('calendar:transfer', from.id, to.id, mode);
      const key = mode === 'move' ? (r.movedAll ? 'APP.CALENDAR.MOVE_DONE' : 'APP.CALENDAR.MOVE_PARTIAL') : 'APP.CALENDAR.COPY_ALL_DONE';
      this.toast.show(t(key, { copied: r.copied, total: r.total, failed: r.failed, deleted: r.deleted, skipped: r.skipped, labelled: r.labelled }), r.failed ? 'error' : 'success');
      if (r.errors.length) console.warn('calendar transfer', r.errors);
      this.store.calendars.set(await this.bridge.invoke('calendar:list')); await this.load();
    } catch (err) { this.toast.error(err); }
  }
  /** put the labels of one calendar's events onto the same events in another one (e.g. after an earlier copy) */
  async copyLabels(from: Calendar, to: Calendar) {
    const t = (k: string, p?: any) => this.translate.instant(k, p);
    if (!await this.dialogs.confirm(t('APP.CALENDAR.LABELS_CONFIRM', { from: from.name, to: to.name }), t('APP.CALENDAR.LABELS_START'))) return;
    this.toast.show(t('APP.CALENDAR.LABELS_BUSY', { from: from.name, to: to.name }), 'info');
    try {
      const r = await this.bridge.invoke('calendar:copyLabels', from.id, to.id);
      this.toast.show(t('APP.CALENDAR.LABELS_DONE', { updated: r.updated, unmatched: r.unmatched, to: to.name }), r.failed ? 'error' : 'success');
      if (r.errors.length) console.warn('calendar labels', r.errors);
      await this.load();
    } catch (err) { this.toast.error(err); }
  }
  calendarMenu(e: MouseEvent, c: Calendar) { const t = (k: string, p?: any) => this.translate.instant(k, p); const items: MenuItem[] = [{ label: t('APP.CALENDAR.REFRESH'), icon: 'refresh', action: () => this.bridge.invoke('calendar:sync', c.id).then(list => { this.store.calendars.set(list); this.load(); }).catch(err => this.toast.error(err)) }, { label: t('APP.COMMON.EDIT'), icon: 'edit', action: () => this.editingCalendar.set(c) }]; const others = this.writable().filter(w => w.id !== c.id); const label = (w: Calendar) => w.group ? `${w.name} · ${w.group}` : w.name; items.push({ separator: true }, { label: t('APP.CALENDAR.ONLY_THIS'), icon: 'eye', action: () => this.showOnly(c) }, { label: t('APP.CALENDAR.SHOW_ALL'), icon: 'calendar', action: () => this.showAll() }); if (this.filtered(c)) items.push({ label: t('APP.CALENDAR.SHOW_ALL_LABELS'), icon: 'tag', action: () => this.showAllLabels(c) }); if (others.length && c.source !== 'birthdays' && c.source !== 'holidays') { items.push({ separator: true }, { label: t('APP.CALENDAR.COPY_ALL_TO'), icon: 'copy', children: others.map(w => ({ label: label(w), action: () => this.transfer(c, w, 'copy') })) }); if (!c.readOnly && ['google', 'microsoft', 'caldav', 'local'].includes(c.source)) items.push({ label: t('APP.CALENDAR.MOVE_ALL_TO'), icon: 'move', children: others.map(w => ({ label: label(w), action: () => this.transfer(c, w, 'move') })) }); items.push({ label: t('APP.CALENDAR.COPY_LABELS_TO'), icon: 'tag', children: others.map(w => ({ label: label(w), action: () => this.copyLabels(c, w) })) }); } if (c.source !== 'birthdays' && c.source !== 'holidays' && !(c.source === 'google' || c.source === 'microsoft')) items.push({ separator: true }, { label: t('APP.COMMON.REMOVE'), icon: 'trash', danger: true, action: async () => { if (await this.dialogs.confirm(t('APP.CALENDAR.REMOVE_CONFIRM', { name: c.name }), t('APP.COMMON.REMOVE'), true)) { this.store.calendars.set(await this.bridge.invoke('calendar:remove', c.id)); this.load(); } } }); this.dialogs.openMenu(e, items); }
  newEvent(start?: Date, allDay = false, minutes = 60) { const cal = this.writable()[0]; if (!cal) { this.toast.show(this.translate.instant('APP.CALENDAR.NO_WRITABLE'), 'error'); return; } const s = start ?? this.roundNow(); const en = new Date(s.getTime() + minutes * 60 * 1000); this.editing.set({ calendarId: cal.id, title: '', description: '', location: '', allDay, start: allDay ? dayKey(s) : toLocalInput(s), end: allDay ? dayKey(addDays(s, 1)) : toLocalInput(en) }); }
  private roundNow() { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); return d; }
  hoverTime(day: Date, e: MouseEvent) { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); this.hoverSlot = { day, minutes: Math.max(0, Math.min(24 * 60 - 15, Math.floor((e.clientY - rect.top) / HOUR_PX * 60 / 15) * 15)) }; }
  hoverDay(day: Date) { this.hoverSlot = { day, minutes: null }; }
  leaveGrid() { this.hoverSlot = null; }
  @HostListener('document:keydown', ['$event']) onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (this.editing() || this.drag() || document.querySelector('.overlay, app-lock-screen') || (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) return;
    const sel = this.events().find(x => x.id === this.selectedId()) ?? null;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'x') && sel) {
      e.preventDefault();
      if (k === 'x' && (sel.readOnly || !this.writable().some(c => c.id === sel.calendarId))) { this.toast.show(this.translate.instant('APP.CALENDAR.CANNOT_MOVE'), 'error'); return; }
      this.clip.set({ event: sel, mode: k === 'x' ? 'cut' : 'copy' });
      this.toast.show(this.translate.instant(k === 'x' ? 'APP.CALENDAR.CUT_DONE' : 'APP.CALENDAR.COPY_DONE'), 'info');
    }
    else if ((e.ctrlKey || e.metaKey) && k === 'v' && this.clip()) { e.preventDefault(); this.paste(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !sel.readOnly && !e.ctrlKey) { e.preventDefault(); this.deleteEvent(sel); }
    else if (e.key === 'Enter' && this.selectedSlot() && !sel) { e.preventDefault(); const sl = this.selectedSlot()!; const s = new Date(sl.day); s.setHours(0, sl.minutes, 0, 0); this.newEvent(s, false, 30); }
    else if (e.key === 'Escape') { this.selectedId.set(null); this.selectedSlot.set(null); if (this.clip()?.mode === 'cut') this.clip.set(null); }
  }
  /** pastes the clipboard event at the slot under the mouse, keeping its length (a cut event is moved there) */
  private async paste() {
    const c = this.clip(); const slot = this.selectedSlot() ?? this.hoverSlot;
    if (!c) return;
    if (!slot) { this.toast.show(this.translate.instant('APP.CALENDAR.PASTE_WHERE'), 'info'); return; }
    const ev = c.event, oldStart = new Date(ev.start), length = new Date(ev.end).getTime() - oldStart.getTime();
    const start = new Date(slot.day);
    if (ev.allDay) start.setHours(0, 0, 0, 0); else if (slot.minutes === null) start.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0); else start.setHours(0, slot.minutes, 0, 0);
    const end = new Date(start.getTime() + length);
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const times = ev.allDay ? { start: day(start), end: day(end) } : { start: start.toISOString(), end: end.toISOString() };
    const calendarId = this.writable().some(w => w.id === ev.calendarId) ? ev.calendarId : this.writable()[0]?.id;
    if (!calendarId) { this.toast.show(this.translate.instant('APP.CALENDAR.NO_WRITABLE'), 'error'); return; }
    try {
      if (c.mode === 'cut') { await this.bridge.invoke('calendar:saveEvent', { id: ev.id, calendarId: ev.calendarId, title: ev.title, description: ev.description, location: ev.location, allDay: ev.allDay, ...times }); this.clip.set(null); }
      else {
        const created = await this.bridge.invoke('calendar:saveEvent', { calendarId, title: ev.title, description: ev.description, location: ev.location, allDay: ev.allDay, ...times });
        if (ev.categories.length) await this.bridge.invoke('calendar:setCategories', created.id, ev.categories.map(x => x.name)).catch(() => {});
        this.selectedId.set(created.id);
      }
    } catch (err) { this.toast.error(err); }
    await this.load();
  }
  /** clicked half hour: one click selects it, a double click creates a 30-minute event there */
  readonly selectedSlot = signal<{ day: Date; minutes: number } | null>(null);
  private slotAt(day: Date, e: MouseEvent) { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { day, minutes: Math.max(0, Math.min(23 * 60 + 30, Math.floor((e.clientY - rect.top) / HOUR_PX * 60 / 30) * 30)) }; }
  slotClick(day: Date, e: MouseEvent) { this.selectedId.set(null); if (this.suppressClick || this.drag() || (e.target as HTMLElement).closest('.ev')) return; this.selectedSlot.set(this.slotAt(day, e)); }
  /** double click in the row at the top: an all-day event on that day */
  allDayDblClick(e: MouseEvent) { if ((e.target as HTMLElement).closest('.ev')) return; const box = (e.currentTarget as HTMLElement).getBoundingClientRect(); const n = this.days().length; const i = Math.floor((e.clientX - box.left - 56) / ((box.width - 56) / n)); const day = this.days()[i]; if (day) this.newEvent(new Date(day), true); }
  slotDblClick(day: Date, e: MouseEvent) { if (this.drag() || (e.target as HTMLElement).closest('.ev')) return; const slot = this.slotAt(day, e); this.selectedSlot.set(slot); const s = new Date(day); s.setHours(0, slot.minutes, 0, 0); this.newEvent(s, false, 30); }
  isSelectedSlot = (day: Date) => { const s = this.selectedSlot(); return !!s && sameDay(s.day, day); };
  showEvent(ev: CalendarEvent, e: MouseEvent) { e.stopPropagation(); if (this.suppressClick) { this.suppressClick = false; return; } this.popover.set(null); this.selectedId.set(ev.id); this.selectedSlot.set(null); }
  /** double click: open the event (edit, or details when it is read-only) */
  /** a birthday comes from a contact: its id is in the uid (birthday-<contact>-<year>) */
  birthdayContact(ev: CalendarEvent) { if (this.calendarOf(ev.calendarId)?.source !== 'birthdays') return null; const m = /^birthday-(\d+)-/.exec(ev.uid); return m ? Number(m[1]) : null; }
  openContact(id: number) { this.router.navigate(['/people'], { queryParams: { contact: id } }); }
  /** double click: open the event; a birthday opens the contact it comes from */
  openEvent(ev: CalendarEvent, e: MouseEvent) { e.stopPropagation(); this.selectedId.set(ev.id); const contact = this.birthdayContact(ev); if (contact) { this.openContact(contact); return; } if (this.calendarOf(ev.calendarId)?.source === 'birthdays') return; this.editEvent(ev); }
  editEvent(ev: CalendarEvent) { this.popover.set(null); this.editing.set({ id: ev.id, calendarId: ev.calendarId, title: ev.title, description: ev.description, location: ev.location, allDay: ev.allDay, start: ev.allDay ? ev.start.slice(0, 10) : toLocalInput(new Date(ev.start)), end: ev.allDay ? ev.end.slice(0, 10) : toLocalInput(new Date(ev.end)), readOnly: ev.readOnly, event: ev }); }
  /** Right-click on an event: pick categories (their colour colours the event), open, edit or delete it. */
  eventMenu(e: MouseEvent, ev: CalendarEvent) { e.preventDefault(); e.stopPropagation(); this.popover.set(null); this.selectedId.set(ev.id); const contact = this.birthdayContact(ev); if (contact) { this.dialogs.openMenu(e, [{ label: this.translate.instant('APP.CALENDAR.OPEN_CONTACT'), icon: 'user', action: () => this.openContact(contact) }]); return; } const t = (k: string) => this.translate.instant(k); const has = (name: string) => ev.categories.some(c => c.name.trim().toLowerCase() === name.trim().toLowerCase()); const items: MenuItem[] = this.store.categories().map(c => ({ label: c.name, color: c.color, checked: has(c.name), action: () => this.toggleEventCategory(ev, c.name) })); if (ev.categories.length) items.push({ label: t('APP.CALENDAR.CLEAR_CATEGORIES'), icon: 'close', action: () => this.setEventCategories(ev, []) }); items.push({ label: t('APP.MAIL.MANAGE_CATEGORIES'), icon: 'tag', action: () => this.router.navigate(['/settings'], { queryParams: { tab: 'categories' } }) }, { separator: true }, { label: t(ev.readOnly ? 'APP.COMMON.DETAILS' : 'APP.COMMON.EDIT'), icon: ev.readOnly ? 'eye' : 'edit', action: () => this.editEvent(ev) }); if (!ev.readOnly) items.push({ label: t('APP.COMMON.DELETE'), icon: 'trash', danger: true, action: () => this.deleteEvent(ev) }); this.dialogs.openMenu(e, items); }
  private toggleEventCategory(ev: CalendarEvent, name: string) { const lower = name.trim().toLowerCase(); const names = ev.categories.map(c => c.name); this.setEventCategories(ev, names.some(n => n.trim().toLowerCase() === lower) ? names.filter(n => n.trim().toLowerCase() !== lower) : [...names, name]); }
  private async setEventCategories(ev: CalendarEvent, names: string[]) { const colors = new Map(this.store.categories().map(c => [c.name.trim().toLowerCase(), c.color])); const categories = names.map(n => ({ name: n, color: colors.get(n.trim().toLowerCase()) ?? ev.color })); const same = (x: CalendarEvent) => x.id === ev.id || (x.calendarId === ev.calendarId && x.uid === ev.uid); this.rawEvents.update(list => list.map(x => same(x) ? { ...x, categories, color: categories[0]?.color ?? this.calendarOf(x.calendarId)?.color ?? x.color } : x)); try { await this.bridge.invoke('calendar:setCategories', ev.id, names); } catch (err) { this.toast.error(err); } await this.load(); this.loadLabels(); }
  async deleteEvent(ev: CalendarEvent) { this.popover.set(null); if (!await this.dialogs.confirm(this.translate.instant('APP.CALENDAR.DELETE_CONFIRM', { title: ev.title }), this.translate.instant('APP.COMMON.DELETE'), true)) return; try { await this.bridge.invoke('calendar:deleteEvent', ev.id); this.editing.set(null); await this.load(); } catch (err) { this.toast.error(err); } }
  onSaved() { this.editing.set(null); this.load(); }
  startRename(c: Calendar) { this.renaming.set(c.id); setTimeout(() => { const el = document.querySelector<HTMLInputElement>('.cal-rename'); el?.focus(); el?.select(); }); }
  async finishRename(c: Calendar, value: string, save: boolean) { if (this.renaming() !== c.id) return; this.renaming.set(null); const name = value.trim(); if (!save || !name || name === c.name) return; try { this.store.calendars.set(await this.bridge.invoke('calendar:update', c.id, { name })); } catch (err) { this.toast.error(err); } }
  canDrag = (e: CalendarEvent) => !e.readOnly && !this.isAllDayLike(e) && !!this.writable().find(c => c.id === e.calendarId);
  private columns() { return Array.from(document.querySelectorAll<HTMLElement>('.grid-body .day-col')).map(el => el.getBoundingClientRect()); }
  private minuteAt(rect: DOMRect, y: number) { return (y - rect.top) / HOUR_PX * 60; }
  startDrag(e: PointerEvent, p: Placed, mode: DragMode) { if (e.button !== 0 || !this.canDrag(p.event)) return; e.stopPropagation(); const cols = this.columns(); const day = this.days().findIndex(d => sameDay(d, p.start)); if (day < 0 || !cols[day]) return; const start = new Date(p.event.start), end = new Date(p.event.end); const dayStart = startOfDay(this.days()[day]).getTime(); const startMin = (start.getTime() - dayStart) / 60000, endMin = (end.getTime() - dayStart) / 60000; e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); document.documentElement.classList.add(mode === 'move' ? 'ev-drag-move' : 'ev-drag-resize'); this.drag.set({ event: p.event, mode, pointerId: e.pointerId, x: e.clientX, y: e.clientY, grabOffset: this.minuteAt(cols[day], e.clientY) - (mode === 'end' ? endMin : startMin), moved: false, day, startMin, endMin }); }
  onDragMove(e: PointerEvent) { const d = this.drag(); if (!d || e.pointerId !== d.pointerId) return; if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return; const cols = this.columns(); const snap = (m: number) => Math.round(m / SNAP_MIN) * SNAP_MIN; const duration = (new Date(d.event.end).getTime() - new Date(d.event.start).getTime()) / 60000; const colAt = () => { const i = cols.findIndex(r => e.clientX >= r.left && e.clientX < r.right); return i < 0 ? (e.clientX < (cols[0]?.left ?? 0) ? 0 : cols.length - 1) : i; }; if (d.mode === 'end') { const c = colAt(); const endMin = Math.max(d.startMin + SNAP_MIN, snap((c - d.day) * 24 * 60 + Math.min(24 * 60, this.minuteAt(cols[c], e.clientY) - d.grabOffset))); this.drag.set({ ...d, moved: true, endMin }); return; } if (d.mode === 'start') { const c = colAt(); const startMin = Math.min(d.endMin - SNAP_MIN, snap((c - d.day) * 24 * 60 + Math.max(0, this.minuteAt(cols[c], e.clientY) - d.grabOffset))); this.drag.set({ ...d, moved: true, startMin }); return; } let day = cols.findIndex(r => e.clientX >= r.left && e.clientX < r.right); if (day < 0) day = d.day; const startMin = Math.max(-duration + SNAP_MIN, Math.min(24 * 60 - SNAP_MIN, snap(this.minuteAt(cols[day], e.clientY) - d.grabOffset))); this.drag.set({ ...d, moved: true, day, startMin, endMin: startMin + duration }); }
  async endDrag(e: PointerEvent) { const d = this.drag(); if (!d || e.pointerId !== d.pointerId) return; this.clearDragCursor(); this.drag.set(null); if (!d.moved) return; this.suppressClick = true; setTimeout(() => this.suppressClick = false, 0); const base = startOfDay(this.days()[d.day]); const start = new Date(base.getTime() + d.startMin * 60000); const end = new Date(base.getTime() + d.endMin * 60000); if (start.getTime() === new Date(d.event.start).getTime() && end.getTime() === new Date(d.event.end).getTime()) return; const ev = d.event; this.rawEvents.update(list => list.map(x => x.id === ev.id ? { ...x, start: start.toISOString(), end: end.toISOString() } : x)); try { await this.bridge.invoke('calendar:saveEvent', { id: ev.id, calendarId: ev.calendarId, title: ev.title, description: ev.description, location: ev.location, start: start.toISOString(), end: end.toISOString(), allDay: false }); } catch (err) { this.toast.error(err); } await this.load(); }
  cancelDrag() { this.clearDragCursor(); if (this.drag()) this.drag.set(null); }
  private clearDragCursor() { document.documentElement.classList.remove('ev-drag-move', 'ev-drag-resize'); }
  @HostListener('document:keydown.escape') onEscape() { this.cancelDrag(); }
  dragLabel = (d: DragState) => { const base = startOfDay(this.days()[d.day] ?? new Date()); const s = new Date(base.getTime() + d.startMin * 60000), en = new Date(base.getTime() + d.endMin * 60000); return sameDay(s, en) ? `${this.time(s)} – ${this.time(en)}` : `${this.time(s)} – ${en.toLocaleDateString(this.store.locale(), { weekday: 'short' })} ${this.time(en)}`; };
  /** the part of the dragged event that falls in day column di */
  ghostIn(d: DragState, di: number) { const off = (di - d.day) * 24 * 60; const from = Math.max(0, d.startMin - off), to = Math.min(24 * 60, d.endMin - off); return to > from ? { top: from / 60 * HOUR_PX, height: Math.max(16, (to - from) / 60 * HOUR_PX - 2), first: d.startMin - off >= 0 } : null; }
}
export const parseLocalDate = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
