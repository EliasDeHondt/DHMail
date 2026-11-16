/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 29/10/2026
**/

import { Component, ElementRef, HostListener, Input, OnDestroy, OnInit, forwardRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

export type DatePickerMode = 'date' | 'month' | 'datetime';
type CalendarView = 'days' | 'months' | 'years';

interface CalendarDay {
    iso: string;
    day: number;
    inMonth: boolean;
    today: boolean;
    selected: boolean;
    label: string;
}

interface CalendarMonth {
    index: number;
    label: string;
    current: boolean;
    selected: boolean;
}

interface CalendarYear {
    year: number;
    current: boolean;
    selected: boolean;
}

const LOCALES: Record<string, string> = { nl: 'nl-BE', en: 'en-GB', fr: 'fr-BE', de: 'de-DE', es: 'es-ES' };
const DEFAULT_LOCALE = 'nl-BE';
const WEEKS_SHOWN = 6;
const DAYS_IN_WEEK = 7;
const YEARS_PER_PAGE = 12;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const SHEET_QUERY = '(max-width: 640px)';
const PLACEMENT_MARGIN = 16;
const DIALOG_WIDTH = 296;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function toIso(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromIso(iso: string): Date | null {
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1), 12);
    return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

function addMonths(date: Date, months: number): Date {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
}

function clampYear(year: number): number {
    return Math.min(MAX_YEAR, Math.max(MIN_YEAR, year));
}

let nextId = 0;

@Component({
    selector: 'app-date-picker',
    templateUrl: './date-picker.component.html',
    styleUrls: ['./date-picker.component.css'],
    imports: [CommonModule, TranslatePipe],
    providers: [{
        provide: NG_VALUE_ACCESSOR,
        useExisting: forwardRef(() => DatePickerComponent),
        multi: true
    }],
    standalone: true
})
export class DatePickerComponent implements ControlValueAccessor, OnInit, OnDestroy {
    @Input() mode: DatePickerMode = 'date';
    @Input() inputId = '';
    @Input() placeholder = '';
    @Input() clearable = true;

    readonly dialogId = `date-picker-${nextId++}`;

    value = '';
    disabled = false;
    open = false;
    openAbove = false;
    ready = false;
    view: CalendarView = 'days';
    weeks: CalendarDay[][] = [];
    months: CalendarMonth[] = [];
    years: CalendarYear[] = [];
    weekdays: { short: string; long: string }[] = [];
    monthName = '';
    yearLabel = '';
    yearRangeLabel = '';
    displayValue = '';
    hours = 12;
    minutes = 0;
    position: { top: number | null; bottom: number | null; left: number } = { top: 0, bottom: null, left: 0 };

    private viewDate = new Date();
    private focusedDate = new Date();
    private yearPageStart = 0;
    private dialogEl: HTMLElement | null = null;
    private backdropEl: HTMLElement | null = null;
    private locale = DEFAULT_LOCALE;
    private host = inject<ElementRef<HTMLElement>>(ElementRef);
    private translate = inject(TranslateService);
    private langSubscription?: Subscription;
    private onChange: (value: string) => void = () => {};
    private onTouched: () => void = () => {};

    ngOnInit(): void {
        this.applyLocale();
        this.langSubscription = this.translate.onLangChange.subscribe(() => {
            this.applyLocale();
            if (this.open) this.render();
        });
    }

    ngOnDestroy(): void {
        this.langSubscription?.unsubscribe();
        this.detachScrollListener();
    }

    writeValue(value: string | null): void {
        this.value = value ?? '';
        this.syncTimeFromValue();
        this.updateDisplay();
    }

    registerOnChange(fn: (value: string) => void): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => void): void {
        this.onTouched = fn;
    }

    setDisabledState(disabled: boolean): void {
        this.disabled = disabled;
    }

    get hasValue(): boolean {
        return this.value !== '';
    }

    get triggerLabel(): string {
        return this.displayValue || this.placeholder || this.translate.instant(this.mode === 'month' ? 'APP.COMMON.DATE_PICKER.CHOOSE_MONTH' : 'APP.COMMON.DATE_PICKER.CHOOSE_DATE');
    }

    get hourOptions(): number[] {
        return Array.from({ length: 24 }, (_, i) => i);
    }

    get minuteOptions(): number[] {
        return Array.from({ length: 12 }, (_, i) => i * 5);
    }

    pad(value: number): string {
        return pad(value);
    }

    toggle(): void {
        if (this.disabled) return;
        if (this.open) {
            this.close();
            return;
        }
        const start = fromIso(this.value) ?? new Date();
        this.focusedDate = start;
        this.viewDate = start;
        this.view = this.mode === 'month' ? 'months' : 'days';
        this.openAbove = false;
        this.open = true;
        this.render();
        this.attachScrollListener();
        setTimeout(() => {
            this.moveToBody();
            this.updatePlacement();
            this.ready = true;
            this.focusCurrent();
        });
    }

    close(restoreFocus = true): void {
        if (!this.open) return;
        this.open = false;
        this.ready = false;
        this.dialogEl = null;
        this.backdropEl = null;
        this.detachScrollListener();
        this.onTouched();
        if (restoreFocus) {
            this.host.nativeElement.querySelector<HTMLElement>('.date-picker-trigger')?.focus();
        }
    }

    @HostListener('window:resize')
    onResize(): void {
        if (this.open) this.updatePlacement();
    }

    previous(): void {
        if (this.view === 'days') this.moveMonth(-1);
        else if (this.view === 'months') this.moveYear(-1);
        else this.movePage(-1);
    }

    next(): void {
        if (this.view === 'days') this.moveMonth(1);
        else if (this.view === 'months') this.moveYear(1);
        else this.movePage(1);
    }

    showMonths(): void {
        this.view = this.view === 'months' && this.mode !== 'month' ? 'days' : 'months';
        this.render();
        this.focusCurrent();
    }

    showYears(): void {
        this.view = this.view === 'years' ? (this.mode === 'month' ? 'months' : 'days') : 'years';
        this.yearPageStart = this.pageStartFor(this.viewDate.getFullYear());
        this.render();
        this.focusCurrent();
    }

    pickYear(year: CalendarYear): void {
        this.viewDate = new Date(year.year, this.viewDate.getMonth(), 1, 12);
        this.focusedDate = this.viewDate;
        this.view = 'months';
        this.render();
        this.focusCurrent();
    }

    pickMonth(month: CalendarMonth): void {
        const year = this.viewDate.getFullYear();
        if (this.mode === 'month') {
            this.commit(`${year}-${pad(month.index + 1)}`);
            this.close();
            return;
        }
        this.viewDate = new Date(year, month.index, 1, 12);
        this.focusedDate = this.viewDate;
        this.view = 'days';
        this.render();
        this.focusCurrent();
    }

    pick(day: CalendarDay): void {
        if (this.mode === 'datetime') {
            this.focusedDate = fromIso(day.iso) ?? this.focusedDate;
            this.commit(`${day.iso}T${pad(this.hours)}:${pad(this.minutes)}`);
            this.render();
            return;
        }
        this.commit(day.iso);
        this.close();
    }

    pickToday(): void {
        const now = new Date();
        if (this.mode === 'month') {
            this.commit(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
        } else if (this.mode === 'datetime') {
            this.commit(`${toIso(now)}T${pad(this.hours)}:${pad(this.minutes)}`);
        } else {
            this.commit(toIso(now));
        }
        this.close();
    }

    clear(): void {
        this.commit('');
        this.close();
    }

    /** time typed as text: "1230" or "12:30"; after two digits the colon is added automatically */
    timeText(): string { return `${pad(this.hours)}:${pad(this.minutes)}`; }
    onTimeInput(event: Event): void {
        const el = event.target as HTMLInputElement;
        const deleting = (event as InputEvent).inputType?.startsWith('delete');
        let digits = el.value.replace(/\D/g, '');
        if (digits.length && Number(digits[0]) > 2) digits = '0' + digits;
        digits = digits.slice(0, 4);
        el.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits.length === 2 && !deleting ? `${digits}:` : digits;
        if (digits.length === 4) this.commitTimeText(event);
    }
    commitTimeText(event: Event): void {
        const el = event.target as HTMLInputElement;
        const m = /^(\d{1,2}):?(\d{0,2})$/.exec(el.value.trim());
        if (!m) { el.value = this.timeText(); return; }
        const hours = Math.min(23, Number(m[1]));
        const minutes = m[2] === '' ? 0 : Math.min(59, m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2]));
        el.value = `${pad(hours)}:${pad(minutes)}`;
        if (hours === this.hours && minutes === this.minutes) return;
        this.hours = hours; this.minutes = minutes;
        const date = this.value.slice(0, 10) || toIso(new Date());
        this.commit(`${date}T${pad(this.hours)}:${pad(this.minutes)}`);
    }

    setTime(part: 'hours' | 'minutes', raw: string): void {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        if (part === 'hours') this.hours = parsed;
        else this.minutes = parsed;
        const date = this.value.slice(0, 10) || toIso(new Date());
        this.commit(`${date}T${pad(this.hours)}:${pad(this.minutes)}`);
    }

    onTriggerKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown' && !this.open) {
            event.preventDefault();
            this.toggle();
        }
    }

    onDialogKeydown(event: KeyboardEvent): void {
        if (event.key === 'Tab') {
            this.trapFocus(event);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }

        if (this.view !== 'days' || !(event.target as HTMLElement).closest('[data-date]')) return;

        const current = this.focusedDate;
        const moves: Record<string, Date> = {
            ArrowLeft: addDays(current, -1),
            ArrowRight: addDays(current, 1),
            ArrowUp: addDays(current, -DAYS_IN_WEEK),
            ArrowDown: addDays(current, DAYS_IN_WEEK),
            Home: addDays(current, -((current.getDay() + 6) % DAYS_IN_WEEK)),
            End: addDays(current, DAYS_IN_WEEK - 1 - ((current.getDay() + 6) % DAYS_IN_WEEK)),
            PageUp: addMonths(current, event.shiftKey ? -12 : -1),
            PageDown: addMonths(current, event.shiftKey ? 12 : 1)
        };
        const next = moves[event.key];
        if (!next) return;

        event.preventDefault();
        this.focusedDate = next;
        this.viewDate = next;
        this.render();
        this.focusCurrent();
    }

    isFocusable(day: CalendarDay): boolean {
        return day.iso === toIso(this.focusedDate);
    }

    trackByIso(_index: number, day: CalendarDay): string {
        return day.iso;
    }

    private commit(value: string): void {
        this.value = value;
        this.updateDisplay();
        this.onChange(value);
    }

    private applyLocale(): void {
        const lang = (this.translate.currentLang || this.translate.defaultLang || 'nl').slice(0, 2);
        this.locale = LOCALES[lang] ?? DEFAULT_LOCALE;
        const long = new Intl.DateTimeFormat(this.locale, { weekday: 'long' });
        const short = new Intl.DateTimeFormat(this.locale, { weekday: 'short' });
        const monday = new Date(2024, 0, 1, 12);
        this.weekdays = Array.from({ length: DAYS_IN_WEEK }, (_, i) => ({
            short: short.format(addDays(monday, i)),
            long: long.format(addDays(monday, i))
        }));
        this.updateDisplay();
    }

    private syncTimeFromValue(): void {
        const match = /T(\d{2}):(\d{2})/.exec(this.value);
        if (match) {
            this.hours = Number(match[1]);
            this.minutes = Number(match[2]);
            return;
        }
        if (this.mode === 'datetime' && !this.value) {
            const now = new Date();
            this.hours = now.getHours();
            this.minutes = Math.floor(now.getMinutes() / 5) * 5;
        }
    }

    private updateDisplay(): void {
        const date = fromIso(this.value);
        if (!date) {
            this.displayValue = '';
            return;
        }
        if (this.mode === 'month') {
            this.displayValue = new Intl.DateTimeFormat(this.locale, { month: 'long', year: 'numeric' }).format(date);
            return;
        }
        const day = new Intl.DateTimeFormat(this.locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
        this.displayValue = this.mode === 'datetime' ? `${day}, ${pad(this.hours)}:${pad(this.minutes)}` : day;
    }

    private moveMonth(offset: number): void {
        this.viewDate = addMonths(this.viewDate, offset);
        this.focusedDate = this.viewDate;
        this.render();
    }

    private moveYear(offset: number): void {
        const year = clampYear(this.viewDate.getFullYear() + offset);
        this.viewDate = new Date(year, this.viewDate.getMonth(), 1, 12);
        this.focusedDate = this.viewDate;
        this.render();
    }

    private movePage(offset: number): void {
        this.yearPageStart = Math.min(MAX_YEAR - YEARS_PER_PAGE + 1, Math.max(MIN_YEAR, this.yearPageStart + offset * YEARS_PER_PAGE));
        this.render();
    }

    private pageStartFor(year: number): number {
        return clampYear(year - ((year - MIN_YEAR) % YEARS_PER_PAGE));
    }

    private render(): void {
        const year = this.viewDate.getFullYear();
        const month = this.viewDate.getMonth();
        const today = new Date();
        const selected = fromIso(this.value);

        this.monthName = new Intl.DateTimeFormat(this.locale, { month: 'long' }).format(this.viewDate);
        this.yearLabel = String(year);

        const monthFormatter = new Intl.DateTimeFormat(this.locale, { month: 'short' });
        this.months = Array.from({ length: 12 }, (_, index) => ({
            index,
            label: monthFormatter.format(new Date(2024, index, 1, 12)),
            current: today.getFullYear() === year && today.getMonth() === index,
            selected: !!selected && selected.getFullYear() === year && selected.getMonth() === index
        }));

        if (this.view === 'years') {
            this.years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => {
                const value = this.yearPageStart + i;
                return { year: value, current: value === today.getFullYear(), selected: !!selected && selected.getFullYear() === value };
            });
            this.yearRangeLabel = `${this.yearPageStart} - ${this.yearPageStart + YEARS_PER_PAGE - 1}`;
        }

        const first = new Date(year, month, 1, 12);
        const offset = (first.getDay() + 6) % DAYS_IN_WEEK;
        const gridStart = addDays(first, -offset);
        const todayIso = toIso(today);
        const selectedIso = this.value.slice(0, 10);
        const dayLabel = new Intl.DateTimeFormat(this.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const weeks = Array.from({ length: WEEKS_SHOWN }, (_, week) =>
            Array.from({ length: DAYS_IN_WEEK }, (_, day) => {
                const date = addDays(gridStart, week * DAYS_IN_WEEK + day);
                const iso = toIso(date);
                return {
                    iso,
                    day: date.getDate(),
                    inMonth: date.getMonth() === month,
                    today: iso === todayIso,
                    selected: iso === selectedIso,
                    label: dayLabel.format(date)
                };
            })
        );
        this.weeks = weeks.filter(week => week.some(day => day.inMonth));
    }

    private focusCurrent(): void {
        setTimeout(() => {
            const root = this.dialogEl;
            const selector = this.view === 'days'
                ? `[data-date="${toIso(this.focusedDate)}"]`
                : this.view === 'months' ? '.date-picker-choice.is-selected, .date-picker-choice.is-today, .date-picker-choice' : '.date-picker-choice.is-selected, .date-picker-choice.is-today, .date-picker-choice';
            root?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
        });
    }

    private moveToBody(): void {
        const root = this.host.nativeElement;
        const dialog = root.querySelector<HTMLElement>('.date-picker-dialog');
        const backdrop = root.querySelector<HTMLElement>('.date-picker-backdrop');
        if (!dialog || !backdrop) return;
        this.dialogEl = dialog;
        this.backdropEl = backdrop;
        root.ownerDocument.body.append(backdrop, dialog);
    }

    private updatePlacement(): void {
        const root = this.host.nativeElement;
        const win = root.ownerDocument.defaultView;
        const dialog = this.dialogEl;
        const trigger = root.querySelector<HTMLElement>('.date-picker-trigger');
        if (!win || !dialog || !trigger || win.matchMedia(SHEET_QUERY).matches) return;

        const rect = trigger.getBoundingClientRect();
        const spaceBelow = win.innerHeight - rect.bottom;
        const needed = dialog.offsetHeight + PLACEMENT_MARGIN;
        this.openAbove = spaceBelow < needed && rect.top > spaceBelow;

        const left = Math.max(8, Math.min(rect.left, win.innerWidth - DIALOG_WIDTH - 8));
        this.position = this.openAbove
            ? { top: null, bottom: win.innerHeight - rect.top + 6, left }
            : { top: rect.bottom + 6, bottom: null, left };
    }

    private readonly onScroll = (event: Event): void => {
        const target = event.target as Node | null;
        if (target && this.dialogEl?.contains(target)) return;
        this.updatePlacement();
    };

    private attachScrollListener(): void {
        this.host.nativeElement.ownerDocument.addEventListener('scroll', this.onScroll, true);
    }

    private detachScrollListener(): void {
        this.host.nativeElement.ownerDocument.removeEventListener('scroll', this.onScroll, true);
    }

    private trapFocus(event: KeyboardEvent): void {
        const dialog = this.dialogEl;
        const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), select:not([disabled])') ?? []);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = this.host.nativeElement.ownerDocument.activeElement;
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }
}