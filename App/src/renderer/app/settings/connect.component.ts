import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { ApiError, BridgeService } from '../core/bridge.service';
import { IconComponent } from '../shared/icon.component';
import { Account, OAuthProvider, ServerConfig } from '../../../shared/types';
type Mode = 'choose' | 'imap' | 'manual' | 'gmail-app' | 'outlook-setup';
@Component({ selector: 'app-connect', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent], templateUrl: './connect.component.html', styleUrl: './connect.component.css' })
export class ConnectComponent implements OnInit {
  private store = inject(StoreService);
  private bridge = inject(BridgeService);
  private translate = inject(TranslateService);
  @Output() connected = new EventEmitter<Account>();
  readonly mode = signal<Mode>('choose');
  readonly ready = signal<Record<OAuthProvider, boolean>>({ google: false, microsoft: false });
  readonly busy = signal<OAuthProvider | 'imap' | 'eliasdh' | null>(null);
  readonly status = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly suggest = signal<OAuthProvider | null>(null);
  email = '';
  password = '';
  servers: ServerConfig = { imapHost: '', imapPort: 993, imapSecure: true, smtpHost: '', smtpPort: 465, smtpSecure: true, username: '' };
  microsoftClientId = '';
  async ngOnInit() { this.ready.set(await this.bridge.invoke('accounts:oauthReady').catch(() => ({ google: false, microsoft: false }))); }
  t = (k: string, p?: object) => this.translate.instant(k, p);
  go(mode: Mode) { this.mode.set(mode); this.error.set(null); this.status.set(null); this.suggest.set(null); }
  readonly showOthers = signal(false);
  /** EliasDH Mail: the eliasdh.com mailboxes run on Google Workspace, so this is a Google sign-in limited to that domain */
  async eliasdh() { this.error.set(null); if (!this.ready()['google']) { this.go('gmail-app'); return; } this.busy.set('eliasdh'); this.status.set(this.t('APP.CONNECT.WAITING_BROWSER')); try { const account = await this.bridge.invoke('accounts:connect', 'google', 'eliasdh.com'); await this.store.reloadAccounts(); this.connected.emit(account); } catch (err) { this.error.set(err instanceof ApiError && err.code === 'WRONG_DOMAIN' ? this.t('APP.CONNECT.ELIASDH_WRONG') : err instanceof ApiError && err.code === 'OAUTH_DENIED' ? this.t('APP.CONNECT.DENIED') : err instanceof Error ? err.message : String(err)); } finally { this.busy.set(null); this.status.set(null); } }
  async oauth(provider: OAuthProvider) { this.error.set(null); if (!this.ready()[provider]) { this.go(provider === 'google' ? 'gmail-app' : 'outlook-setup'); return; } this.busy.set(provider); this.status.set(this.t('APP.CONNECT.WAITING_BROWSER')); try { const account = await this.bridge.invoke('accounts:connect', provider); await this.store.reloadAccounts(); this.connected.emit(account); } catch (err) { this.error.set(err instanceof ApiError && err.code === 'OAUTH_DENIED' ? this.t('APP.CONNECT.DENIED') : err instanceof Error ? err.message : String(err)); } finally { this.busy.set(null); this.status.set(null); } }
  async saveMicrosoftClient() { const id = this.microsoftClientId.trim(); if (!/^[0-9a-f-]{36}$/i.test(id)) { this.error.set(this.t('APP.CONNECT.CLIENT_ID_INVALID')); return; } await this.store.saveSettings({ microsoftClientId: id, microsoftTenant: 'common' }); this.ready.set(await this.bridge.invoke('accounts:oauthReady')); this.go('choose'); this.oauth('microsoft'); }
  async connectImap() { this.error.set(null); this.suggest.set(null); const email = this.email.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.error.set(this.t('APP.CONNECT.EMAIL_INVALID')); return; } if (!this.password) { this.error.set(this.t('APP.CONNECT.PASSWORD_REQUIRED')); return; } if (this.mode() === 'gmail-app') { await this.connectGmail(email); return; } this.busy.set('imap'); this.status.set(this.t('APP.CONNECT.SEARCHING')); try { const r = await this.bridge.invoke('accounts:discover', email, this.password); if (r.config) this.servers = { ...r.config, username: r.config.username || email }; if (r.ok && r.config) { await this.add(r.config); return; } if (r.suggest && this.mode() === 'imap') this.suggest.set(r.suggest); if (r.error === 'AUTH_FAILED') this.error.set(this.t(r.suggest === 'google' ? 'APP.CONNECT.AUTH_FAILED_GOOGLE' : r.suggest === 'microsoft' ? 'APP.CONNECT.AUTH_FAILED_MICROSOFT' : 'APP.CONNECT.AUTH_FAILED')); else { this.error.set(this.t('APP.CONNECT.NOT_FOUND')); if (!this.servers.username) this.servers.username = email; this.mode.set('manual'); } } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.busy.set(null); this.status.set(null); } }
  private async connectGmail(email: string) { this.password = this.password.replace(/\s+/g, ''); this.servers = { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, username: email }; this.busy.set('imap'); this.status.set(this.t('APP.CONNECT.TESTING')); try { const r = await this.bridge.invoke('accounts:test', this.input(this.servers)); if (!r.ok) { this.error.set(/auth|credential|password|login/i.test(r.error ?? '') ? this.t('APP.CONNECT.AUTH_FAILED_GOOGLE') : r.error || this.t('APP.CONNECT.AUTH_FAILED_GOOGLE')); return; } await this.add(this.servers, { mail: true, calendar: true, contacts: true }); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.busy.set(null); this.status.set(null); } }
  async connectManual() { this.error.set(null); this.busy.set('imap'); this.status.set(this.t('APP.CONNECT.TESTING')); try { const input = this.input(this.servers); const r = await this.bridge.invoke('accounts:test', input); if (!r.ok) { this.error.set(r.error || this.t('APP.CONNECT.AUTH_FAILED')); return; } await this.add(this.servers); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.busy.set(null); this.status.set(null); } }
  private input(c: ServerConfig) { const email = this.email.trim(); return { ...c, username: c.username || email, name: email, email, provider: 'imap' as const, authType: 'password' as const, password: this.password, color: '#4f94f0', signature: '', features: { mail: true, calendar: false, contacts: false } }; }
  private async add(c: ServerConfig, features?: { mail: boolean; calendar: boolean; contacts: boolean }) { const palette = ['#4f94f0', '#0f54ae', '#829ec2', '#3d587b', '#2a78d6', '#14b8a6']; const account = await this.bridge.invoke('accounts:add', { ...this.input(c), ...(features ? { features } : {}), color: palette[this.store.accounts().length % palette.length] }); await this.store.reloadAccounts(); this.connected.emit(account); }
  open(url: string) { this.bridge.invoke('app:openExternal', url).catch(() => {}); }
}
