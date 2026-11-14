import { Injectable, signal } from '@angular/core';
export interface ConfirmState { message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void; }
export interface PromptState { message: string; value: string; confirmLabel: string; resolve: (value: string | null) => void; }
export interface MenuItem { label?: string; icon?: string; action?: () => void; danger?: boolean; disabled?: boolean; active?: boolean; color?: string; children?: MenuItem[]; separator?: boolean; checked?: boolean; }
export interface MenuState { items: MenuItem[]; x: number; y: number; }
@Injectable({ providedIn: 'root' })
export class DialogsService {
  readonly confirmState = signal<ConfirmState | null>(null);
  readonly menu = signal<MenuState | null>(null);
  readonly promptState = signal<PromptState | null>(null);
  confirm(message: string, confirmLabel: string, danger = false): Promise<boolean> { return new Promise(resolve => this.confirmState.set({ message, confirmLabel, danger, resolve })); }
  answer(ok: boolean) { const s = this.confirmState(); if (!s) return; this.confirmState.set(null); s.resolve(ok); }
  /** In-app replacement for window.prompt (which Electron does not support): resolves the entered text, or null when cancelled */
  prompt(message: string, value = '', confirmLabel = 'OK'): Promise<string | null> { this.promptState()?.resolve(null); return new Promise(resolve => this.promptState.set({ message, value, confirmLabel, resolve })); }
  answerPrompt(value: string | null) { const s = this.promptState(); if (!s) return; this.promptState.set(null); s.resolve(value); }
  openMenu(event: MouseEvent, items: MenuItem[]) { event.preventDefault(); event.stopPropagation(); const el = event.currentTarget as HTMLElement | null; const rect = event.type === 'contextmenu' || !el ? null : el.getBoundingClientRect(); this.menu.set({ items, x: rect ? rect.left : event.clientX, y: rect ? rect.bottom + 4 : event.clientY }); }
  closeMenu() { this.menu.set(null); }
}
