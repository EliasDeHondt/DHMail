import { Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { ApiError, BridgeService } from '../core/bridge.service';
import { AppStateService } from '../core/app-state.service';
import { DatePickerComponent } from '../shared/date-picker/date-picker.component';
import { IconComponent } from '../shared/icon.component';
import { AvatarComponent } from '../shared/avatar.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService, MenuItem } from '../shared/dialogs.service';
import { UndoService } from '../core/undo.service';
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
  private route = inject(ActivatedRoute);
  /** contact to show when the page opens (link from a birthday in the calendar) */
  private openId: number | null = null;
  readonly contacts = signal<Contact[]>([]);
  readonly sources = signal<ContactSource[]>([]);
  readonly sourceFilter = signal<number | null>(null);
  readonly query = signal('');
  readonly selected = signal<Contact | null>(null);
  private undo = inject(UndoService);
  /** contacts waiting to be deleted (hidden for 30 seconds, can be undone) */
  private pendingDelete = this.undo.hidden('contacts');
  /** multi-selection: click = one, Ctrl+click = add/remove, Shift+click = range, Ctrl+A = everything in the list */
  readonly picked = signal<Set<number>>(new Set());
  private anchor: number | null = null;
  readonly pickedContacts = computed(() => { const p = this.picked(); return this.filtered().filter(c => p.has(c.id)); });
  readonly loading = signal(false);
  readonly syncing = signal(false);
  readonly editing = signal<ContactInput | null>(null);
  /** where a new contact is saved: -1 = DHMail (this computer), otherwise an account's address book */
  saveTarget = -1;
  writableSources() { return this.sources().filter(s => s.kind !== 'local'); }
  readonly addingSource = signal(false);
  readonly dropTarget = signal<number | null>(null);
  readonly dragging = signal<{ kind: 'contact' | 'source'; id: number; sourceId: number } | null>(null);
  hasLocal() { return this.sources().some(s => s.kind === 'local'); }
  countFor(sourceId: number) { return this.contacts().filter(c => c.sourceId === sourceId).length; }
  // drag a contact (or a whole address book) onto another address book to copy it there
  dragContact(e: DragEvent, c: Contact) { this.dragging.set({ kind: 'contact', id: c.id, sourceId: c.sourceId ?? -1 }); e.dataTransfer?.setData('text/plain', c.displayName); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }
  dragSource(e: DragEvent, s: ContactSource) { this.dragging.set({ kind: 'source', id: s.id, sourceId: s.id }); e.dataTransfer?.setData('text/plain', s.name); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }
  endDrag() { this.dragging.set(null); this.dropTarget.set(null); }
  dragOver(e: DragEvent, s: ContactSource) { const d = this.dragging(); if (!d || d.sourceId === s.id) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; this.dropTarget.set(s.id); }
  async drop(e: DragEvent, s: ContactSource) { e.preventDefault(); const d = this.dragging(); this.endDrag(); if (!d || d.sourceId === s.id) return; if (d.kind === 'contact') { const c = this.contacts().find(x => x.id === d.id); if (c) await this.copyOne(c, s.id); } else { this.copyForm = { from: d.id, to: s.id }; await this.copyContacts(); } }
  copyForm: { from: number | null; to: number | null } = { from: null, to: null };
  async copyContacts() {
    const { from, to } = this.copyForm; if (from === null || to === null || from === to) return;
    const name = (id: number) => id === -1 ? this.translate.instant('APP.PEOPLE.LOCAL_BOOK') : this.sources().find(s => s.id === id)?.name ?? '';
    if (!await this.dialogs.confirm(this.translate.instant('APP.PEOPLE.COPY_CONFIRM', { count: this.countFor(from), from: name(from), to: name(to) }), this.translate.instant('APP.PEOPLE.COPY_START'))) return;
    this.saving.set(true);
    try { const r = await this.bridge.invoke('contacts:copy', from, to); this.toast.show(this.translate.instant('APP.PEOPLE.COPY_DONE', { created: r.created, skipped: r.skipped, failed: r.failed }), r.failed ? 'error' : 'success'); await this.load(); }
    catch (err) { const e = err as ApiError; this.toast.error(e?.code === 'CONTACTS_WRITE_CONSENT' ? this.translate.instant('APP.PEOPLE.COPY_CONSENT') : err); }
    finally { this.saving.set(false); }
  }
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly sourceForm = { name: '', url: '', username: '', password: '' };
  readonly filtered = computed(() => { const q = this.query().trim().toLowerCase(); const src = this.sourceFilter(); const gone = this.pendingDelete(); return this.contacts().filter(c => !gone.has(c.id) && (!src || c.sourceId === src) && (!q || c.displayName.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.emails.some(e => e.value.toLowerCase().includes(q)) || c.phones.some(p => p.value.includes(q)))); });
  readonly grouped = computed(() => { const out: { letter: string; items: Contact[] }[] = []; for (const c of this.filtered()) { const letter = (c.lastName || c.displayName).trim().charAt(0).toUpperCase() || '#'; const key = /[A-Z]/.test(letter) ? letter : '#'; const last = out[out.length - 1]; if (last && last.letter === key) last.items.push(c); else out.push({ letter: key, items: [c] }); } return out; });
  readonly sourceName = (id: number | null) => this.sources().find(s => s.id === id)?.name ?? '';
  private offs: (() => void)[] = [];
  constructor() { this.offs.push((() => { const sub = this.route.queryParamMap.subscribe(p => { const id = Number(p.get('contact')); if (id) { this.openId = id; this.showContact(); } }); return () => sub.unsubscribe(); })()); this.load(); this.offs.push(this.bridge.on('contacts:changed', () => this.load())); }
  ngOnDestroy() { this.offs.forEach(f => f()); }
  private showContact() { const id = this.openId; if (!id) return; const c = this.contacts().find(x => x.id === id); if (!c) return; this.openId = null; this.sourceFilter.set(null); this.query.set(''); this.select(c); queueMicrotask(() => document.querySelector('.crow--active')?.scrollIntoView({ block: 'center' })); }
  async load() { this.loading.set(true); try { const [contacts, sources] = await Promise.all([this.bridge.invoke('contacts:list'), this.bridge.invoke('contacts:sources')]); this.contacts.set(contacts); this.showContact(); this.sources.set(sources); const sel = this.selected(); if (sel) this.selected.set(contacts.find(c => c.id === sel.id) ?? null); } catch (err) { this.toast.error(err); } finally { this.loading.set(false); } }
  async sync() { this.syncing.set(true); try { this.sources.set(await this.bridge.invoke('contacts:sync')); await this.load(); } catch (err) { this.toast.error(err); } finally { this.syncing.set(false); } }
  select(c: Contact, e?: MouseEvent) {
    if (e && (e.ctrlKey || e.metaKey)) { this.picked.update(p => { const n = new Set(p); if (n.size === 0 && this.selected()) n.add(this.selected()!.id); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; }); this.anchor = c.id; this.selected.set(c); this.editing.set(null); return; }
    if (e?.shiftKey && this.anchor !== null) { const list = this.filtered(); const a = list.findIndex(x => x.id === this.anchor), b = list.findIndex(x => x.id === c.id); if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; this.picked.set(new Set(list.slice(lo, hi + 1).map(x => x.id))); } this.selected.set(c); this.editing.set(null); return; }
    this.anchor = c.id; this.picked.set(new Set([c.id])); this.selected.set(c); this.editing.set(null);
  }
  clearPicked() { this.picked.set(this.selected() ? new Set([this.selected()!.id]) : new Set()); }
  @HostListener('document:keydown', ['$event']) onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (this.editing() || this.addingSource() || document.querySelector('.overlay, app-lock-screen') || (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.picked.set(new Set(this.filtered().map(c => c.id))); }
    else if (e.key === 'Delete' && this.pickedContacts().length) { e.preventDefault(); this.removeMany(this.pickedContacts()); }
    else if (e.key === 'Escape' && this.picked().size > 1) this.clearPicked();
  }
  /** delete one or more contacts: warning first, then 30 seconds to undo before anything is removed */
  async removeMany(list: Contact[]) {
    const deletable = list.filter(c => !c.readOnly);
    if (!deletable.length) return;
    const t = (k: string, p?: any) => this.translate.instant(k, p);
    const many = deletable.length > 1;
    const sources = [...new Set(deletable.map(c => this.sourceName(c.sourceId)).filter(Boolean))].join(', ');
    const msg = many ? t('APP.PEOPLE.DELETE_MANY_CONFIRM', { count: deletable.length, sources }) : t('APP.PEOPLE.DELETE_CONFIRM', { name: deletable[0].displayName });
    if (!await this.dialogs.confirm(msg, many ? t('APP.PEOPLE.DELETE_MANY', { count: deletable.length }) : t('APP.COMMON.DELETE'), true)) return;
    const ids = deletable.map(c => c.id);
    this.picked.set(new Set()); if (this.selected() && ids.includes(this.selected()!.id)) this.selected.set(null);
    this.undo.schedule('contacts', ids, many ? t('APP.PEOPLE.DELETED_MANY', { count: ids.length }) : t('APP.PEOPLE.DELETED_ONE', { name: deletable[0].displayName }), async () => {
      const failed: string[] = [];
      for (const c of deletable) { try { await this.bridge.invoke('contacts:remove', c.id); } catch (err) { const e = err as ApiError; failed.push(e?.code === 'CONTACTS_WRITE_CONSENT' ? t('APP.PEOPLE.COPY_CONSENT') : `${c.displayName}: ${e?.message ?? err}`); } }
      if (failed.length) this.toast.error(failed[0] + (failed.length > 1 ? ` (+${failed.length - 1})` : ''));
      await this.load();
    });
  }
  mailTo(address: string) { this.state.composeTo.set(address); this.router.navigate(['/mail']); }
  openExternal(url: string) { this.bridge.invoke('app:openExternal', url).catch(() => {}); }
  newContact() { this.saveTarget = -1; this.editing.set({ displayName: '', firstName: '', lastName: '', emails: [{ value: '', label: '' }], phones: [{ value: '', label: '' }], company: '', title: '', notes: '', birthday: null }); this.error.set(null); }
  edit(c: Contact) { this.editing.set({ id: c.id, displayName: c.displayName, firstName: c.firstName, lastName: c.lastName, emails: c.emails.length ? c.emails.map(e => ({ ...e })) : [{ value: '', label: '' }], phones: c.phones.length ? c.phones.map(p => ({ ...p })) : [{ value: '', label: '' }], company: c.company, title: c.title, notes: c.notes, birthday: c.birthday }); this.error.set(null); }
  addField(list: ContactField[]) { list.push({ value: '', label: '' }); }
  removeField(list: ContactField[], i: number) { list.splice(i, 1); if (!list.length) list.push({ value: '', label: '' }); }
  async save() { const f = this.editing(); if (!f) return; const display = f.displayName.trim() || [f.firstName, f.lastName].filter(Boolean).join(' ').trim() || f.emails[0]?.value.trim(); if (!display) { this.error.set(this.translate.instant('APP.PEOPLE.NAME_REQUIRED')); return; } this.saving.set(true); try { if (!f.id && this.saveTarget !== -1) { const clean = { ...f, displayName: display, emails: f.emails.filter(e => e.value.trim()).map(e => ({ value: e.value.trim(), label: e.label })), phones: f.phones.filter(p => p.value.trim()).map(p => ({ value: p.value.trim(), label: p.label })), birthday: f.birthday || null }; await this.bridge.invoke('contacts:createIn', clean, this.saveTarget); this.editing.set(null); this.sourceFilter.set(this.saveTarget); await this.load(); this.toast.show(this.translate.instant('APP.PEOPLE.SAVED_IN', { name: this.sourceName(this.saveTarget) }), 'success'); return; } const saved = await this.bridge.invoke('contacts:save', { ...f, displayName: display, emails: f.emails.filter(e => e.value.trim()).map(e => ({ value: e.value.trim(), label: e.label })), phones: f.phones.filter(p => p.value.trim()).map(p => ({ value: p.value.trim(), label: p.label })), birthday: f.birthday || null }); this.editing.set(null); await this.load(); this.selected.set(this.contacts().find(c => c.id === saved.id) ?? saved); } catch (err) { const e = err as ApiError; this.error.set(e?.code === 'CONTACTS_WRITE_CONSENT' ? this.translate.instant('APP.PEOPLE.COPY_CONSENT') : e?.message ?? String(err)); } finally { this.saving.set(false); } }
  async copyOne(c: Contact, toId: number) { try { const r = await this.bridge.invoke('contacts:copyOne', c.id, toId); const name = toId === -1 ? this.translate.instant('APP.PEOPLE.LOCAL_BOOK') : this.sourceName(toId); if (r.created) this.toast.show(this.translate.instant('APP.PEOPLE.SAVED_IN', { name }), 'success'); else if (r.skipped) this.toast.show(this.translate.instant('APP.PEOPLE.ALREADY_IN', { name }), 'info'); else this.toast.error(r.errors[0] ?? ''); await this.load(); } catch (err) { const e = err as ApiError; this.toast.error(e?.code === 'CONTACTS_WRITE_CONSENT' ? this.translate.instant('APP.PEOPLE.COPY_CONSENT') : err); } }
  /** the number to call / WhatsApp: mobile first */
  // copying: one value, a whole contact as text, or the addresses of the picked contacts
  async copy(text: string | null | undefined, toastKey = 'APP.PEOPLE.COPIED') { const value = (text ?? '').trim(); if (!value) return; try { await this.bridge.invoke('app:copyText', value); this.toast.show(this.translate.instant(toastKey, { value: value.length > 60 ? value.slice(0, 57) + '…' : value }), 'success'); } catch (err) { this.toast.error(err); } }
  private labelOf(label: string) { const key = 'APP.PEOPLE.LABEL_' + label.toUpperCase(); const t = this.translate.instant(key); return t === key ? label : t; }
  contactText(c: Contact) { const t = (k: string) => this.translate.instant(k); const line = (label: string, value: string, sub?: string) => `${label}${sub ? ` (${this.labelOf(sub)})` : ''}: ${value}`; return [c.displayName, [c.title, c.company].filter(Boolean).join(' · '), ...c.emails.filter(e => e.value?.trim()).map(e => line(t('APP.PEOPLE.EMAIL'), e.value.trim(), e.label)), ...c.phones.filter(p => p.value?.trim()).map(p => line(t('APP.PEOPLE.PHONE'), p.value.trim(), p.label)), c.birthday ? line(t('APP.PEOPLE.BIRTHDAY'), this.birthdayLabel(c.birthday)) : '', c.notes?.trim() ? line(t('APP.PEOPLE.NOTES'), c.notes.trim()) : ''].filter(Boolean).join('\n'); }
  copyContact(c: Contact) { this.copy(this.contactText(c), 'APP.PEOPLE.COPIED_CONTACT'); }
  copyMany(list: Contact[]) { this.copy(list.map(c => this.contactText(c)).join('\n\n'), 'APP.PEOPLE.COPIED_CONTACTS'); }
  copyEmails(list: Contact[]) { const seen = new Set<string>(); const out: string[] = []; for (const c of list) for (const e of c.emails) { const v = e.value?.trim(); if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(c.displayName && c.displayName !== v ? `${c.displayName.replace(/[",;<>]/g, '')} <${v}>` : v); } } if (!out.length) { this.toast.show(this.translate.instant('APP.PEOPLE.NO_EMAILS'), 'info'); return; } this.copy(out.join('; '), 'APP.PEOPLE.COPIED_EMAILS'); }
  contactMenu(e: MouseEvent, c: Contact) { const t = (k: string) => this.translate.instant(k); const picked = this.pickedContacts(); if (picked.length > 1 && picked.some(p => p.id === c.id)) { this.dialogs.openMenu(e, [{ label: t('APP.PEOPLE.COPY_EMAILS'), icon: 'copy', action: () => this.copyEmails(picked) }, { label: t('APP.PEOPLE.COPY_CONTACTS'), icon: 'copy', action: () => this.copyMany(picked) }]); return; } const items: MenuItem[] = [{ label: t('APP.PEOPLE.COPY_CONTACT'), icon: 'copy', action: () => this.copyContact(c) }, { label: t('APP.PEOPLE.COPY_NAME'), icon: 'user', action: () => this.copy(c.displayName) }]; const emails = c.emails.filter(x => x.value?.trim()), phones = c.phones.filter(x => x.value?.trim()); if (emails.length || phones.length) items.push({ separator: true }); for (const x of emails) items.push({ label: x.value.trim(), icon: 'mail', action: () => this.copy(x.value) }); for (const x of phones) items.push({ label: x.value.trim(), icon: 'phone', action: () => this.copy(x.value) }); this.dialogs.openMenu(e, items); }
  phoneOf(c: Contact) { const list = c.phones.filter(p => p.value?.trim()); return (list.find(p => /mobi|cell|gsm|iphone/i.test(p.label || '')) ?? list[0])?.value.trim() || null; }
  /** international digits for wa.me: 0470… (Belgium) → 32470…, 0031… → 31… */
  private intl(tel: string) { let d = tel.replace(/[^\d+]/g, ''); if (d.startsWith('+')) return d.slice(1); if (d.startsWith('00')) return d.slice(2); if (d.startsWith('0')) return '32' + d.slice(1); return d; }
  call(tel: string) { this.bridge.invoke('app:openExternal', 'tel:' + tel.replace(/[^\d+]/g, '')).catch(() => {}); }
  whatsapp(tel: string, text = '') { this.bridge.invoke('app:openExternal', `https://wa.me/${this.intl(tel)}${text ? '?text=' + encodeURIComponent(text) : ''}`).catch(() => {}); }
  birthdayWish(c: Contact, tel: string) { const first = c.firstName?.trim() || c.displayName.split(' ')[0] || ''; this.whatsapp(tel, this.translate.instant('APP.PEOPLE.BIRTHDAY_TEXT', { name: first })); }
  remove(c: Contact) { this.removeMany([c]); }
  async importVcf() { try { const f = await this.bridge.invoke('app:pickFile', [{ name: 'vCard', extensions: ['vcf', 'vcard'] }]); if (!f) return; const n = await this.bridge.invoke('contacts:importVcf', f.content); this.toast.show(this.translate.instant('APP.PEOPLE.IMPORTED', { count: n }), 'success'); await this.load(); } catch (err) { this.toast.error(err); } }
  async addSource() { this.error.set(null); if (!this.sourceForm.url.trim()) { this.error.set(this.translate.instant('APP.PEOPLE.SOURCE_URL_REQUIRED')); return; } this.saving.set(true); try { this.sources.set(await this.bridge.invoke('contacts:addSource', { name: this.sourceForm.name.trim(), url: this.sourceForm.url.trim(), username: this.sourceForm.username, password: this.sourceForm.password })); this.addingSource.set(false); Object.assign(this.sourceForm, { name: '', url: '', username: '', password: '' }); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); } finally { this.saving.set(false); } }
  async removeSource(s: ContactSource) { if (s.kind === 'local' || s.kind === 'google' || s.kind === 'microsoft') return; if (!await this.dialogs.confirm(this.translate.instant('APP.PEOPLE.REMOVE_SOURCE_CONFIRM', { name: s.name }), this.translate.instant('APP.COMMON.REMOVE'), true)) return; try { this.sources.set(await this.bridge.invoke('contacts:removeSource', s.id)); if (this.sourceFilter() === s.id) this.sourceFilter.set(null); await this.load(); } catch (err) { this.toast.error(err); } }
  sourceIcon = (s: ContactSource) => s.kind === 'local' ? 'user' : s.kind === 'carddav' ? 'key' : 'globe';
  birthdayLabel = (b: string | null) => { if (!b) return ''; const m = /^(?:(\d{4})|--)?-?(\d{2})-(\d{2})$/.exec(b); if (!m) return b; const d = new Date(Number(m[1] ?? 2000), Number(m[2]) - 1, Number(m[3])); return d.toLocaleDateString(this.store.locale(), m[1] ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' }); };
}
