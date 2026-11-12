import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LockService } from '../core/lock.service';
import { IconComponent } from './icon.component';
import { LogoComponent } from './logo.component';
import { ToastService } from './toast.service';

type Step = 'enter' | 'current' | 'new' | 'confirm';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'enter'];

@Component({
  selector: 'app-lock-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, IconComponent, LogoComponent],
  templateUrl: './lock-screen.component.html',
  styleUrl: './lock-screen.component.css'
})
export class LockScreenComponent {
  readonly lock = inject(LockService);
  private translate = inject(TranslateService);
  private host = inject(ElementRef<HTMLElement>);
  private toast = inject(ToastService);
  readonly keys = KEYS;
  readonly step = signal<Step>(this.firstStep());
  readonly entry = signal('');
  readonly message = signal<{ text: string; kind: '' | 'err' | 'ok' }>({ text: '', kind: '' });
  readonly shaking = signal(false);
  readonly busy = signal(false);
  readonly now = signal(Date.now());
  private current = '';
  private first = '';

  readonly waitSeconds = computed(() => Math.max(0, Math.ceil((this.lock.retryUntil() - this.now()) / 1000)));
  /** Fixed length when the PIN length is known, otherwise the boxes grow from 4 up to 8. */
  readonly fixedLength = computed(() => { const s = this.step(); if (s === 'confirm') return this.first.length; if (s === 'enter' || s === 'current') return this.lock.pinLength(); return null; });
  readonly boxes = computed(() => { const len = this.fixedLength() ?? Math.max(4, Math.min(8, this.entry().length + 1)); return Array.from({ length: len }, (_, i) => i); });
  readonly title = computed(() => { const m = this.lock.mode(); return m === 'setup' ? 'APP.LOCK.TITLE_SETUP' : m === 'change' ? 'APP.LOCK.TITLE_CHANGE' : 'APP.LOCK.TITLE_UNLOCK'; });
  readonly prompt = computed(() => ({ enter: 'APP.LOCK.STEP_ENTER', current: 'APP.LOCK.STEP_CURRENT', new: 'APP.LOCK.STEP_NEW', confirm: 'APP.LOCK.STEP_CONFIRM' })[this.step()]);

  constructor() {
    const onKey = (e: KeyboardEvent) => {
      // the lock screen owns the keyboard: nothing reaches the app behind it
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^\d$/.test(e.key)) this.press(e.key);
      else if (e.key === 'Backspace') this.press('back');
      else if (e.key === 'Enter') this.press('enter');
      else if (e.key === 'Escape' && this.lock.mode() === 'change') this.lock.cancelChange();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    const tick = setInterval(() => this.now.set(Date.now()), 500);
    inject(DestroyRef).onDestroy(() => { window.removeEventListener('keydown', onKey, { capture: true }); clearInterval(tick); });
    queueMicrotask(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.lock-box')?.focus());
  }

  private firstStep(): Step { const m = this.lock.mode(); return m === 'setup' ? 'new' : m === 'change' ? 'current' : 'enter'; }

  press(k: string) {
    if (this.busy() || this.waitSeconds() > 0) return;
    if (k === 'back') { this.entry.update(v => v.slice(0, -1)); return; }
    if (k === 'enter') { this.submit(); return; }
    const max = this.fixedLength() ?? 8;
    if (this.entry().length >= max) return;
    this.entry.update(v => v + k);
    if (this.message().kind === 'err') this.say('');
    if (this.fixedLength() && this.entry().length === this.fixedLength()) setTimeout(() => this.submit(), 150);
  }

  private async submit() {
    const pin = this.entry();
    if (this.busy()) return;
    if (pin.length < 4) { this.say(this.t('APP.LOCK.TOO_SHORT'), 'err'); this.shake(); return; }
    const step = this.step();
    if (step === 'new') { this.first = pin; this.entry.set(''); this.step.set('confirm'); this.say(''); return; }
    if (step === 'confirm') {
      if (pin !== this.first) { this.first = ''; this.entry.set(''); this.step.set('new'); this.say(this.t('APP.LOCK.MISMATCH'), 'err'); this.shake(); return; }
      await this.run(async () => { if (this.lock.mode() === 'change') { const r = await this.lock.change(this.current, pin); if (r.ok) this.toast.show(this.t('APP.LOCK.CHANGED'), 'success'); else this.fail(r.retryAfter, 'current'); } else await this.lock.setup(pin); });
      return;
    }
    await this.run(async () => {
      const r = step === 'current' ? await this.lock.verify(pin) : await this.lock.unlock(pin);
      if (!r.ok) { this.fail(r.retryAfter, step); return; }
      if (step === 'current') { this.current = pin; this.entry.set(''); this.step.set('new'); this.say(''); }
    });
  }

  private async run(fn: () => Promise<void>) { this.busy.set(true); try { await fn(); } catch (err) { this.say(err instanceof Error ? err.message : String(err), 'err'); this.entry.set(''); } finally { this.busy.set(false); } }
  private fail(retryAfter: number, back: Step) { this.entry.set(''); this.step.set(back); this.shake(); this.say(retryAfter ? '' : this.t('APP.LOCK.WRONG'), retryAfter ? '' : 'err'); }
  private shake() { this.shaking.set(false); requestAnimationFrame(() => this.shaking.set(true)); setTimeout(() => this.shaking.set(false), 450); }
  private say(text: string, kind: '' | 'err' | 'ok' = '') { this.message.set({ text, kind }); }
  private t(key: string, params?: object) { return this.translate.instant(key, params); }
}
