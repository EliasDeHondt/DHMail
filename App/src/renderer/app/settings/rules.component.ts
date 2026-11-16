/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { IconComponent } from '../shared/icon.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService } from '../shared/dialogs.service';
import { Folder, MailRule, RuleActions, RuleCondition, RuleField } from '../../../shared/types';

interface Draft { id?: number; name: string; accountId: number | null; enabled: boolean; matchAll: boolean; conditions: RuleCondition[]; actions: RuleActions; stop: boolean; }

// Settings → Rules: new mail in the inbox that matches a rule is moved, labelled, marked as read, …
@Component({ selector: 'app-rules', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent], templateUrl: './rules.component.html', styleUrl: './rules.component.css' })
export class RulesComponent implements OnDestroy {
  readonly store = inject(StoreService);
  private bridge = inject(BridgeService);
  private translate = inject(TranslateService);
  private toast = inject(ToastService);
  private dialogs = inject(DialogsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly fields: RuleField[] = ['from', 'to', 'subject'];
  readonly rules = signal<MailRule[]>([]);
  readonly draft = signal<Draft | null>(null);
  readonly saving = signal(false);
  readonly running = signal<number | 'all' | null>(null);
  readonly mailAccounts = computed(() => this.store.mailAccounts());
  private sub = this.route.queryParamMap.subscribe(p => { const from = p.get('ruleFrom'); if (!from) return; const account = Number(p.get('ruleAccount')) || null; this.open(this.blank(account, [{ field: 'from', value: from }])); this.router.navigate([], { queryParams: { tab: 'rules' }, replaceUrl: true }); });
  constructor() { this.bridge.invoke('rules:list').then(r => this.rules.set(r), err => this.toast.error(err)); }
  ngOnDestroy() { this.sub.unsubscribe(); }

  private blank(accountId: number | null = null, conditions: RuleCondition[] = [{ field: 'from', value: '' }]): Draft { return { name: '', accountId, enabled: true, matchAll: true, conditions, actions: { destination: 'none', folderPath: null, categoryIds: [], markRead: false, flag: false }, stop: false }; }
  create() { this.open(this.blank()); }
  edit(r: MailRule) { this.open({ id: r.id, name: r.name, accountId: r.accountId, enabled: r.enabled, matchAll: r.matchAll, conditions: r.conditions.map(c => ({ ...c })), actions: { ...r.actions, categoryIds: [...r.actions.categoryIds] }, stop: r.stop }); }
  private open(d: Draft) { this.draft.set(d); }
  cancel() { this.draft.set(null); }
  touch() { const d = this.draft(); if (d) this.draft.set({ ...d }); }

  addCondition() { const d = this.draft(); if (!d) return; d.conditions = [...d.conditions, { field: 'from', value: '' }]; this.touch(); }
  removeCondition(i: number) { const d = this.draft(); if (!d || d.conditions.length < 2) return; d.conditions = d.conditions.filter((_, j) => j !== i); this.touch(); }
  accountChanged() { const d = this.draft(); if (!d) return; if (d.actions.destination === 'folder' && !this.folders(d.accountId).some(f => f.path === d.actions.folderPath)) { d.actions.folderPath = null; if (!d.accountId) d.actions.destination = 'none'; } this.touch(); }
  /** one select for "where does it go": a fixed place, or a folder of the chosen mailbox ("folder:<path>") */
  destinationValue(d: Draft) { return d.actions.destination === 'folder' ? 'folder:' + (d.actions.folderPath ?? '') : d.actions.destination; }
  setDestination(d: Draft, value: string) { if (value.startsWith('folder:')) { d.actions.destination = 'folder'; d.actions.folderPath = value.slice(7); } else { d.actions.destination = value as RuleActions['destination']; d.actions.folderPath = null; } this.touch(); }
  folders(accountId: number | null): Folder[] { if (!accountId) return []; return (this.store.folders()[accountId] ?? []).filter(f => f.selectable && !f.specialUse); }
  folderIndent = (f: Folder) => '  '.repeat(Math.max(0, f.depth)) + f.name;
  toggleCategory(id: number) { const d = this.draft(); if (!d) return; const list = d.actions.categoryIds; d.actions.categoryIds = list.includes(id) ? list.filter(x => x !== id) : [...list, id]; this.touch(); }
  hasAction(d: Draft) { return d.actions.destination !== 'none' || d.actions.categoryIds.length > 0 || d.actions.markRead || d.actions.flag; }
  hasCondition(d: Draft) { return d.conditions.some(c => c.value.trim()); }

  async save(runAfter = false) {
    const d = this.draft(); if (!d) return;
    if (!this.hasCondition(d)) { this.toast.show(this.translate.instant('APP.RULES.NEED_CONDITION'), 'error'); return; }
    if (!this.hasAction(d)) { this.toast.show(this.translate.instant('APP.RULES.NEED_ACTION'), 'error'); return; }
    this.saving.set(true);
    try {
      const before = new Set(this.rules().map(r => r.id));
      const rules = await this.bridge.invoke('rules:save', d); this.rules.set(rules);
      const saved = d.id ?? rules.find(r => !before.has(r.id))?.id;
      this.draft.set(null);
      this.toast.show(this.translate.instant('APP.RULES.SAVED'), 'success');
      if (runAfter && saved) await this.run(saved);
    } catch (err) { this.toast.error(err); } finally { this.saving.set(false); }
  }
  async remove(r: MailRule) { if (!await this.dialogs.confirm(this.translate.instant('APP.RULES.REMOVE_CONFIRM', { name: r.name }), this.translate.instant('APP.COMMON.REMOVE'), true)) return; try { this.rules.set(await this.bridge.invoke('rules:remove', r.id)); if (this.draft()?.id === r.id) this.cancel(); } catch (err) { this.toast.error(err); } }
  async toggle(r: MailRule) { try { this.rules.set(await this.bridge.invoke('rules:save', { ...r, enabled: !r.enabled })); } catch (err) { this.toast.error(err); } }
  async move(r: MailRule, step: number) { const list = [...this.rules()]; const i = list.findIndex(x => x.id === r.id), j = i + step; if (i < 0 || j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; this.rules.set(list); try { this.rules.set(await this.bridge.invoke('rules:reorder', list.map(x => x.id))); } catch (err) { this.toast.error(err); } }
  async run(id: number | null) {
    this.running.set(id ?? 'all');
    try { const res = await this.bridge.invoke('rules:run', id); this.toast.show(this.translate.instant(res.matched ? 'APP.RULES.RUN_DONE' : 'APP.RULES.RUN_NONE', { matched: res.matched, checked: res.checked }), 'success'); }
    catch (err) { this.toast.error(err); } finally { this.running.set(null); }
  }

  // the summary under a rule's name
  mailbox = (accountId: number | null) => accountId ? this.store.account(accountId)?.email ?? '?' : this.translate.instant('APP.RULES.ALL_MAILBOXES');
  conditionText(r: MailRule) { const t = (k: string, p?: any) => this.translate.instant(k, p); return r.conditions.map(c => t('APP.RULES.WHEN_' + c.field.toUpperCase(), { value: c.value })).join(r.matchAll ? t('APP.RULES.AND') : t('APP.RULES.OR')); }
  actionText(r: MailRule) {
    const t = (k: string, p?: any) => this.translate.instant(k, p); const a = r.actions; const out: string[] = [];
    if (a.destination === 'folder') out.push(t('APP.RULES.DO_FOLDER', { folder: this.folderName(r.accountId, a.folderPath) }));
    else if (a.destination !== 'none') out.push(t('APP.RULES.DO_' + a.destination.toUpperCase()));
    const cats = a.categoryIds.map(id => this.store.category(id)?.name).filter(Boolean);
    if (cats.length) out.push(t('APP.RULES.DO_CATEGORY', { names: cats.join(', ') }));
    if (a.markRead) out.push(t('APP.RULES.DO_READ'));
    if (a.flag) out.push(t('APP.RULES.DO_FLAG'));
    if (r.stop) out.push(t('APP.RULES.DO_STOP'));
    return out.join(' · ');
  }
  private folderName(accountId: number | null, path: string | null) { const f = accountId ? (this.store.folders()[accountId] ?? []).find(x => x.path === path) : null; return f?.name ?? path ?? '?'; }
}