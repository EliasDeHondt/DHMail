/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Address, MailRule, MessageRef, MessageSummary, RuleActions, RuleCondition, RuleDestination, RuleField, RuleRunResult } from '../../shared/types';
import { all, get, json, lastId, run, tx } from '../core/db';
import { log } from '../core/bus';
import { listAccounts } from '../accounts/accounts';
import { archiveMessages, deleteMessages, junkMessages, moveMessages, setFlags, specialFolder, summaries } from './sync';
import { categorize } from './categories';
const FIELDS: RuleField[] = ['from', 'to', 'subject'];
const DESTINATIONS: RuleDestination[] = ['none', 'folder', 'archive', 'junk', 'trash'];
const NO_ACTIONS: RuleActions = { destination: 'none', folderPath: null, categoryIds: [], markRead: false, flag: false };
const map = (r: any): MailRule => ({ id: r.id, name: r.name, accountId: r.account_id, enabled: !!r.enabled, matchAll: !!r.match_all, conditions: json<RuleCondition[]>(r.conditions, []), actions: { ...NO_ACTIONS, ...json<Partial<RuleActions>>(r.actions, {}) }, stop: !!r.stop, sortOrder: r.sort_order });
export const listRules = (): MailRule[] => all('SELECT * FROM mail_rules ORDER BY sort_order, id').map(map);
function clean(rule: Partial<MailRule>) {
  const conditions = (rule.conditions ?? []).filter(c => FIELDS.includes(c?.field) && String(c?.value ?? '').trim()).map(c => ({ field: c.field, value: String(c.value).trim() }));
  if (!conditions.length) throw Object.assign(new Error('A rule needs at least one condition'), { status: 400 });
  const a = { ...NO_ACTIONS, ...(rule.actions ?? {}) };
  const accountId = rule.accountId ? Number(rule.accountId) : null;
  let destination: RuleDestination = DESTINATIONS.includes(a.destination) ? a.destination : 'none';
  // a folder only exists in one mailbox
  if (destination === 'folder' && (!accountId || !a.folderPath)) destination = 'none';
  const actions: RuleActions = { destination, folderPath: destination === 'folder' ? String(a.folderPath) : null, categoryIds: [...new Set((a.categoryIds ?? []).map(Number).filter(Boolean))], markRead: !!a.markRead, flag: !!a.flag };
  if (actions.destination === 'none' && !actions.categoryIds.length && !actions.markRead && !actions.flag) throw Object.assign(new Error('A rule needs at least one action'), { status: 400 });
  const name = (rule.name ?? '').trim() || conditions.map(c => c.value).join(', ').slice(0, 80);
  return { name, accountId, enabled: rule.enabled !== false, matchAll: rule.matchAll !== false, conditions, actions, stop: !!rule.stop };
}
export function saveRule(rule: Partial<MailRule>): MailRule[] {
  const r = clean(rule);
  const values = [r.name, r.accountId, r.enabled, r.matchAll, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.stop];
  if (rule.id) run('UPDATE mail_rules SET name = ?, account_id = ?, enabled = ?, match_all = ?, conditions = ?, actions = ?, stop = ? WHERE id = ?', ...values, rule.id);
  else { const order = (get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM mail_rules')?.m ?? 0) + 1; lastId(run('INSERT INTO mail_rules(name, account_id, enabled, match_all, conditions, actions, stop, sort_order) VALUES(?,?,?,?,?,?,?,?)', ...values, order)); }
  return listRules();
}
export function removeRule(id: number): MailRule[] { run('DELETE FROM mail_rules WHERE id = ?', id); return listRules(); }
export function reorderRules(ids: number[]): MailRule[] { tx(() => ids.forEach((id, i) => run('UPDATE mail_rules SET sort_order = ? WHERE id = ?', i + 1, id))); return listRules(); }

const terms = (value: string) => value.split(/[,;\n]/).map(t => t.trim().toLowerCase()).filter(Boolean);
const addressTexts = (list: Address[]) => list.map(a => `${a.name ?? ''} <${a.address ?? ''}>`.toLowerCase());
type Mail = Pick<MessageSummary, 'from' | 'to' | 'cc' | 'subject'>;
/** true when the mail meets the rule's conditions (all of them, or one of them) */
export function ruleMatches(rule: Pick<MailRule, 'conditions' | 'matchAll'>, m: Mail): boolean {
  const conditions = rule.conditions.filter(c => terms(c.value).length);
  if (!conditions.length) return false;
  const holds = (c: RuleCondition) => { const hay = c.field === 'subject' ? [(m.subject ?? '').toLowerCase()] : addressTexts(c.field === 'from' ? m.from ?? [] : [...(m.to ?? []), ...(m.cc ?? [])]); return terms(c.value).some(t => hay.some(h => h.includes(t))); };
  return rule.matchAll ? conditions.every(holds) : conditions.some(holds);
}
export interface RulePlan { destination: RuleDestination; folderPath: string | null; categoryIds: number[]; markRead: boolean; flag: boolean; }
/** What all matching rules together do with one mail: the first rule with a destination decides where it goes. */
export function planFor(rules: MailRule[], m: Mail & { accountId: number }): RulePlan | null {
  let plan: RulePlan | null = null;
  for (const rule of rules) {
    if (rule.accountId !== null && rule.accountId !== m.accountId) continue;
    if (!ruleMatches(rule, m)) continue;
    plan ??= { destination: 'none', folderPath: null, categoryIds: [], markRead: false, flag: false };
    const a = rule.actions;
    if (plan.destination === 'none' && a.destination !== 'none') { plan.destination = a.destination; plan.folderPath = a.folderPath; }
    for (const id of a.categoryIds) if (!plan.categoryIds.includes(id)) plan.categoryIds.push(id);
    plan.markRead ||= a.markRead; plan.flag ||= a.flag;
    if (rule.stop) break;
  }
  return plan;
}
const push = <K>(map: Map<K, MessageRef[]>, key: K, ref: MessageRef) => { const list = map.get(key) ?? []; list.push(ref); map.set(key, list); };
const attempt = async (what: string, fn: () => unknown) => { try { await fn(); } catch (err: any) { log('rule action failed', what, err?.message); } };
/**
 * Applies the rules to mail of one mailbox and returns the mail that stays in the inbox unread
 * (so only that mail gets a notification).
 */
export async function applyRules(accountId: number, messages: MessageSummary[], rules = listRules().filter(r => r.enabled)): Promise<{ remaining: MessageSummary[]; matched: number }> {
  if (!messages.length || !rules.some(r => r.accountId === null || r.accountId === accountId)) return { remaining: messages, matched: 0 };
  const categories = new Map<number, MessageRef[]>(), moves = new Map<string, MessageRef[]>();
  const read: MessageRef[] = [], flag: MessageRef[] = [], remaining: MessageSummary[] = [];
  let matched = 0;
  for (const m of messages) {
    const plan = planFor(rules, m);
    if (!plan) { remaining.push(m); continue; }
    matched++;
    const ref: MessageRef = { accountId: m.accountId, folderId: m.folderId, uid: m.uid };
    for (const id of plan.categoryIds) if (!m.categories.includes(id)) push(categories, id, ref);
    if (plan.markRead && !m.seen) read.push(ref);
    if (plan.flag && !m.flagged) flag.push(ref);
    let target: string | null = plan.destination === 'none' ? null : plan.destination;
    if (plan.destination === 'folder') { const f = get<{ id: number }>('SELECT id FROM folders WHERE account_id = ? AND path = ?', m.accountId, plan.folderPath); target = f && f.id !== m.folderId ? `folder:${f.id}` : null; }
    if (target) push(moves, target, ref);
    if (!target && !plan.markRead) remaining.push(m);
  }
  // categories first (they follow the mail by Message-ID), then flags, then moves (moving changes the UID)
  for (const [id, refs] of categories) await attempt('category', () => categorize(refs, id, true));
  if (read.length) await attempt('mark read', () => setFlags(read, { seen: true }));
  if (flag.length) await attempt('flag', () => setFlags(flag, { flagged: true }));
  for (const [target, refs] of moves) {
    if (target === 'archive') await attempt(target, () => archiveMessages(refs));
    else if (target === 'junk') await attempt(target, () => junkMessages(refs, true));
    else if (target === 'trash') await attempt(target, () => deleteMessages(refs));
    else await attempt(target, () => moveMessages(refs, Number(target.slice(7))));
  }
  if (matched) log('rules applied', accountId, matched);
  return { remaining, matched };
}
/** Runs the rules (or one rule, also when it is switched off) on the mail that is in the inbox now. */
export async function runRules(id: number | null): Promise<RuleRunResult> {
  const rules = listRules().filter(r => id ? r.id === id : r.enabled);
  const result: RuleRunResult = { checked: 0, matched: 0 };
  if (!rules.length) return result;
  for (const account of listAccounts()) {
    if (!account.features.mail || !rules.some(r => r.accountId === null || r.accountId === account.id)) continue;
    const inbox = specialFolder(account.id, 'inbox'); if (!inbox) continue;
    const messages = summaries(account.id, all('SELECT * FROM messages WHERE folder_id = ? ORDER BY date DESC', inbox.id));
    result.checked += messages.length;
    result.matched += (await applyRules(account.id, messages, rules)).matched;
  }
  return result;
}