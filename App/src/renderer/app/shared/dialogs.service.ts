import { Injectable, signal } from '@angular/core';
export interface ConfirmState { message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void; }
export interface MenuItem { label?: string; icon?: string; action?: () => void; danger?: boolean; disabled?: boolean; active?: boolean; color?: string; children?: MenuItem[]; separator?: boolean; checked?: boolean; }
export interface MenuState { items: MenuItem[]; x: number; y: number; }
@Injectable({ providedIn: 'root' })
export class DialogsService {
  readonly confirmState = signal<ConfirmState | null>(null);
  readonly menu = signal<MenuState | null>(null);
  confirm(message: string, confirmLabel: string, danger = false): Promise<boolean> { return new Promise(resolve => this.confirmState.set({ message, confirmLabel, danger, resolve })); }
  answer(ok: boolean) { const s = this.confirmState(); if (!s) return; this.confirmState.set(null); s.resolve(ok); }
  openMenu(event: MouseEvent, items: MenuItem[]) { event.preventDefault(); event.stopPropagation(); const el = event.currentTarget as HTMLElement | null; const rect = event.type === 'contextmenu' || !el ? null : el.getBoundingClientRect(); this.menu.set({ items, x: rect ? rect.left : event.clientX, y: rect ? rect.bottom + 4 : event.clientY }); }
  closeMenu() { this.menu.set(null); }
}
