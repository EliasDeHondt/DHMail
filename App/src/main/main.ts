import { app, BrowserWindow, nativeTheme, net, protocol, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeDb, openDb } from './core/db';
import { moveOldUserData } from './core/migrate-data';
import { getSettings } from './core/settings';
import { listAccounts } from './accounts/accounts';
import { importOutlookCategories } from './mail/outlook-categories';
import { activateAccount, registerIpc } from './ipc';
import { lockWindow } from './core/lock';
import { migrateAccountSignatures } from './mail/signatures';
import { bus, log } from './core/bus';
import * as mail from './mail/sync';
import { ensureDefaultCalendars, syncAllCalendars } from './calendar';
import { ensureLocalSource, syncAllContacts } from './contacts';
import { ensureDefaultCategories } from './mail/categories';
import { applyRules } from './mail/rules';
import { initNotifications, notifyNewMail } from './notify';
import { attachContextMenu } from './context-menu';
protocol.registerSchemesAsPrivileged([{ scheme: 'dhmail', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (process.env['DHMAIL_USER_DATA']) app.setPath('userData', process.env['DHMAIL_USER_DATA']);
else moveOldUserData();
const RENDERER = join(__dirname, '..', '..', 'renderer', 'browser');
let win: BrowserWindow | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
initNotifications();
const isDark = () => { const t = getSettings().theme; return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors); };
function createWindow() { lockWindow(); const dark = isDark(); win = new BrowserWindow({ width: 1480, height: 940, minWidth: 980, minHeight: 620, show: false, backgroundColor: dark ? '#060709' : '#f6f7f9', titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#060709' : '#f6f7f9', symbolColor: dark ? '#edeff2' : '#0c0e11', height: 40 }, icon: join(__dirname, '..', '..', '..', 'build', 'icon.png'), webPreferences: { preload: join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } }); win.setMenuBarVisibility(false); attachContextMenu(win); win.loadURL('dhmail://app/index.html'); win.once('ready-to-show', () => win?.show()); win.on('closed', () => { win = null; }); win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); return { action: 'deny' }; }); win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('dhmail://')) { e.preventDefault(); if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); } }); }
function serveRenderer() { protocol.handle('dhmail', request => { const url = new URL(request.url); let pathname = decodeURIComponent(url.pathname); if (!pathname || pathname === '/') pathname = '/index.html'; let file = normalize(join(RENDERER, pathname)); if (!file.startsWith(RENDERER) || !existsSync(file)) file = join(RENDERER, 'index.html'); return net.fetch(pathToFileURL(file).toString()); }); }
function focusWindow() { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } return win; }
function scheduler() { let mailTick = 0, calendarTick = 0, contactsTick = 0; setInterval(() => { const s = getSettings(); mailTick++; calendarTick++; contactsTick++; if (mailTick >= Math.max(1, s.syncIntervalMinutes)) { mailTick = 0; for (const a of listAccounts()) if (a.features.mail) { mail.syncSpecial(a.id, 'inbox').then(() => mail.syncSpecial(a.id, 'sent')).catch(() => {}); mail.refreshCounts(a.id).catch(() => {}); } } if (calendarTick >= 30) { calendarTick = 0; for (const a of listAccounts()) importOutlookCategories(a).catch(() => {}); syncAllCalendars().catch(() => {}); } if (contactsTick >= 60) { contactsTick = 0; syncAllContacts().catch(() => {}); } }, 60_000).unref(); }
app.whenReady().then(() => { serveRenderer(); openDb(join(app.getPath('userData'), 'dhmail.db')); ensureDefaultCalendars(); migrateAccountSignatures(); ensureLocalSource(); ensureDefaultCategories(); mail.setArrivalFilter((accountId, messages) => applyRules(accountId, messages)); registerIpc(() => win, focusWindow); createWindow(); bus.on('event', (channel: string, payload: any) => { win?.webContents.send(channel, payload); if (channel === 'mail:new') notifyNewMail(payload, focusWindow); }); nativeTheme.on('updated', () => win?.webContents.send('theme:system', { dark: nativeTheme.shouldUseDarkColors })); for (const account of listAccounts()) activateAccount(account); syncAllCalendars().catch(() => {}); scheduler(); log('DHMail started', app.getVersion()); });
app.on('second-instance', () => { focusWindow(); });
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => app.quit());
let quitting = false;
app.on('before-quit', e => { if (quitting) return; quitting = true; e.preventDefault(); Promise.all(listAccounts().map(a => mail.stopAccount(a.id))).catch(() => {}).finally(() => { closeDb(); app.quit(); }); });
