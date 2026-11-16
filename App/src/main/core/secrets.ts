/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { safeStorage } from 'electron';
import { get, run } from './db';
const canEncrypt = () => safeStorage.isEncryptionAvailable();
export function setSecret(owner: string, value: string) { const blob = canEncrypt() ? safeStorage.encryptString(value) : Buffer.from('plain:' + value, 'utf8'); run('INSERT INTO secrets(owner, value) VALUES(?, ?) ON CONFLICT(owner) DO UPDATE SET value = excluded.value', owner, blob); }
export function getSecret(owner: string): string | null { const row = get<{ value: Uint8Array }>('SELECT value FROM secrets WHERE owner = ?', owner); if (!row) return null; const buf = Buffer.from(row.value); if (buf.subarray(0, 6).toString('utf8') === 'plain:') return buf.subarray(6).toString('utf8'); return canEncrypt() ? safeStorage.decryptString(buf) : null; }
export function deleteSecret(owner: string) { run('DELETE FROM secrets WHERE owner = ?', owner); }
export function deleteSecretsFor(prefix: string) { run('DELETE FROM secrets WHERE owner LIKE ?', prefix + '%'); }