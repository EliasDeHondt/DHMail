/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
const EVENTS = ['mail:changed', 'mail:new', 'mail:counts', 'account:status', 'calendar:changed', 'contacts:changed', 'sync:state', 'notification:open', 'theme:system', 'app:notice'];
contextBridge.exposeInMainWorld('dhmail', { invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args), on: (channel: string, listener: (payload: unknown) => void) => { if (!EVENTS.includes(channel)) return () => {}; const fn = (_e: IpcRendererEvent, payload: unknown) => listener(payload); ipcRenderer.on(channel, fn); return () => ipcRenderer.removeListener(channel, fn); } });