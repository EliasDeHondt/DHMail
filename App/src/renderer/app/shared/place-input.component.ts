/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Component, ElementRef, Input, OnDestroy, ViewChild, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { BridgeService } from '../core/bridge.service';
import { IconComponent } from './icon.component';
import { PlaceSuggestion } from '../../../shared/types';
let nextId = 0;
@Component({ selector: 'app-place-input', standalone: true, imports: [IconComponent], providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PlaceInputComponent), multi: true }], template: `<input #field class="input" type="text" role="combobox" autocomplete="off" [id]="inputId" [value]="value" [placeholder]="placeholder" [disabled]="disabled" [attr.aria-expanded]="open()" [attr.aria-controls]="listId" [attr.aria-activedescendant]="active() >= 0 ? listId + '-' + active() : null" aria-autocomplete="list" (input)="onInput($any($event.target).value)" (keydown)="onKeydown($event)" (focus)="onFocus()" (blur)="onBlur()"/>@if (open()) {<ul class="place-list" role="listbox" [id]="listId" [style.top.px]="pos().top" [style.left.px]="pos().left" [style.width.px]="pos().width">@for (s of items(); track s.label; let i = $index) {<li class="place-option" role="option" [id]="listId + '-' + i" [class.place-option--active]="i === active()" [attr.aria-selected]="i === active()" (mousedown)="$event.preventDefault()" (mouseenter)="active.set(i)" (click)="pick(s)"><app-icon name="map-pin"></app-icon><span class="place-text"><span class="place-title">{{ s.title }}</span>@if (s.detail) {<span class="place-detail">{{ s.detail }}</span>}</span></li>}</ul>}`, styles: [`:host { display: block; min-width: 0; } .place-list { position: fixed; z-index: 100002; margin: 4px 0 0; padding: 4px; list-style: none; max-height: 280px; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28); animation: place-in 0.12s ease-out; } .place-option { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 7px; } .place-option app-icon { --icon-size: 16px; flex: none; margin-top: 2px; color: var(--secondary); } .place-option--active { background: color-mix(in srgb, var(--primary) 12%, transparent); } .place-option--active app-icon { color: var(--primary); } .place-text { display: flex; flex-direction: column; min-width: 0; } .place-title { font-size: 13.5px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .place-detail { font-size: 12px; color: var(--secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } @keyframes place-in { from { opacity: 0; transform: translateY(-4px); } } @media (prefers-reduced-motion: reduce) { .place-list { animation: none; } }`] })
export class PlaceInputComponent implements ControlValueAccessor, OnDestroy {
  private bridge = inject(BridgeService);
  private translate = inject(TranslateService);
  @ViewChild('field', { static: true }) field!: ElementRef<HTMLInputElement>;
  @Input() inputId = '';
  @Input() placeholder = '';
  readonly listId = `place-list-${nextId++}`;
  readonly items = signal<PlaceSuggestion[]>([]);
  readonly open = signal(false);
  readonly active = signal(-1);
  readonly pos = signal({ top: 0, left: 0, width: 0 });
  value = '';
  disabled = false;
  private focused = false;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};
  writeValue(v: string | null) { this.value = v ?? ''; }
  registerOnChange(fn: (v: string) => void) { this.onChange = fn; }
  registerOnTouched(fn: () => void) { this.onTouched = fn; }
  setDisabledState(d: boolean) { this.disabled = d; }
  ngOnDestroy() { if (this.timer) clearTimeout(this.timer); }
  onInput(v: string) { this.value = v; this.onChange(v); this.schedule(v); }
  onFocus() { this.focused = true; if (this.items().length) this.show(); }
  onBlur() { this.focused = false; this.onTouched(); this.close(); }
  onKeydown(e: KeyboardEvent) {
    if (!this.open()) { if (e.key === 'ArrowDown' && this.items().length) { e.preventDefault(); this.show(); } return; }
    const n = this.items().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set((this.active() + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set(this.active() <= 0 ? n - 1 : this.active() - 1); }
    else if (e.key === 'Enter' && this.active() >= 0) { e.preventDefault(); this.pick(this.items()[this.active()]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
  }
  pick(s: PlaceSuggestion) { this.value = s.label; this.onChange(s.label); this.items.set([]); this.close(); this.field.nativeElement.focus(); }
  private schedule(v: string) { if (this.timer) clearTimeout(this.timer); const q = v.trim(); const id = ++this.seq; if (q.length < 3) { this.items.set([]); this.close(); return; } this.timer = setTimeout(async () => { const lang = (this.translate.currentLang || 'nl').slice(0, 2); const res = await this.bridge.invoke('geo:suggest', q, lang).catch(() => [] as PlaceSuggestion[]); if (id !== this.seq) return; this.items.set(res.filter(s => s.label.toLowerCase() !== q.toLowerCase())); if (this.items().length && this.focused) this.show(); else this.close(); }, 250); }
  private show() { const r = this.field.nativeElement.getBoundingClientRect(); this.pos.set({ top: r.bottom, left: r.left, width: r.width }); this.active.set(-1); this.open.set(true); }
  private close() { this.open.set(false); this.active.set(-1); }
}