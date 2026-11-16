/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Injectable, signal } from '@angular/core';
export interface Toast { id: number; message: string; kind: 'info' | 'success' | 'error'; action?: { label: string; run: () => void }; }
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);
  show(message: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = kind === 'error' ? 7000 : 4000) { const id = ++this.seq; this.toasts.update(t => [...t, { id, message, kind, action }]); setTimeout(() => this.dismiss(id), ms); }
  error(err: unknown) { this.show(err instanceof Error ? err.message : String(err), 'error'); }
  dismiss(id: number) { this.toasts.update(t => t.filter(x => x.id !== id)); }
}