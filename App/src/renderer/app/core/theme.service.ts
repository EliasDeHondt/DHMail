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
  private apply() { const dark = this.mode === 'dark' || (this.mode === 'system' && this.systemDark); this.dark.set(dark); document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); this.bridge.invoke('app:titleBar', { color: dark ? '#060709' : '#f6f7f9', symbolColor: dark ? '#edeff2' : '#0c0e11' }).catch(() => {}); }
}
