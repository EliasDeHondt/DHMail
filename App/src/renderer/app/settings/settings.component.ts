import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { IconComponent } from '../shared/icon.component';
import { LockService } from '../core/lock.service';
import { LogoComponent } from '../shared/logo.component';
import { ColorPickerComponent } from '../shared/color-picker.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService } from '../shared/dialogs.service';
import { AccountDialogComponent } from './account-dialog.component';
import { SignaturesComponent } from './signatures.component';
import { CalendarDialogComponent } from '../calendar/calendar-dialog.component';
import { Account, AppInfo, Calendar, Category, Settings } from '../../../shared/types';
type Tab = 'accounts' | 'signatures' | 'calendars' | 'categories' | 'general' | 'about';
@Component({ selector: 'app-settings', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent, LogoComponent, ColorPickerComponent, AccountDialogComponent, CalendarDialogComponent, SignaturesComponent], templateUrl: './settings.component.html', styleUrl: './settings.component.css' })
export class SettingsComponent implements OnDestroy {
  readonly store = inject(StoreService);
  readonly lock = inject(LockService);
  readonly lockOptions = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);
  private bridge = inject(BridgeService);
  private toast = inject(ToastService);
  private dialogs = inject(DialogsService);
  private translate = inject(TranslateService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly tab = signal<Tab>('accounts');
  readonly tabs: Tab[] = ['accounts', 'signatures', 'calendars', 'categories', 'general', 'about'];
  readonly editing = signal<Account | null | 'new'>(null);
  readonly addingCalendar = signal(false);
  readonly info = signal<AppInfo | null>(null);
  readonly newCategory = signal<{ name: string; color: string } | null>(null);
  readonly editingCategory = signal<Category | null>(null);
  readonly busy = signal<number | null>(null);
  general: Partial<Settings> = {};
  private sub = this.route.queryParamMap.subscribe(p => { const t = p.get('tab') as Tab | null; if (t && this.tabs.includes(t)) this.tab.set(t); });
  constructor() { const s = this.store.settings(); this.general = { autoLockMinutes: s.autoLockMinutes, theme: s.theme, language: s.language, notifications: s.notifications, blockRemoteImages: s.blockRemoteImages, darkMailBodies: s.darkMailBodies, markReadDelaySeconds: s.markReadDelaySeconds, syncIntervalMinutes: s.syncIntervalMinutes, weekStartsOn: s.weekStartsOn, workDayStart: s.workDayStart, workDayEnd: s.workDayEnd, defaultAccountId: s.defaultAccountId }; this.bridge.invoke('app:info').then(i => this.info.set(i)).catch(() => {}); }
  ngOnDestroy() { this.sub.unsubscribe(); }
  setTab(t: Tab) { this.tab.set(t); this.router.navigate([], { queryParams: { tab: t }, replaceUrl: true }); }
  status = (id: number) => this.store.statuses()[id] ?? null;
  providerLabel = (a: Account) => this.translate.instant('APP.SETTINGS.PROVIDER_' + a.provider.toUpperCase());
  async removeAccount(a: Account) { if (!await this.dialogs.confirm(this.translate.instant('APP.SETTINGS.REMOVE_ACCOUNT_CONFIRM', { email: a.email }), this.translate.instant('APP.COMMON.REMOVE'), true)) return; this.busy.set(a.id); try { await this.bridge.invoke('accounts:remove', a.id); await this.store.reloadAccounts(); this.store.folders.update(f => { const n = { ...f }; delete n[a.id]; return n; }); await this.store.reloadCalendars(); if (!this.store.accounts().length) this.router.navigate(['/welcome']); } catch (err) { this.toast.error(err); } finally { this.busy.set(null); } }
  async reauth(a: Account) { this.busy.set(a.id); try { await this.bridge.invoke('accounts:reauth', a.id); this.toast.show(this.translate.instant('APP.SETTINGS.REAUTH_OK'), 'success'); } catch (err) { this.toast.error(err); } finally { this.busy.set(null); } }
  reconnect(a: Account) { this.bridge.invoke('accounts:reconnect', a.id).catch(err => this.toast.error(err)); }
  lockLabel(minutes: number) { if (minutes < 60) return this.translate.instant('APP.SETTINGS.AUTO_LOCK_MINUTES', { count: minutes }); const h = minutes / 60; return this.translate.instant(h === 1 ? 'APP.SETTINGS.AUTO_LOCK_HOUR' : 'APP.SETTINGS.AUTO_LOCK_HOURS', { count: h.toLocaleString(this.store.locale()) }); }
  async saveGeneral() { try { await this.store.saveSettings({ ...this.general, autoLockMinutes: Math.min(480, Math.max(30, Number(this.general.autoLockMinutes ?? 30))), markReadDelaySeconds: Number(this.general.markReadDelaySeconds ?? 0), syncIntervalMinutes: Math.max(1, Number(this.general.syncIntervalMinutes ?? 2)), weekStartsOn: Number(this.general.weekStartsOn ?? 1), workDayStart: Number(this.general.workDayStart ?? 8), workDayEnd: Number(this.general.workDayEnd ?? 18), defaultAccountId: this.general.defaultAccountId ? Number(this.general.defaultAccountId) : null }); this.toast.show(this.translate.instant('APP.SETTINGS.SAVED'), 'success'); } catch (err) { this.toast.error(err); } }
  async saveCategory(c: { id?: number; name: string; color: string }) { try { this.store.categories.set(await this.bridge.invoke('categories:save', c)); this.newCategory.set(null); this.editingCategory.set(null); } catch (err) { this.toast.error(err); } }
  async removeCategory(c: Category) { if (!await this.dialogs.confirm(this.translate.instant('APP.SETTINGS.DELETE_CATEGORY_CONFIRM', { name: c.name }), this.translate.instant('APP.COMMON.DELETE'), true)) return; try { this.store.categories.set(await this.bridge.invoke('categories:remove', c.id)); } catch (err) { this.toast.error(err); } }
  async removeCalendar(c: Calendar) { if (!await this.dialogs.confirm(this.translate.instant('APP.CALENDAR.REMOVE_CONFIRM', { name: c.name }), this.translate.instant('APP.COMMON.REMOVE'), true)) return; try { this.store.calendars.set(await this.bridge.invoke('calendar:remove', c.id)); } catch (err) { this.toast.error(err); } }
  async syncCalendar(c: Calendar) { this.busy.set(c.id); try { this.store.calendars.set(await this.bridge.invoke('calendar:sync', c.id)); } catch (err) { this.toast.error(err); } finally { this.busy.set(null); } }
  lastSync = (iso: string | null) => iso ? new Date(iso).toLocaleString(this.store.locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : this.translate.instant('APP.SETTINGS.NEVER');
  readonly accountCalendars = computed(() => this.store.calendars());
}
