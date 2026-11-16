/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './bus';
/** names the app had before; their data folder in %APPDATA% is taken over once */
const OLD_NAMES = ['DHDMail'];
const DB = 'dhmail.db';
function moveEntry(from: string, to: string) {
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  try { renameSync(from, to); } catch { cpSync(from, to, { recursive: true }); }
}
/**
 * A 1.29.0 test build was called DHDMail and kept its data in %APPDATA%\DHDMail. If that build was used,
 * move the mail, settings, PIN and the key that unlocks the saved passwords ("Local State") back to %APPDATA%\DHMail.
 * Runs before anything else touches the data folder, and only while the new folder has no database yet.
 */
export function moveOldUserData() {
  const target = app.getPath('userData');
  for (const name of OLD_NAMES) { const source = join(app.getPath('appData'), name); if (source.toLowerCase() !== target.toLowerCase() && moveDataFolder(source, target)) return; }
}
/** Moves an old data folder to the new place; false when there is nothing to move or the new place already has data. */
export function moveDataFolder(source: string, target: string): boolean {
  if (existsSync(join(target, DB)) || !existsSync(join(source, DB))) return false;
  try {
    if (!existsSync(target)) { try { renameSync(source, target); log('data folder moved', source, '→', target); return true; } catch { /* in use or another drive: move entry by entry */ } }
    mkdirSync(target, { recursive: true });
    // the old files win over whatever Electron already put in the new folder ("Local State" holds the password key)
    for (const entry of readdirSync(source)) moveEntry(join(source, entry), join(target, entry));
    try { rmdirSync(source); } catch { /* copied instead of moved: the old folder stays as a backup */ }
    log('data folder moved', source, '→', target);
    return true;
  } catch (err: any) { log('data folder not moved', source, err?.message); return false; }
}