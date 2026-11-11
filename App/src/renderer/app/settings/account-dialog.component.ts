import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { IconComponent } from '../shared/icon.component';
import { ColorPickerComponent } from '../shared/color-picker.component';
import { ConnectComponent } from './connect.component';
import { Account, AccountInput } from '../../../shared/types';
@Component({ selector: 'app-account-dialog', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent, ColorPickerComponent, ConnectComponent], templateUrl: './account-dialog.component.html', styleUrl: './account-dialog.component.css' })
export class AccountDialogComponent implements OnInit {
  readonly store = inject(StoreService);
  private bridge = inject(BridgeService);
  private translate = inject(TranslateService);
  @Input() account: Account | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Account>();
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly servers = signal(false);
  form: AccountInput = { name: '', email: '', provider: 'imap', authType: 'password', imapHost: '', imapPort: 993, imapSecure: true, smtpHost: '', smtpPort: 465, smtpSecure: true, username: '', password: '', color: '#4f94f0', signature: '', features: { mail: true, calendar: false, contacts: false } };
  isGmail = () => this.form.authType === 'password' && /(^|\.)(gmail|googlemail)\.com$/i.test(this.form.imapHost ?? '');
  ngOnInit() { const a = this.account; if (a) this.form = { name: a.name, email: a.email, provider: a.provider, authType: a.authType, imapHost: a.imapHost, imapPort: a.imapPort, imapSecure: a.imapSecure, smtpHost: a.smtpHost, smtpPort: a.smtpPort, smtpSecure: a.smtpSecure, username: a.username, password: '', color: a.color, signature: a.signature, features: { ...a.features } }; }
  async reconnect() { if (!this.account) return; this.busy.set(true); this.error.set(null); try { await this.bridge.invoke('accounts:reauth', this.account.id); this.saved.emit(this.account); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.busy.set(false); } }
  async save() { if (!this.account) return; this.error.set(null); this.busy.set(true); try { const input: Partial<AccountInput> = { ...this.form, name: this.form.name.trim() || this.form.email }; if (!input.password) delete input.password; if (this.form.authType === 'password' && this.form.password) { const t = await this.bridge.invoke('accounts:test', this.form); if (!t.ok) { this.error.set(t.error || this.translate.instant('APP.CONNECT.AUTH_FAILED')); return; } } const saved = await this.bridge.invoke('accounts:update', this.account.id, input); await this.store.reloadAccounts(); this.saved.emit(saved); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.busy.set(false); } }
}
