import { Account, MessageRef } from '../../shared/types';
import { all, get, lastId, run, tx } from '../core/db';
import { bus, log } from '../core/bus';
import { forgetCategoryColors, graph, outlookCategoryColors, PRESETS } from '../calendar/microsoft';
import { listAccounts } from '../accounts/accounts';
const syncing = new Set<number>();
export const usesOutlookCategories = (a: Account | null | undefined) => !!a && a.provider === 'microsoft' && a.authType === 'oauth';
const odataString = (s: string) => `'${s.replace(/'/g, "''")}'`;
// outlook_color is the colour Outlook had at the last import (or got from DHMail). Outlook's colour only replaces the
// one in DHMail when it changed in Outlook since then, so a colour picked in DHMail survives a restart.
function upsertCategory(name: string, color: string): number { const existing = get<{ id: number; color: string; outlook_color: string | null }>('SELECT id, color, outlook_color FROM categories WHERE lower(name) = lower(?)', name); if (existing) { if (existing.outlook_color !== color) run('UPDATE categories SET color = ?, outlook_color = ? WHERE id = ?', color, color, existing.id); return existing.id; } const order = (get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories')?.m ?? 0) + 1; return lastId(run('INSERT INTO categories(name, color, sort_order, outlook_color) VALUES(?,?,?,?)', name, color, order, color)); }
async function messagesWithCategory(accountId: number, name: string): Promise<string[]> { const out: string[] = []; let next: string | null = `/me/messages?$filter=${encodeURIComponent(`categories/any(c:c eq ${odataString(name)})`)}&$select=internetMessageId&$top=250`; while (next) { const data: any = await graph(accountId, next, {}, true, 'mailapi'); for (const m of data?.value ?? []) if (m.internetMessageId) out.push(m.internetMessageId); next = data?.['@odata.nextLink'] ?? null; } return out; }
// Pull the Outlook category list and every categorized mail, and mirror them into DHMail's categories.
export async function importOutlookCategories(account: Account) {
  if (!usesOutlookCategories(account) || syncing.has(account.id)) return;
  syncing.add(account.id);
  try {
    const colors = await outlookCategoryColors(account.id);
    const ids = new Map<string, number>(); tx(() => { for (const [name, color] of colors.entries()) ids.set(name.toLowerCase(), upsertCategory(name, color)); });
    const assigned = new Map<number, string[]>();
    for (const name of colors.keys()) { try { assigned.set(ids.get(name.toLowerCase())!, await messagesWithCategory(account.id, name)); } catch (err: any) { log('outlook mail categories unavailable', account.email, err?.message); return; } }
    tx(() => { const managed = [...ids.values()]; if (managed.length) run(`DELETE FROM message_categories WHERE account_id = ? AND category_id IN (${managed.map(() => '?').join(',')})`, account.id, ...managed); for (const [categoryId, messageIds] of assigned) for (const mid of messageIds) run('INSERT OR IGNORE INTO message_categories(account_id, message_key, category_id) VALUES(?,?,?)', account.id, `mid:${mid.trim().toLowerCase()}`, categoryId); });
    log('outlook categories imported', account.email, [...assigned.values()].reduce((n, l) => n + l.length, 0));
    bus.emitEvent('mail:changed', { accountId: account.id, folderId: null });
  } catch (err: any) { log('outlook categories failed', account.email, err?.message); }
  finally { syncing.delete(account.id); }
}
// Send a category change made in DHMail back to Outlook so both stay the same.
export async function pushOutlookCategory(account: Account, refs: MessageRef[], categoryId: number, assigned: boolean) {
  const cat = get<{ name: string }>('SELECT name FROM categories WHERE id = ?', categoryId); if (!cat) return;
  for (const r of refs) {
    const row = get<{ message_id: string | null }>('SELECT message_id FROM messages WHERE folder_id = ? AND uid = ?', r.folderId, r.uid); if (!row?.message_id) continue;
    try {
      const found: any = await graph(account.id, `/me/messages?$filter=${encodeURIComponent(`internetMessageId eq ${odataString(row.message_id)}`)}&$select=id,categories`, {}, true, 'mailapi');
      for (const m of found?.value ?? []) { const current: string[] = m.categories ?? []; const has = current.some(c => c.toLowerCase() === cat.name.toLowerCase()); if (has === assigned) continue; const categories = assigned ? [...current, cat.name] : current.filter(c => c.toLowerCase() !== cat.name.toLowerCase()); await graph(account.id, `/me/messages/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: JSON.stringify({ categories }) }, true, 'mailapi'); }
    } catch (err: any) { log('outlook category update failed', account.email, err?.message); }
  }
}

// ---------------------------------------------------------------- label colour → Outlook
const rgb = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
/** Outlook only knows 25 preset colours: the closest one to a colour picked in DHMail */
export function nearestPreset(hex: string): number { const c = rgb(hex); if (!c) return 7; let best = 7, dist = Infinity; PRESETS.forEach((p, i) => { const g = rgb(p)!; const d = (c[0] - g[0]) ** 2 + (c[1] - g[1]) ** 2 + (c[2] - g[2]) ** 2; if (d < dist) { dist = d; best = i; } }); return best; }
const pushTimers = new Map<number, ReturnType<typeof setTimeout>>();
let consentWarned = false;
/** sends a label's colour to every Outlook mailbox that has that label (waits a moment: the colour picker saves while dragging) */
export function schedulePushCategoryColor(categoryId: number) {
  clearTimeout(pushTimers.get(categoryId));
  pushTimers.set(categoryId, setTimeout(() => { pushTimers.delete(categoryId); pushCategoryColor(categoryId).catch(err => log('outlook category colour failed', err?.message)); }, 1500));
}
/** after signing in again: send every label colour that was changed in DHMail but did not reach Outlook yet */
export function pushPendingCategoryColors() {
  consentWarned = false;
  for (const c of all<{ id: number; color: string; outlook_color: string | null }>('SELECT id, color, outlook_color FROM categories WHERE outlook_color IS NOT NULL'))
    if (PRESETS[nearestPreset(c.color)] !== c.outlook_color) schedulePushCategoryColor(c.id);
}
async function pushCategoryColor(categoryId: number) {
  const cat = get<{ name: string; color: string }>('SELECT name, color FROM categories WHERE id = ?', categoryId); if (!cat) return;
  const preset = nearestPreset(cat.color);
  for (const account of listAccounts().filter(usesOutlookCategories)) {
    try {
      const data: any = await graph(account.id, '/me/outlook/masterCategories', {}, true, 'settings');
      const found = (data?.value ?? []).find((c: any) => String(c.displayName ?? '').toLowerCase() === cat.name.toLowerCase());
      if (!found) continue; // a label that only exists in DHMail stays there
      if (found.color !== `preset${preset}`) await graph(account.id, `/me/outlook/masterCategories/${encodeURIComponent(found.id)}`, { method: 'PATCH', body: JSON.stringify({ color: `preset${preset}` }) }, true, 'settings');
      run('UPDATE categories SET outlook_color = ? WHERE id = ?', PRESETS[preset], categoryId);
      forgetCategoryColors(account.id);
      log('outlook category colour updated', account.email, cat.name, `preset${preset}`);
    } catch (err: any) {
      log('outlook category colour failed', account.email, err?.message);
      const consent = err?.code === 'OAUTH_REAUTH' || err?.status === 403 || /AADSTS65001|consent|invalid_grant|access ?is ?denied|insufficient/i.test(String(err?.message ?? ''));
      if (!consentWarned) { consentWarned = true; bus.emitEvent('app:notice', { kind: 'error', message: consent ? `De kleur is bewaard in DHMail, maar Outlook (${account.email}) geeft nog geen toestemming om labelkleuren te wijzigen. Ga naar Instellingen → Accounts en kies eenmalig "Opnieuw aanmelden" bij dat account.` : `De kleur is bewaard in DHMail, maar kon niet naar Outlook (${account.email}) gestuurd worden: ${err?.message ?? err}` }); }
    }
  }
}
