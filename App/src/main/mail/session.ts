/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { ImapFlow } from 'imapflow';
import { Account, AccountState, AccountStatus } from '../../shared/types';
import { getSecret } from '../core/secrets';
import { getAccessToken, OAuthError } from '../accounts/oauth';
import { bus, log } from '../core/bus';
export type Lane = 'main' | 'bg' | 'watch';
interface Entry { client: ImapFlow | null; connecting: Promise<ImapFlow> | null; inUse: number; lastUsed: number; timer: NodeJS.Timeout | null; }
const IDLE_CLOSE_MS: Record<Lane, number> = { main: 10 * 60 * 1000, bg: 2 * 60 * 1000, watch: Infinity };
export class ImapSession {
  private lanes = new Map<Lane, Entry>();
  private closed = false;
  private watchTimer: NodeJS.Timeout | null = null;
  private watchBackoff = 5000;
  status: AccountStatus;
  onInboxChange: (() => void) | null = null;
  constructor(public account: Account) { this.status = { accountId: account.id, state: 'idle' }; }
  setStatus(state: AccountState, message?: string) { if (this.status.state === state && this.status.message === message) return; this.status = { accountId: this.account.id, state, message }; bus.emitEvent('account:status', this.status); }
  private async auth(force = false) { const a = this.account; if (a.authType === 'oauth') return { user: a.username, accessToken: await getAccessToken(a.id, a.provider, 'mail', force) }; return { user: a.username, pass: getSecret(`account:${a.id}:password`) ?? '' }; }
  private async connect(force = false): Promise<ImapFlow> { const a = this.account; const client = new ImapFlow({ host: a.imapHost, port: a.imapPort, secure: a.imapSecure, auth: await this.auth(force), logger: false, connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 10 * 60 * 1000, clientInfo: { name: 'DHMail', version: '1.0.0' } }); client.on('error', (err: any) => log('imap error', a.email, err?.message)); await client.connect(); return client; }
  private drop(lane: Lane, entry: Entry, graceful = false) { if (this.lanes.get(lane) !== entry) return; this.lanes.delete(lane); if (entry.timer) clearTimeout(entry.timer); const c = entry.client; if (!c) return; if (graceful) c.logout().catch(() => c.close()); else c.close(); }
  private scheduleClose(lane: Lane, entry: Entry) { if (entry.timer) clearTimeout(entry.timer); const ms = IDLE_CLOSE_MS[lane]; if (!isFinite(ms)) return; entry.timer = setTimeout(() => { if (entry.inUse > 0) return this.scheduleClose(lane, entry); this.drop(lane, entry, true); }, ms); entry.timer.unref(); }
  private async client(lane: Lane, forceFresh = false, forceToken = false): Promise<ImapFlow> { const existing = this.lanes.get(lane); if (existing && forceFresh) this.drop(lane, existing); else if (existing) { if (existing.connecting) return existing.connecting; if (existing.client?.usable) { existing.lastUsed = Date.now(); this.scheduleClose(lane, existing); return existing.client; } this.drop(lane, existing); } const entry: Entry = { client: null, connecting: null, inUse: 0, lastUsed: Date.now(), timer: null }; this.setStatus('connecting'); entry.connecting = this.connect(forceToken).then(client => { entry.client = client; entry.connecting = null; client.on('close', () => this.drop(lane, entry)); client.on('error', () => this.drop(lane, entry)); this.scheduleClose(lane, entry); this.setStatus('online'); return client; }).catch(err => { if (this.lanes.get(lane) === entry) this.lanes.delete(lane); this.setStatus('error', describe(err)); throw err; }); this.lanes.set(lane, entry); return entry.connecting; }
  async withClient<T>(lane: Lane, fn: (c: ImapFlow) => Promise<T>, timeoutMs = 90_000): Promise<T> { let lastError: any; for (let attempt = 0; attempt < 2; attempt++) { let c: ImapFlow; try { c = await this.client(lane, attempt > 0, attempt > 0 && isAuthError(lastError)); } catch (err) { lastError = err; if (err instanceof OAuthError && err.code !== 'OAUTH_FAILED') throw err; if (isAuthError(err) && this.account.authType !== 'oauth') throw err; continue; } const entry = this.lanes.get(lane); if (entry?.client === c) entry.inUse++; try { return await withTimeout(fn(c), timeoutMs); } catch (err: any) { if (err?.code === 'NOT_FOUND' || err?.status) throw err; const cur = this.lanes.get(lane); if (cur?.client === c && (!c.usable || err?.code === 'IMAP_TIMEOUT' || /socket|ECONN|closed|timeout/i.test(err?.message ?? ''))) this.drop(lane, cur); lastError = err; if (c.usable && !isAuthError(err) && !/socket|ECONN|closed|timeout/i.test(err?.message ?? '')) throw err; log('imap retry', this.account.email, lane, err?.message); } finally { if (entry?.client === c) { entry.inUse = Math.max(0, entry.inUse - 1); entry.lastUsed = Date.now(); } } } throw lastError; }
  async startWatch() { if (this.closed || !this.account.features.mail) return; if (this.watchTimer) { clearTimeout(this.watchTimer); this.watchTimer = null; } try { const c = await this.client('watch'); await c.mailboxOpen('INBOX'); const trigger = () => this.onInboxChange?.(); c.on('exists', trigger); c.on('expunge', trigger); c.on('flags', trigger); c.on('close', () => { if (!this.closed) this.retryWatch(); }); this.watchBackoff = 5000; } catch (err: any) { log('watch failed', this.account.email, err?.message); if (!this.closed) this.retryWatch(); } }
  private retryWatch() { if (this.watchTimer) return; this.watchTimer = setTimeout(() => { this.watchTimer = null; this.startWatch(); }, this.watchBackoff); this.watchBackoff = Math.min(this.watchBackoff * 2, 5 * 60 * 1000); }
  async close() { this.closed = true; if (this.watchTimer) clearTimeout(this.watchTimer); for (const [lane, entry] of [...this.lanes]) { if (entry.connecting) await entry.connecting.catch(() => {}); this.drop(lane, entry, true); } }
  reset() { for (const [lane, entry] of [...this.lanes]) this.drop(lane, entry); }
}
export const isAuthError = (err: any) => !!err && (err.authenticationFailed || err.code === 'OAUTH_REAUTH' || /AUTHENTICATIONFAILED|authentication|invalid credentials|login failed/i.test(err.message ?? ''));
export const describe = (err: any) => { if (!err) return 'Unknown error'; if (err instanceof OAuthError) return err.message; if (err.authenticationFailed || isAuthError(err)) return 'Authentication failed'; return err.responseText || err.message || String(err); };
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> { let t: NodeJS.Timeout; const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error('The mail server did not answer in time'), { code: 'IMAP_TIMEOUT' })), ms); }); return Promise.race([p, timeout]).finally(() => clearTimeout(t)); }