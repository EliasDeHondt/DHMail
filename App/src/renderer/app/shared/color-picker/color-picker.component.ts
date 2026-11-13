/**
    * @author EliasDH Team
    * @see https://eliasdh.com
    * @since 13/11/2026
**/

import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, forwardRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

interface Hsv {
    h: number;
    s: number;
    v: number;
}

export const COLOR_PRESETS = ['#4f94f0', '#0f54ae', '#1baf7a', '#199e70', '#14b8a6', '#0ea5e9', '#8b5cf6', '#e87ba4', '#ec4899', '#e74c3c', '#eb6834', '#eda100', '#84cc16', '#6b7280', '#374151', '#000000'];
const DEFAULT_COLOR = '#4f94f0';
const SHEET_QUERY = '(max-width: 640px)';
const PLACEMENT_MARGIN = 16;
const DIALOG_WIDTH = 264;
const WHEEL_PIXELS = 440;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function toHexByte(value: number): string {
    return Math.round(value).toString(16).padStart(2, '0');
}

function hsvToHex({ h, s, v }: Hsv): string {
    const channel = (n: number) => {
        const k = (n + h / 60) % 6;
        return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
    };
    return `#${toHexByte(channel(5))}${toHexByte(channel(3))}${toHexByte(channel(1))}`;
}

function hexToHsv(hex: string): Hsv {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16 & 255) / 255;
    const g = (n >> 8 & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = 0;
    if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

export function normalizeHex(input: string | null | undefined): string | null {
    let hex = String(input ?? '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

let wheelImage: string | null = null;

function wheelDataUrl(doc: Document): string {
    if (wheelImage) return wheelImage;
    const canvas = doc.createElement('canvas');
    canvas.width = canvas.height = WHEEL_PIXELS;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const image = ctx.createImageData(WHEEL_PIXELS, WHEEL_PIXELS);
    const radius = WHEEL_PIXELS / 2;
    for (let y = 0; y < WHEEL_PIXELS; y++) {
        for (let x = 0; x < WHEEL_PIXELS; x++) {
            const dx = x - radius;
            const dy = y - radius;
            const distance = Math.hypot(dx, dy);
            if (distance > radius) continue;
            const n = parseInt(hsvToHex({ h: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, s: distance / radius, v: 1 }).slice(1), 16);
            const i = (y * WHEEL_PIXELS + x) * 4;
            image.data[i] = n >> 16 & 255;
            image.data[i + 1] = n >> 8 & 255;
            image.data[i + 2] = n & 255;
            image.data[i + 3] = distance > radius - 1 ? Math.round((radius - distance) * 255) : 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    wheelImage = canvas.toDataURL();
    return wheelImage;
}

let nextId = 0;

@Component({
    selector: 'app-color-picker',
    templateUrl: './color-picker.component.html',
    styleUrls: ['./color-picker.component.css'],
    imports: [CommonModule, TranslatePipe],
    providers: [{
        provide: NG_VALUE_ACCESSOR,
        useExisting: forwardRef(() => ColorPickerComponent),
        multi: true
    }],
    standalone: true
})
export class ColorPickerComponent implements ControlValueAccessor, OnDestroy {
    @Input() inputId = '';
    @Input() palette: string[] | null = null;
    @Input() compact = false;
    @Input() clearable = false;
    @Input() label = '';
    @Input() set value(value: string | null | undefined) {
        this.writeValue(value ?? null);
    }
    get value(): string {
        return this.current;
    }
    @Output() valueChange = new EventEmitter<string>();

    readonly dialogId = `color-picker-${nextId++}`;
    readonly presets = COLOR_PRESETS;

    disabled = false;
    open = false;
    openAbove = false;
    ready = false;
    hsv: Hsv = { h: 0, s: 0, v: 0 };
    hexDraft = '';
    hexInvalid = false;
    wheelSrc = '';
    position: { top: number | null; bottom: number | null; left: number } = { top: 0, bottom: null, left: 0 };

    private current = DEFAULT_COLOR;
    private original = '';
    private dialogEl: HTMLElement | null = null;
    private dragging = false;
    private host = inject<ElementRef<HTMLElement>>(ElementRef);
    private onChange: (value: string) => void = () => {};
    private onTouched: () => void = () => {};

    ngOnDestroy(): void {
        this.detachScrollListener();
        if (this.open) this.removeDetached();
    }

    writeValue(value: string | null): void {
        this.current = normalizeHex(value) ?? (this.palette ? '' : DEFAULT_COLOR);
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

    get thumbLeft(): number {
        return 50 + Math.cos(this.hsv.h * Math.PI / 180) * this.hsv.s * 50;
    }

    get thumbTop(): number {
        return 50 + Math.sin(this.hsv.h * Math.PI / 180) * this.hsv.s * 50;
    }

    get sliderBackground(): string {
        return `linear-gradient(to right, #000, ${hsvToHex({ ...this.hsv, v: 1 })})`;
    }

    get brightness(): number {
        return Math.round(this.hsv.v * 100);
    }

    get presetList(): string[] {
        return this.palette ?? this.presets;
    }

    isSelected(preset: string): boolean {
        return preset.toLowerCase() === this.current;
    }

    toggle(): void {
        if (this.disabled) return;
        if (this.open) {
            this.close(true);
            return;
        }
        this.original = this.current;
        this.hsv = hexToHsv(this.current || '#000000');
        this.hexDraft = this.current.slice(1);
        this.hexInvalid = false;
        if (!this.palette) this.wheelSrc = wheelDataUrl(this.host.nativeElement.ownerDocument);
        this.openAbove = false;
        this.open = true;
        this.attachScrollListener();
        setTimeout(() => {
            this.moveToBody();
            this.updatePlacement();
            this.ready = true;
            if (this.palette) {
                const swatch = this.dialogEl?.querySelector<HTMLElement>('.color-picker-preset.is-selected') ?? this.dialogEl?.querySelector<HTMLElement>('.color-picker-preset');
                swatch?.focus({ preventScroll: true });
            } else if (!this.isSheet()) {
                const input = this.dialogEl?.querySelector<HTMLInputElement>('.color-picker-hex-input');
                input?.focus({ preventScroll: true });
                input?.select();
            }
        });
    }

    close(keep: boolean, restoreFocus = true): void {
        if (!this.open) return;
        if (!keep && this.current !== this.original) this.commit(this.original);
        this.open = false;
        this.ready = false;
        this.dragging = false;
        this.dialogEl = null;
        this.detachScrollListener();
        this.onTouched();
        if (restoreFocus && !this.isSheet()) {
            this.host.nativeElement.querySelector<HTMLElement>('.color-picker-trigger')?.focus();
        }
    }

    @HostListener('window:resize')
    onResize(): void {
        if (this.open) this.updatePlacement();
    }

    onWheelDown(event: PointerEvent): void {
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture?.(event.pointerId);
        this.dragging = true;
        this.pickAt(event, target);
    }

    onWheelMove(event: PointerEvent): void {
        if (this.dragging) this.pickAt(event, event.currentTarget as HTMLElement);
    }

    onWheelUp(): void {
        this.dragging = false;
    }

    setBrightness(value: string): void {
        this.hsv = { ...this.hsv, v: clamp(Number(value) / 100, 0, 1) };
        this.applyHsv();
    }

    onHexInput(value: string): void {
        this.hexDraft = value.replace(/^#/, '');
        const hex = normalizeHex(this.hexDraft);
        this.hexInvalid = !hex && this.hexDraft.length > 0;
        if (hex && this.hexDraft.length === 6) {
            this.hsv = hexToHsv(hex);
            this.commit(hex);
        }
    }

    onHexBlur(): void {
        const hex = normalizeHex(this.hexDraft);
        if (hex) {
            this.hsv = hexToHsv(hex);
            this.commit(hex);
        }
        this.hexDraft = this.current.slice(1);
        this.hexInvalid = false;
    }

    onHexEnter(): void {
        this.onHexBlur();
        this.close(true);
    }

    pickPreset(hex: string): void {
        const color = normalizeHex(hex) ?? hex;
        if (this.palette) {
            this.commit(color);
            this.close(true);
            return;
        }
        this.hsv = hexToHsv(color);
        this.commit(color);
        this.hexDraft = color.slice(1);
        this.hexInvalid = false;
    }

    clear(): void {
        this.commit('');
        this.close(true);
    }

    onDialogKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close(false);
        } else if (event.key === 'Tab') {
            this.trapFocus(event);
        }
    }

    trackByHex(_index: number, hex: string): string {
        return hex;
    }

    private pickAt(event: PointerEvent, wheel: HTMLElement): void {
        const rect = wheel.getBoundingClientRect();
        const radius = rect.width / 2;
        const dx = event.clientX - rect.left - radius;
        const dy = event.clientY - rect.top - radius;
        this.hsv = {
            h: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360,
            s: clamp(Math.hypot(dx, dy) / radius, 0, 1),
            v: this.hsv.v < 0.05 ? 1 : this.hsv.v
        };
        this.applyHsv();
    }

    private applyHsv(): void {
        this.commit(hsvToHex(this.hsv));
        this.hexDraft = this.current.slice(1);
        this.hexInvalid = false;
    }

    private commit(hex: string): void {
        if (hex === this.current) return;
        this.current = hex;
        this.onChange(hex);
        this.valueChange.emit(hex);
    }

    private isSheet(): boolean {
        return !!this.host.nativeElement.ownerDocument.defaultView?.matchMedia(SHEET_QUERY).matches;
    }

    private moveToBody(): void {
        const root = this.host.nativeElement;
        const dialog = root.querySelector<HTMLElement>('.color-picker-dialog');
        const backdrop = root.querySelector<HTMLElement>('.color-picker-backdrop');
        if (!dialog || !backdrop) return;
        this.dialogEl = dialog;
        root.ownerDocument.body.append(backdrop, dialog);
    }

    private removeDetached(): void {
        const dialog = this.host.nativeElement.ownerDocument.getElementById(this.dialogId);
        const backdrop = dialog?.previousElementSibling;
        if (backdrop?.classList.contains('color-picker-backdrop')) backdrop.remove();
        dialog?.remove();
    }

    private updatePlacement(): void {
        const root = this.host.nativeElement;
        const win = root.ownerDocument.defaultView;
        const dialog = this.dialogEl;
        const trigger = root.querySelector<HTMLElement>('.color-picker-trigger');
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
        const focusable = Array.from(this.dialogEl?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
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
