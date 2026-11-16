/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Injectable, NgZone, inject, signal } from '@angular/core';
import { UnlockResult } from '../../../shared/types';
import { BridgeService } from './bridge.service';
import { StoreService } from './store.service';

export type LockMode = 'checking' | 'setup' | 'locked' | 'change' | 'unlocked';
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

@Injectable({ providedIn: 'root' })
export class LockService {
  private bridge = inject(BridgeService);
  private store = inject(StoreService);
  private zone = inject(NgZone);
  readonly mode = signal<LockMode>('checking');
  readonly pinLength = signal<number | null>(null);
  readonly retryUntil = signal(0);
  private lastActivity = Date.now();
  private watching = false;

  async start() {
    const s = await this.bridge.invoke('lock:status');
    this.pinLength.set(s.length);
    this.retryUntil.set(s.retryAfter ? Date.now() + s.retryAfter : 0);
    this.mode.set(s.hasPin ? 'locked' : 'setup');
    this.watchActivity();
  }
  async unlock(pin: string): Promise<UnlockResult> { const r = await this.bridge.invoke('lock:unlock', pin); this.retryUntil.set(r.retryAfter ? Date.now() + r.retryAfter : 0); if (r.ok && this.mode() === 'locked') this.opened(); return r; }
  /** Checks the current PIN while changing it, without leaving the change screen. */
  async verify(pin: string): Promise<UnlockResult> { const r = await this.bridge.invoke('lock:unlock', pin); this.retryUntil.set(r.retryAfter ? Date.now() + r.retryAfter : 0); return r; }
  async setup(pin: string) { await this.bridge.invoke('lock:setup', pin); this.pinLength.set(pin.length); this.opened(); }
  async change(current: string, next: string): Promise<UnlockResult> { const r = await this.bridge.invoke('lock:change', current, next); this.retryUntil.set(r.retryAfter ? Date.now() + r.retryAfter : 0); if (r.ok) { this.pinLength.set(next.length); this.opened(); } return r; }
  lock() { if (this.mode() !== 'unlocked' && this.mode() !== 'change') return; (document.activeElement as HTMLElement | null)?.blur?.(); this.mode.set('locked'); }
  beginChange() { if (this.mode() === 'unlocked') this.mode.set('change'); }
  cancelChange() { if (this.mode() === 'change') this.mode.set('unlocked'); }
  private opened() { this.lastActivity = Date.now(); this.mode.set('unlocked'); }
  private watchActivity() {
    if (this.watching) return;
    this.watching = true;
    this.zone.runOutsideAngular(() => {
      const mark = () => { this.lastActivity = Date.now(); };
      for (const ev of ACTIVITY) window.addEventListener(ev, mark, { capture: true, passive: true });
      setInterval(() => {
        if (this.mode() !== 'unlocked') return;
        const minutes = Math.min(480, Math.max(30, this.store.settings().autoLockMinutes || 30));
        if (Date.now() - this.lastActivity >= minutes * 60_000) this.zone.run(() => this.lock());
      }, 15_000);
    });
  }
}