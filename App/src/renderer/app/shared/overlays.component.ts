import { Component, ElementRef, HostListener, inject, signal, ViewChild, effect } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from './icon.component';
import { ToastService } from './toast.service';
import { DialogsService, MenuItem } from './dialogs.service';
@Component({ selector: 'app-overlays', standalone: true, imports: [IconComponent, TranslatePipe], templateUrl: './overlays.component.html', styleUrl: './overlays.component.css' })
export class OverlaysComponent {
  readonly toasts = inject(ToastService);
  readonly dialogs = inject(DialogsService);
  readonly openSub = signal<MenuItem | null>(null);
  readonly subPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  @ViewChild('menuEl') menuEl?: ElementRef<HTMLElement>;
  @ViewChild('promptInput') set promptInput(ref: ElementRef<HTMLInputElement> | undefined) { if (ref) setTimeout(() => { ref.nativeElement.focus(); ref.nativeElement.select(); }); }
  constructor() { effect(() => { this.dialogs.menu(); this.openSub.set(null); queueMicrotask(() => this.clamp()); }); }
  private clamp() { const el = this.menuEl?.nativeElement; const m = this.dialogs.menu(); if (!el || !m) return; const r = el.getBoundingClientRect(); let x = m.x, y = m.y; if (x + r.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - r.width - 8); if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8); if (x !== m.x || y !== m.y) this.dialogs.menu.set({ ...m, x, y }); }
  run(item: MenuItem, event: MouseEvent) { event.stopPropagation(); if (item.disabled) return; if (item.children) { this.toggleSub(item, event); return; } this.dialogs.closeMenu(); item.action?.(); }
  toggleSub(item: MenuItem, event: MouseEvent) { const el = event.currentTarget as HTMLElement; const r = el.getBoundingClientRect(); const width = 220; const x = r.right + width > window.innerWidth ? r.left - width : r.right; this.subPos.set({ x, y: Math.min(r.top, window.innerHeight - 320) }); this.openSub.set(this.openSub() === item ? null : item); }
  @HostListener('document:mousedown', ['$event']) onDown(e: MouseEvent) { if (this.dialogs.menu() && !(e.target as HTMLElement).closest('.menu')) this.dialogs.closeMenu(); }
  @HostListener('document:keydown.escape') onEsc() { if (this.dialogs.menu()) this.dialogs.closeMenu(); else if (this.dialogs.promptState()) this.dialogs.answerPrompt(null); else if (this.dialogs.confirmState()) this.dialogs.answer(false); }
  @HostListener('window:blur') onBlur() { this.dialogs.closeMenu(); }
}
