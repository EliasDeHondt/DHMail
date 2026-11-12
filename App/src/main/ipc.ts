import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ImapFlow } from 'imapflow';
import { Account, Api } from '../shared/types';
import { getSettings, setSettings } from './core/settings';
import { discover, oauthServers } from './accounts/discover';
import { oauthReady } from './accounts/oauth-clients';
const COLORS = ['#4f94f0', '#0f54ae', '#829ec2', '#3d587b', '#2a78d6', '#14b8a6', '#8b5cf6', '#e87ba4'];
import { addAccount, getAccount, listAccounts, removeAccount, reorderAccounts, updateAccount } from './accounts/accounts';
import { importOutlookCategories, pushOutlookCategory, usesOutlookCategories } from './mail/outlook-categories';
import { forgetTokens, oauthFlow, OAuthError } from './accounts/oauth';
import { setSecret } from './core/secrets';
import { describe } from './mail/session';
import * as mail from './mail/sync';
import { saveDraft, sendMail } from './mail/smtp';
import { listCategories, removeCategory, saveCategory } from './mail/categories';
import * as cal from './calendar';
import * as contacts from './contacts';
import { copyContactTo, copyContacts, createContactIn } from './contacts/copy';
import { bus, log } from './core/bus';
import { suggestPlaces } from './geo';
import { changePin, isUnlocked, lockStatus, setupPin, unlock } from './core/lock';
const OPEN_WHILE_LOCKED = new Set(['app:info', 'app:titleBar', 'settings:get', 'lock:status', 'lock:setup', 'lock:unlock']);
type Handlers = { [K in keyof Api]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<ReturnType<Api[K]>> };
export function activateAccount(account: Account) { mail.startAccount(account); importOutlookCategories(account).catch(err => log('outlook categories failed', err?.message)); cal.ensureAccountCalendars(account); contacts.ensureAccountSources(account); cal.syncAccountCalendars(account).catch(err => log('calendar activation failed', err?.message)); if (account.features.contacts) contacts.syncAllContacts().catch(err => log('contacts activation failed', err?.message)); }
export function registerIpc(getWindow: () => BrowserWindow | null) {
  const win = () => getWindow() ?? undefined;
  const handlers: Handlers = {
    'app:info': () => ({ version: app.getVersion(), dataPath: app.getPath('userData'), platform: process.platform }),
    'geo:suggest': (query, lang) => suggestPlaces(String(query ?? '').slice(0, 200), lang === 'en' ? 'en' : 'nl'),
    'app:openExternal': url => { if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); },
    'app:pickFiles': async () => { const r = await dialog.showOpenDialog(win()!, { properties: ['openFile', 'multiSelections'] }); return Promise.all(r.filePaths.map(async p => ({ path: p, name: basename(p), size: (await stat(p)).size }))); },
    'app:pickFile': async filters => { const r = await dialog.showOpenDialog(win()!, { properties: ['openFile'], filters }); const p = r.filePaths[0]; if (!p) return null; return { path: p, name: basename(p), content: await readFile(p, 'utf8') }; },
    'app:titleBar': colors => { try { const w = win(); w?.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 40 }); if (w && typeof colors.modal === 'boolean') { w.setMinimizable(!colors.modal); w.setMaximizable(!colors.modal); w.setClosable(!colors.modal); } } catch {} },
    'settings:get': () => getSettings(),
    'settings:set': patch => setSettings(patch),
    'lock:status': () => lockStatus(),
    'lock:setup': pin => setupPin(String(pin ?? '')),
    'lock:unlock': pin => unlock(String(pin ?? '')),
    'lock:change': (current, next) => changePin(String(current ?? ''), String(next ?? '')),
    'accounts:list': () => listAccounts(),
    'accounts:reorder': ids => reorderAccounts(Array.isArray(ids) ? ids : []),
    'accounts:oauthReady': () => oauthReady(),
    'accounts:connect': async (provider, domain) => { const hd = typeof domain === 'string' && /^[a-z0-9.-]+$/i.test(domain) ? domain.toLowerCase() : undefined; const r = await oauthFlow(provider, undefined, hd); const email = r.email.trim(); if (!email) throw new Error('The provider did not return an email address'); if (hd && !email.toLowerCase().endsWith('@' + hd)) throw Object.assign(new Error(`Sign in with your @${hd} address`), { code: 'WRONG_DOMAIN' }); const existing = listAccounts().find(a => a.provider === provider && a.email.toLowerCase() === email.toLowerCase()); if (existing) { setSecret(`account:${existing.id}:refresh`, r.refreshToken); forgetTokens(existing.id); await mail.stopAccount(existing.id); activateAccount(existing); return existing; } const servers = oauthServers(provider); const account = addAccount({ ...servers, name: r.name || email, email, username: email, provider, authType: 'oauth', refreshToken: r.refreshToken, color: COLORS[listAccounts().length % COLORS.length], signature: '', features: { mail: true, calendar: true, contacts: true } }); activateAccount(account); return account; },
    'accounts:discover': (email, password, username) => discover(email.trim(), password, username?.trim() || undefined),
    'accounts:add': async input => { const account = addAccount(input); activateAccount(account); return account; },
    'accounts:update': async (id, patch) => { await mail.stopAccount(id); forgetTokens(id); const account = updateAccount(id, patch); activateAccount(account); return account; },
    'accounts:remove': async id => { await mail.stopAccount(id); forgetTokens(id); removeAccount(id); bus.emitEvent('calendar:changed', { calendarId: null }); bus.emitEvent('contacts:changed', { sourceId: null }); },
    'accounts:test': async input => { if (input.authType === 'oauth') return { ok: true }; const client = new ImapFlow({ host: input.imapHost, port: input.imapPort, secure: input.imapSecure, auth: { user: input.username || input.email, pass: input.password ?? '' }, logger: false, connectionTimeout: 20000, greetingTimeout: 15000 }); client.on('error', () => {}); try { await client.connect(); await client.logout(); return { ok: true }; } catch (err) { return { ok: false, error: describe(err) }; } },
    'accounts:reauth': async id => { const account = getAccount(id); if (!account) throw Object.assign(new Error('Account not found'), { status: 404 }); const result = await oauthFlow(account.provider, account.email); setSecret(`account:${id}:refresh`, result.refreshToken); forgetTokens(id); await mail.stopAccount(id); activateAccount(account); return result; },
    'accounts:status': () => mail.statuses(),
    'accounts:reconnect': id => mail.reconnectAccount(id),
    'mail:folders': accountId => mail.getFolders(accountId),
    'mail:syncFolders': accountId => mail.syncFolders(accountId),
    'mail:syncFolder': (accountId, folderId) => mail.syncFolder(accountId, folderId),
    'mail:loadOlder': (accountId, folderId) => mail.loadOlder(accountId, folderId),
    'mail:list': query => mail.listMessages(query),
    'mail:searchServer': (accountId, folderId, query) => mail.searchServer(accountId, folderId, query),
    'mail:get': (ref, markSeen) => mail.getMessage(ref, markSeen),
    'mail:attachment': async (ref, index) => { const a = await mail.getAttachment(ref, index); if (!a) return null; const r = await dialog.showSaveDialog(win()!, { defaultPath: join(app.getPath('downloads'), a.filename) }); if (r.canceled || !r.filePath) return null; await writeFile(r.filePath, a.content); return r.filePath; },
    'mail:setFlags': (refs, flags) => mail.setFlags(refs, flags),
    'mail:move': (refs, target) => mail.moveMessages(refs, target),
    'mail:delete': refs => mail.deleteMessages(refs),
    'mail:archive': refs => mail.archiveMessages(refs),
    'mail:junk': (refs, isJunk) => mail.junkMessages(refs, isJunk),
    'mail:send': m => sendMail(m),
    'mail:saveDraft': m => saveDraft(m),
    'mail:discardDraft': (accountId, uid) => mail.discardDraft(accountId, uid),
    'mail:emptyFolder': (accountId, folderId) => mail.emptyFolder(accountId, folderId),
    'mail:createFolder': (accountId, path) => mail.createFolder(accountId, path),
    'mail:deleteFolder': (accountId, folderId) => mail.deleteFolder(accountId, folderId),
    'mail:renameFolder': (accountId, folderId, name) => mail.renameFolder(accountId, folderId, name),
    'mail:suggest': query => contacts.suggest(query),
    'categories:list': () => listCategories(),
    'categories:save': c => saveCategory(c),
    'categories:remove': id => removeCategory(id),
    'categories:assign': (refs, categoryId, assigned) => { mail.assignCategory(refs, categoryId, assigned); for (const accountId of new Set(refs.map(r => r.accountId))) { const account = getAccount(accountId); if (usesOutlookCategories(account)) pushOutlookCategory(account!, refs.filter(r => r.accountId === accountId), categoryId, assigned).catch(err => log('outlook category push failed', err?.message)); } },
    'calendar:list': () => cal.listCalendars(),
    'calendar:add': input => cal.addCalendar(input),
    'calendar:update': (id, patch) => cal.updateCalendar(id, patch),
    'calendar:remove': id => cal.removeCalendar(id),
    'calendar:sync': id => cal.syncAllCalendars(id),
    'calendar:events': (start, end) => cal.eventsBetween(start, end),
    'calendar:saveEvent': input => cal.saveEvent(input),
    'calendar:deleteEvent': id => cal.deleteEvent(id),
    'calendar:setCategories': (id, names) => cal.setEventCategories(Number(id), names),
    'contacts:list': query => contacts.listContacts(query),
    'contacts:sources': () => contacts.listSources(),
    'contacts:photos': () => contacts.contactPhotos(),
    'contacts:copyOne': async (contactId, toId) => { const target = Number(toId) === -1 ? contacts.ensureLocalSource() : Number(toId); const r = await copyContactTo(Number(contactId), target, contacts.syncSource); bus.emitEvent('contacts:changed', { sourceId: target }); return r; },
    'contacts:createIn': async (input, toId) => { const r = await createContactIn(input, Number(toId), contacts.syncSource); bus.emitEvent('contacts:changed', { sourceId: Number(toId) }); return r; },
    'contacts:copy': async (fromId, toId) => { const target = Number(toId) === -1 ? contacts.ensureLocalSource() : Number(toId); const r = await copyContacts(Number(fromId), target, contacts.syncSource); bus.emitEvent('contacts:changed', { sourceId: target }); return r; },
    'contacts:addSource': input => contacts.addSource(input),
    'contacts:removeSource': id => contacts.removeSource(id),
    'contacts:sync': () => contacts.syncAllContacts(),
    'contacts:save': input => contacts.saveContact(input),
    'contacts:remove': id => contacts.removeContact(id),
    'contacts:importVcf': text => contacts.importVcf(text)
  };
  for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, async (_event, ...args: any[]) => { try { if (!isUnlocked() && !OPEN_WHILE_LOCKED.has(channel)) throw Object.assign(new Error('DHMail is locked'), { status: 423 }); return await (fn as any)(...args); } catch (err: any) { log('ipc failed', channel, err?.message); throw new Error(JSON.stringify({ message: describe(err), code: err instanceof OAuthError ? err.code : err?.code ?? null, status: err?.status ?? null })); } });
}
