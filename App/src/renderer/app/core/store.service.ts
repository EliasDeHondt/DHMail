import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BridgeService } from './bridge.service';
import { ThemeService } from './theme.service';
import { Account, AccountStatus, Calendar, Category, Folder, Settings, SpecialUse, SyncState } from '../../../shared/types';
export const DEFAULT_SETTINGS: Settings = { theme: 'system', language: 'nl', blockRemoteImages: true, notifications: true, markReadDelaySeconds: 2, syncIntervalMinutes: 2, weekStartsOn: 1, workDayStart: 8, workDayEnd: 18, googleClientId: '', googleClientSecret: '', microsoftClientId: '', microsoftTenant: 'common', defaultAccountId: null, darkMailBodies: true, autoLockMinutes: 30 };
@Injectable({ providedIn: 'root' })
export class StoreService {
  private bridge = inject(BridgeService);
  private theme = inject(ThemeService);
  private translate = inject(TranslateService);
  readonly ready = signal(false);
  readonly accounts = signal<Account[]>([]);
  readonly folders = signal<Record<number, Folder[]>>({});
  readonly categories = signal<Category[]>([]);
  readonly calendars = signal<Calendar[]>([]);
  readonly settings = signal<Settings>(DEFAULT_SETTINGS);
  readonly statuses = signal<Record<number, AccountStatus>>({});
  readonly syncState = signal<SyncState | null>(null);
  readonly mailAccounts = computed(() => this.accounts().filter(a => a.features.mail));
  readonly unreadTotal = computed(() => Object.values(this.folders()).flat().filter(f => f.specialUse === 'inbox').reduce((n, f) => n + f.unseen, 0));
  readonly locale = computed(() => this.settings().language === 'nl' ? 'nl-BE' : 'en-GB');
  async init() { if (this.ready()) return; const [settings, accounts, categories, calendars, statuses] = await Promise.all([this.bridge.invoke('settings:get'), this.bridge.invoke('accounts:list'), this.bridge.invoke('categories:list'), this.bridge.invoke('calendar:list'), this.bridge.invoke('accounts:status')]); this.applySettings(settings); this.accounts.set(accounts); this.categories.set(categories); this.calendars.set(calendars); this.statuses.set(Object.fromEntries(statuses.map(s => [s.accountId, s]))); await Promise.all(accounts.map(a => this.loadFolders(a.id))); this.bridge.on('mail:counts', folders => { if (folders.length) this.folders.update(f => ({ ...f, [folders[0].accountId]: folders })); }); this.bridge.on('account:status', s => this.statuses.update(m => ({ ...m, [s.accountId]: s }))); this.bridge.on('calendar:changed', () => this.reloadCalendars()); this.bridge.on('sync:state', s => this.syncState.set(s.busy ? s : null)); this.ready.set(true); }
  applySettings(s: Settings) { this.settings.set(s); this.theme.set(s.theme); this.translate.use(s.language); document.documentElement.lang = s.language; }
  async saveSettings(patch: Partial<Settings>) { this.applySettings(await this.bridge.invoke('settings:set', patch)); }
  async loadFolders(accountId: number) { const folders = await this.bridge.invoke('mail:folders', accountId).catch(() => [] as Folder[]); this.folders.update(f => ({ ...f, [accountId]: folders })); return folders; }
  async reloadAccounts() { this.accounts.set(await this.bridge.invoke('accounts:list')); for (const a of this.accounts()) if (!this.folders()[a.id]) await this.loadFolders(a.id); }
  async reloadCategories() { this.categories.set(await this.bridge.invoke('categories:list')); }
  async reloadCalendars() { this.calendars.set(await this.bridge.invoke('calendar:list')); }
  account = (id: number | null | undefined) => this.accounts().find(a => a.id === id) ?? null;
  folder = (id: number | null | undefined) => Object.values(this.folders()).flat().find(f => f.id === id) ?? null;
  special = (accountId: number, special: SpecialUse) => (this.folders()[accountId] ?? []).find(f => f.specialUse === special) ?? null;
  category = (id: number) => this.categories().find(c => c.id === id) ?? null;
}
