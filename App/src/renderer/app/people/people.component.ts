import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { AppStateService } from '../core/app-state.service';
import { DatePickerComponent } from '../shared/date-picker/date-picker.component';
import { IconComponent } from '../shared/icon.component';
import { AvatarComponent } from '../shared/avatar.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService } from '../shared/dialogs.service';
import { Contact, ContactField, ContactInput, ContactSource } from '../../../shared/types';
@Component({ selector: 'app-people', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent, AvatarComponent, DatePickerComponent], templateUrl: './people.component.html', styleUrl: './people.component.css' })
export class PeopleComponent implements OnDestroy {
  readonly store = inject(StoreService);
  readonly state = inject(AppStateService);
  private bridge = inject(BridgeService);
  private toast = inject(ToastService);
  private dialogs = inject(DialogsService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  readonly contacts = signal<Contact[]>([]);
  readonly sources = signal<ContactSource[]>([]);
  readonly sourceFilter = signal<number | null>(null);
  readonly query = signal('');
  readonly selected = signal<Contact | null>(null);
  readonly loading = signal(false);
  readonly syncing = signal(false);
  readonly editing = signal<ContactInput | null>(null);
  readonly addingSource = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly sourceForm = { name: '', url: '', username: '', password: '' };
  readonly filtered = computed(() => { const q = this.query().trim().toLowerCase(); const src = this.sourceFilter(); return this.contacts().filter(c => (!src || c.sourceId === src) && (!q || c.displayName.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.emails.some(e => e.value.toLowerCase().includes(q)) || c.phones.some(p => p.value.includes(q)))); });
  readonly grouped = computed(() => { const out: { letter: string; items: Contact[] }[] = []; for (const c of this.filtered()) { const letter = (c.lastName || c.displayName).trim().charAt(0).toUpperCase() || '#'; const key = /[A-Z]/.test(letter) ? letter : '#'; const last = out[out.length - 1]; if (last && last.letter === key) last.items.push(c); else out.push({ letter: key, items: [c] }); } return out; });
  readonly sourceName = (id: number | null) => this.sources().find(s => s.id === id)?.name ?? '';
  private offs: (() => void)[] = [];
  constructor() { this.load(); this.offs.push(this.bridge.on('contacts:changed', () => this.load())); }
  ngOnDestroy() { this.offs.forEach(f => f()); }
  async load() { this.loading.set(true); try { const [contacts, sources] = await Promise.all([this.bridge.invoke('contacts:list'), this.bridge.invoke('contacts:sources')]); this.contacts.set(contacts); this.sources.set(sources); const sel = this.selected(); if (sel) this.selected.set(contacts.find(c => c.id === sel.id) ?? null); } catch (err) { this.toast.error(err); } finally { this.loading.set(false); } }
  async sync() { this.syncing.set(true); try { this.sources.set(await this.bridge.invoke('contacts:sync')); await this.load(); } catch (err) { this.toast.error(err); } finally { this.syncing.set(false); } }
  select(c: Contact) { this.selected.set(c); this.editing.set(null); }
  mailTo(address: string) { this.state.composeTo.set(address); this.router.navigate(['/mail']); }
  openExternal(url: string) { this.bridge.invoke('app:openExternal', url).catch(() => {}); }
  newContact() { this.editing.set({ displayName: '', firstName: '', lastName: '', emails: [{ value: '', label: '' }], phones: [{ value: '', label: '' }], company: '', title: '', notes: '', birthday: null }); this.error.set(null); }
  edit(c: Contact) { this.editing.set({ id: c.id, displayName: c.displayName, firstName: c.firstName, lastName: c.lastName, emails: c.emails.length ? c.emails.map(e => ({ ...e })) : [{ value: '', label: '' }], phones: c.phones.length ? c.phones.map(p => ({ ...p })) : [{ value: '', label: '' }], company: c.company, title: c.title, notes: c.notes, birthday: c.birthday }); this.error.set(null); }
  addField(list: ContactField[]) { list.push({ value: '', label: '' }); }
  removeField(list: ContactField[], i: number) { list.splice(i, 1); if (!list.length) list.push({ value: '', label: '' }); }
  async save() { const f = this.editing(); if (!f) return; const display = f.displayName.trim() || [f.firstName, f.lastName].filter(Boolean).join(' ').trim() || f.emails[0]?.value.trim(); if (!display) { this.error.set(this.translate.instant('APP.PEOPLE.NAME_REQUIRED')); return; } this.saving.set(true); try { const saved = await this.bridge.invoke('contacts:save', { ...f, displayName: display, emails: f.emails.filter(e => e.value.trim()).map(e => ({ value: e.value.trim(), label: e.label })), phones: f.phones.filter(p => p.value.trim()).map(p => ({ value: p.value.trim(), label: p.label })), birthday: f.birthday || null }); this.editing.set(null); await this.load(); this.selected.set(this.contacts().find(c => c.id === saved.id) ?? saved); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.saving.set(false); } }
  async remove(c: Contact) { if (!await this.dialogs.confirm(this.translate.instant('APP.PEOPLE.DELETE_CONFIRM', { name: c.displayName }), this.translate.instant('APP.COMMON.DELETE'), true)) return; try { await this.bridge.invoke('contacts:remove', c.id); this.selected.set(null); await this.load(); } catch (err) { this.toast.error(err); } }
  async importVcf() { try { const f = await this.bridge.invoke('app:pickFile', [{ name: 'vCard', extensions: ['vcf', 'vcard'] }]); if (!f) return; const n = await this.bridge.invoke('contacts:importVcf', f.content); this.toast.show(this.translate.instant('APP.PEOPLE.IMPORTED', { count: n }), 'success'); await this.load(); } catch (err) { this.toast.error(err); } }
  async addSource() { this.error.set(null); if (!this.sourceForm.url.trim()) { this.error.set(this.translate.instant('APP.PEOPLE.SOURCE_URL_REQUIRED')); return; } this.saving.set(true); try { this.sources.set(await this.bridge.invoke('contacts:addSource', { name: this.sourceForm.name.trim(), url: this.sourceForm.url.trim(), username: this.sourceForm.username, password: this.sourceForm.password })); this.addingSource.set(false); Object.assign(this.sourceForm, { name: '', url: '', username: '', password: '' }); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.saving.set(false); } }
  async removeSource(s: ContactSource) { if (s.kind === 'local' || s.kind === 'google' || s.kind === 'microsoft') return; if (!await this.dialogs.confirm(this.translate.instant('APP.PEOPLE.REMOVE_SOURCE_CONFIRM', { name: s.name }), this.translate.instant('APP.COMMON.REMOVE'), true)) return; try { this.sources.set(await this.bridge.invoke('contacts:removeSource', s.id)); if (this.sourceFilter() === s.id) this.sourceFilter.set(null); await this.load(); } catch (err) { this.toast.error(err); } }
  sourceIcon = (s: ContactSource) => s.kind === 'local' ? 'user' : s.kind === 'carddav' ? 'key' : 'globe';
  birthdayLabel = (b: string | null) => { if (!b) return ''; const m = /^(?:(\d{4})|--)?-?(\d{2})-(\d{2})$/.exec(b); if (!m) return b; const d = new Date(Number(m[1] ?? 2000), Number(m[2]) - 1, Number(m[3])); return d.toLocaleDateString(this.store.locale(), m[1] ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' }); };
}
