import { Account, MessageRef } from '../../shared/types';
import { get, lastId, run, tx } from '../core/db';
import { bus, log } from '../core/bus';
import { graph, outlookCategoryColors } from '../calendar/microsoft';
const syncing = new Set<number>();
export const usesOutlookCategories = (a: Account | null | undefined) => !!a && a.provider === 'microsoft' && a.authType === 'oauth';
const odataString = (s: string) => `'${s.replace(/'/g, "''")}'`;
function upsertCategory(name: string, color: string): number { const existing = get<{ id: number; color: string }>('SELECT id, color FROM categories WHERE lower(name) = lower(?)', name); if (existing) { if (existing.color !== color) run('UPDATE categories SET color = ? WHERE id = ?', color, existing.id); return existing.id; } const order = (get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories')?.m ?? 0) + 1; return lastId(run('INSERT INTO categories(name, color, sort_order) VALUES(?,?,?)', name, color, order)); }
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
