/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Injectable, inject, signal } from '@angular/core';
import { BridgeService } from './bridge.service';
import { Settings } from '../../../shared/types';
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private bridge = inject(BridgeService);
  private systemDark = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  private mode: Settings['theme'] = 'system';
  readonly dark = signal(false);
  constructor() { this.bridge.on('theme:system', p => { this.systemDark = p.dark; this.apply(); }); }
  set(mode: Settings['theme']) { this.mode = mode; this.apply(); }
  /** True while a modal dialog is open: the native window buttons are then dimmed like the backdrop and disabled. */
  private modal = false;
  setModal(open: boolean) { if (open === this.modal) return; this.modal = open; this.apply(); }
  private apply() { const dark = this.mode === 'dark' || (this.mode === 'system' && this.systemDark); this.dark.set(dark); document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); const color = dark ? '#060709' : '#f6f7f9', symbolColor = dark ? '#edeff2' : '#0c0e11'; this.bridge.invoke('app:titleBar', { color: this.modal ? dim(color) : color, symbolColor: this.modal ? dim(symbolColor) : symbolColor, modal: this.modal }).catch(() => {}); }
}
// same result as the .overlay backdrop (black at 45%) drawn over the colour
function dim(hex: string) { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v * 0.55).toString(16).padStart(2, '0')); return '#' + c.join(''); }