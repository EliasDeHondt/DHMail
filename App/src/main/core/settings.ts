import { all, run } from './db';
import { Settings } from '../../shared/types';
export const DEFAULTS: Settings = { theme: 'system', language: 'nl', blockRemoteImages: true, notifications: true, markReadDelaySeconds: 2, syncIntervalMinutes: 2, weekStartsOn: 1, workDayStart: 8, workDayEnd: 18, googleClientId: '', googleClientSecret: '', microsoftClientId: '', microsoftTenant: 'common', defaultAccountId: null, darkMailBodies: true, autoLockMinutes: 30, notifyMutedAccounts: [] };
let cache: Settings | null = null;
export function getSettings(): Settings { if (cache) return cache; const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings'); const s: any = { ...DEFAULTS }; for (const r of rows) { try { s[r.key] = JSON.parse(r.value); } catch {} } cache = s; return s; }
export function setSettings(patch: Partial<Settings>): Settings { for (const [k, v] of Object.entries(patch)) { if (!(k in DEFAULTS)) continue; run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v)); } cache = null; return getSettings(); }
