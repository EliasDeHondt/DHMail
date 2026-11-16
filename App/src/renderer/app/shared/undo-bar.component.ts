/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { UndoService } from '../core/undo.service';
import { IconComponent } from './icon.component';

// Bottom-right countdown for deletes that can still be undone; stays visible on every page.
@Component({
  selector: 'app-undo-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, IconComponent],
  template: `@for (p of undo.pending(); track p.id) {
    <div class="undo" role="status">
      <span class="undo-ring" [style.--p]="progress(p.deadline)"><span>{{ secondsLeft(p.deadline) }}</span></span>
      <span class="undo-text">{{ p.message }}</span>
      <button type="button" class="btn btn--sm undo-btn" (click)="undo.undo(p.id)"><app-icon name="back"></app-icon>{{ 'APP.COMMON.UNDO' | translate }}</button>
    </div>}`,
  styles: [`
    :host { position: fixed; right: 18px; bottom: 18px; z-index: 1300; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; }
    .undo { pointer-events: auto; display: flex; align-items: center; gap: 12px; min-width: 300px; max-width: 460px; padding: 10px 12px 10px 10px; border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line)); border-left: 3px solid var(--danger); border-radius: 12px; background: var(--background); box-shadow: var(--shadow); animation: pop 0.16s ease-out; }
    .undo-ring { --p: 1; position: relative; display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; background: conic-gradient(var(--danger) calc(var(--p) * 360deg), color-mix(in srgb, var(--danger) 15%, transparent) 0); }
    .undo-ring::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--background); }
    .undo-ring span { position: relative; z-index: 1; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--danger); }
    .undo-text { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 500; }
    .undo-btn { flex: none; border-color: var(--primary); color: var(--ink); font-weight: 600; }
    .undo-btn app-icon { --icon-size: 15px; }
  `]
})
export class UndoBarComponent {
  readonly undo = inject(UndoService);
  private now = signal(Date.now());
  constructor() { const t = setInterval(() => this.now.set(Date.now()), 250); inject(DestroyRef).onDestroy(() => clearInterval(t)); }
  secondsLeft(deadline: number) { return Math.max(0, Math.ceil((deadline - this.now()) / 1000)); }
  progress(deadline: number) { return Math.max(0, Math.min(1, (deadline - this.now()) / 30000)); }
}