import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { LockStatus, UnlockResult } from '../../shared/types';
import { getSecret, setSecret } from './secrets';

// App PIN (4-8 digits). Only a salted scrypt hash is stored. Until the PIN has been entered once
// for the current window, the IPC layer refuses everything except the lock channels (see ipc.ts),
// so no mail, calendar or contact data reaches the renderer before unlocking.
const OWNER = 'app:pin';
const VALID = /^\d{4,8}$/;
let unlocked = false;
let failures = 0;
let blockedUntil = 0;

const hash = (pin: string, salt: Buffer) => scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
function stored(): { salt: Buffer; hash: Buffer; length: number } | null {
  const raw = getSecret(OWNER);
  if (!raw) return null;
  const [length, salt, h] = raw.split(':');
  return salt && h ? { length: Number(length), salt: Buffer.from(salt, 'hex'), hash: Buffer.from(h, 'hex') } : null;
}
function save(pin: string) { const salt = randomBytes(16); setSecret(OWNER, `${pin.length}:${salt.toString('hex')}:${hash(pin, salt).toString('hex')}`); }
function matches(pin: string) { const s = stored(); if (!s || !VALID.test(pin)) return false; const h = hash(pin, s.salt); return h.length === s.hash.length && timingSafeEqual(h, s.hash); }
const retryAfter = () => Math.max(0, blockedUntil - Date.now());

export const isUnlocked = () => unlocked;
export const lockWindow = () => { unlocked = false; };
export function lockStatus(): LockStatus { const s = stored(); return { hasPin: !!s, length: s?.length ?? null, retryAfter: retryAfter() }; }
export function setupPin(pin: string): UnlockResult {
  if (stored()) throw Object.assign(new Error('A PIN is already set'), { status: 409 });
  if (!VALID.test(pin)) throw Object.assign(new Error('The PIN must be 4 to 8 digits'), { status: 400 });
  save(pin); unlocked = true; failures = 0;
  return { ok: true, retryAfter: 0 };
}
export function unlock(pin: string): UnlockResult {
  if (retryAfter() > 0) return { ok: false, retryAfter: retryAfter() };
  if (matches(String(pin ?? ''))) { unlocked = true; failures = 0; return { ok: true, retryAfter: 0 }; }
  failures++;
  // 5 free attempts, then 30 s, 60 s, 120 s ... capped at 15 minutes
  if (failures >= 5) blockedUntil = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (failures - 5));
  return { ok: false, retryAfter: retryAfter() };
}
export function changePin(current: string, next: string): UnlockResult {
  const check = unlock(current);
  if (!check.ok) return check;
  if (!VALID.test(next)) throw Object.assign(new Error('The PIN must be 4 to 8 digits'), { status: 400 });
  save(next);
  return { ok: true, retryAfter: 0 };
}
