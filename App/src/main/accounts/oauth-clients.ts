import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSettings } from '../core/settings';
import { OAuthProvider } from '../../shared/types';
export interface OAuthClients { googleClientId: string; googleClientSecret: string; microsoftClientId: string; microsoftTenant: string; }
let builtIn: OAuthClients | null = null;
function readBuiltIn(): OAuthClients { if (builtIn) return builtIn; const empty = { googleClientId: '', googleClientSecret: '', microsoftClientId: '', microsoftTenant: 'common' }; for (const dir of [app.getAppPath(), process.resourcesPath, join(app.getPath('exe'), '..')]) { const file = join(dir ?? '', 'oauth.json'); if (!dir || !existsSync(file)) continue; try { builtIn = { ...empty, ...JSON.parse(readFileSync(file, 'utf8')) }; return builtIn!; } catch {} } builtIn = empty; return empty; }
export function oauthClients(): OAuthClients { const s = getSettings(); const b = readBuiltIn(); return { googleClientId: s.googleClientId || b.googleClientId, googleClientSecret: s.googleClientId ? s.googleClientSecret : b.googleClientSecret, microsoftClientId: s.microsoftClientId || b.microsoftClientId, microsoftTenant: (s.microsoftClientId ? s.microsoftTenant : b.microsoftTenant) || 'common' }; }
export const oauthReady = (): Record<OAuthProvider, boolean> => { const c = oauthClients(); return { google: !!c.googleClientId && !!c.googleClientSecret, microsoft: !!c.microsoftClientId }; };
