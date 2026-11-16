/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Injectable, NgZone, inject } from '@angular/core';
import { Api, ApiChannel, Bridge, EventChannel, Events } from '../../../shared/types';
declare global { interface Window { dhmail: Bridge; } }
export class ApiError extends Error { constructor(message: string, public code: string | null = null, public status: number | null = null) { super(message); } }
export function parseError(err: unknown): ApiError { const raw = err instanceof Error ? err.message : String(err); const m = /\{[\s\S]*\}$/.exec(raw); if (m) { try { const d = JSON.parse(m[0]); return new ApiError(d.message || raw, d.code ?? null, d.status ?? null); } catch {} } return new ApiError(raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
@Injectable({ providedIn: 'root' })
export class BridgeService {
  private zone = inject(NgZone);
  readonly available = typeof window !== 'undefined' && !!window.dhmail;
  invoke<K extends ApiChannel>(channel: K, ...args: Parameters<Api[K]>): Promise<ReturnType<Api[K]>> { if (!this.available) return Promise.reject(new ApiError('Desktop bridge is not available')); return window.dhmail.invoke(channel, ...args).catch(err => { throw parseError(err); }); }
  on<K extends EventChannel>(channel: K, listener: (payload: Events[K]) => void): () => void { if (!this.available) return () => {}; return window.dhmail.on(channel, payload => this.zone.run(() => listener(payload))); }
}