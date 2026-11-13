import { app, BrowserWindow, Notification } from 'electron';
import { getSettings } from './core/settings';
import { getAccount } from './accounts/accounts';
import { Account, MessageSummary } from '../shared/types';
export const APP_ID = 'com.eliasdehondt.dhmail';
const TEXT = { nl: { noSubject: '(geen onderwerp)', inbox: 'Postvak IN', many: (n: number) => `${n} nieuwe e-mails`, testTitle: 'Meldingen staan aan', testBody: 'Zo ziet een melding van DHMail eruit.' }, en: { noSubject: '(no subject)', inbox: 'Inbox', many: (n: number) => `${n} new emails`, testTitle: 'Notifications are on', testBody: 'This is what a DHMail notification looks like.' } };
const text = () => TEXT[getSettings().language === 'en' ? 'en' : 'nl'];
// Windows only shows toasts for an app with an AppUserModelID that matches its Start menu shortcut (electron-builder uses the appId)
export function initNotifications() { if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath); }
// keep a reference, otherwise Windows can garbage-collect the notification and the click handler is lost
const live: Notification[] = [];
function show(options: Electron.NotificationConstructorOptions, onClick: () => void) { const n = new Notification({ silent: false, ...options }); n.on('click', onClick); n.on('close', () => { const i = live.indexOf(n); if (i >= 0) live.splice(i, 1); }); live.push(n); while (live.length > 20) live.shift(); n.show(); }
const mailbox = (a: Account | null) => !a ? text().inbox : a.name && a.name.toLowerCase() !== a.email.toLowerCase() ? `${a.name} · ${a.email}` : a.email;
const sender = (m: MessageSummary) => { const f = m.from[0]; return f?.name || f?.address || 'DHMail'; };
export function notifyNewMail(payload: { accountId: number; messages: MessageSummary[] }, focus: () => BrowserWindow | null) {
  const s = getSettings(); if (!s.notifications || !Notification.isSupported() || (s.notifyMutedAccounts ?? []).includes(payload.accountId) || !payload.messages.length) return;
  const t = text(), where = `${t.inbox} · ${mailbox(getAccount(payload.accountId) ?? null)}`;
  const open = (m: MessageSummary) => () => focus()?.webContents.send('notification:open', { accountId: m.accountId, folderId: m.folderId, uid: m.uid });
  const list = [...payload.messages].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (list.length > 3) { const senders = [...new Set(list.map(sender))]; show({ title: t.many(list.length), body: `${senders.slice(0, 4).join(', ')}${senders.length > 4 ? ', …' : ''}\n${where}` }, open(list[0])); return; }
  for (const m of list) show({ title: sender(m), body: `${m.subject || t.noSubject}\n${where}` }, open(m));
}
export function testNotification(focus: () => BrowserWindow | null): boolean { if (!Notification.isSupported()) return false; const t = text(); show({ title: t.testTitle, body: t.testBody }, () => { focus(); }); return true; }
