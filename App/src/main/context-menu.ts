/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { BrowserWindow, clipboard, Menu, MenuItemConstructorOptions } from 'electron';
import { getSettings } from './core/settings';
const TEXT = { nl: { cut: 'Knippen', copy: 'Kopiëren', paste: 'Plakken', selectAll: 'Alles selecteren', copyLink: 'Linkadres kopiëren', copyEmail: 'E-mailadres kopiëren', addWord: 'Toevoegen aan woordenboek' }, en: { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', copyLink: 'Copy link address', copyEmail: 'Copy email address', addWord: 'Add to dictionary' } };
// Electron has no right-click menu of its own: give selected text, links and input fields the usual Copy / Paste menu.
// Places that open their own DHMail menu (mail rows, contacts, …) cancel the event, so this only appears where nothing else does.
export function attachContextMenu(win: BrowserWindow) {
  win.webContents.on('context-menu', (_e, p) => {
    const t = TEXT[getSettings().language === 'en' ? 'en' : 'nl'];
    const items: MenuItemConstructorOptions[] = [];
    if (p.misspelledWord) { for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) }); items.push({ label: t.addWord, click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' }); }
    const link = p.linkURL || '';
    if (/^mailto:/i.test(link)) { const address = decodeURIComponent(link.replace(/^mailto:/i, '').split('?')[0]); if (address) items.push({ label: t.copyEmail, click: () => clipboard.writeText(address) }); }
    else if (/^https?:/i.test(link)) items.push({ label: t.copyLink, click: () => clipboard.writeText(link) });
    const hasText = !!p.selectionText.trim();
    if (p.isEditable) items.push({ label: t.cut, role: 'cut', enabled: p.editFlags.canCut && hasText }, { label: t.copy, role: 'copy', enabled: p.editFlags.canCopy && hasText }, { label: t.paste, role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: t.selectAll, role: 'selectAll' });
    else if (hasText) items.push({ label: t.copy, role: 'copy' }, { label: t.selectAll, role: 'selectAll' });
    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}