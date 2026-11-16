/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { all, get, lastId, run } from '../core/db';
import { Category, MessageRef } from '../../shared/types';
import { assignCategory } from './sync';
import { getAccount } from '../accounts/accounts';
import { pushOutlookCategory, schedulePushCategoryColor, usesOutlookCategories } from './outlook-categories';
import { log } from '../core/bus';
const map = (r: any): Category => ({ id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order });
export const listCategories = () => all('SELECT * FROM categories ORDER BY sort_order, lower(name)').map(map);
export function saveCategory(c: Partial<Category>): Category[] { const name = (c.name ?? '').trim(); if (!name) throw Object.assign(new Error('A category needs a name'), { status: 400 }); const color = c.color || '#4f94f0'; if (c.id) { const before = get<{ color: string }>('SELECT color FROM categories WHERE id = ?', c.id); run('UPDATE categories SET name = ?, color = ?, sort_order = ? WHERE id = ?', name, color, c.sortOrder ?? 0, c.id); if (before && before.color !== color) schedulePushCategoryColor(c.id); } else { const order = (get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories')?.m ?? 0) + 1; lastId(run('INSERT INTO categories(name, color, sort_order) VALUES(?,?,?)', name, color, order)); } return listCategories(); }
export function removeCategory(id: number): Category[] { run('DELETE FROM categories WHERE id = ?', id); return listCategories(); }
export function ensureDefaultCategories() { if (get('SELECT id FROM categories LIMIT 1')) return; const defaults: [string, string][] = [['Belangrijk', '#e74c3c'], ['Werk', '#4f94f0'], ['Persoonlijk', '#8b5cf6'], ['Facturen', '#eda100'], ['School', '#1baf7a']]; defaults.forEach(([name, color], i) => run('INSERT INTO categories(name, color, sort_order) VALUES(?,?,?)', name, color, i)); }
/** Gives (or takes away) a category on messages, and sends the change to Outlook for Microsoft mailboxes. */
export function categorize(refs: MessageRef[], categoryId: number, assigned: boolean) { assignCategory(refs, categoryId, assigned); for (const accountId of new Set(refs.map(r => r.accountId))) { const account = getAccount(accountId); if (usesOutlookCategories(account)) pushOutlookCategory(account!, refs.filter(r => r.accountId === accountId), categoryId, assigned).catch(err => log('outlook category push failed', err?.message)); } }