/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { Address } from '../../../shared/types';
const PALETTE = ['#4f94f0', '#1baf7a', '#eb6834', '#eda100', '#e87ba4', '#8b5cf6', '#14b8a6', '#0f54ae', '#199e70', '#d95926'];
export const initials = (name: string, address = ''): string => { const base = (name || address.split('@')[0] || '?').trim(); const parts = base.split(/[\s._-]+/).filter(Boolean); return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase(); };
export const colorFor = (key: string): string => { let h = 0; for (const ch of key.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
export const addressLabel = (a?: Address | null): string => a ? (a.name || a.address) : '';
export const addressesLabel = (list: Address[]): string => list.map(addressLabel).filter(Boolean).join(', ');
export const addressFull = (a: Address): string => a.name ? `${a.name} <${a.address}>` : a.address;
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function listDate(iso: string | null, locale: string): string { if (!iso) return ''; const d = new Date(iso); const now = new Date(); if (sameDay(d, now)) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (sameDay(d, yesterday)) return d.toLocaleDateString(locale, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); if (now.getTime() - d.getTime() < 6 * 86400000 && d < now) return d.toLocaleDateString(locale, { weekday: 'short' }); return d.toLocaleDateString(locale, d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); }
export const longDate = (iso: string | null, locale: string): string => iso ? new Date(iso).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const timeShort = (d: Date, locale: string) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
export const formatBytes = (n: number): string => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDayKey = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
export const startOfWeek = (d: Date, weekStartsOn = 1) => { const r = startOfDay(d); const diff = (r.getDay() - weekStartsOn + 7) % 7; return addDays(r, -diff); };
export const isoWeek = (d: Date) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t.getTime() - start.getTime()) / 86400000 + 1) / 7); };
export const toLocalInput = (d: Date) => `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const contrast = (hex: string) => { const n = parseInt((hex || '#888888').replace('#', ''), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0c0e11' : '#ffffff'; };
export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const dateGroup = (iso: string | null, now = new Date()): string => { if (!iso) return 'OLDER'; const d = new Date(iso); if (sameDay(d, now)) return 'TODAY'; const y = addDays(now, -1); if (sameDay(d, y)) return 'YESTERDAY'; const week = startOfWeek(now); if (d >= week) return 'THIS_WEEK'; const lastWeek = addDays(week, -7); if (d >= lastWeek) return 'LAST_WEEK'; if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'THIS_MONTH'; const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1); if (d.getFullYear() === lastMonth.getFullYear() && d.getMonth() === lastMonth.getMonth()) return 'LAST_MONTH'; return 'OLDER'; };
const HTML_TAG = /<\/?(br|p|div|span|a|b|i|u|em|strong|ul|ol|li|h[1-6]|html|body|font|table|tr|td)\b[^>]*>/i;
export function htmlToPlain(text: string | null | undefined): string {
  const s = text ?? ''; if (!HTML_TAG.test(s) && !/&(nbsp|amp|lt|gt|quot|#\d+);/.test(s)) return s;
  const doc = new DOMParser().parseFromString(s.replace(/\r?\n/g, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n').replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n• '), 'text/html');
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) { const href = a.getAttribute('href') ?? ''; const label = (a.textContent ?? '').trim(); if (/^(https?|mailto|tel):/i.test(href) && label && !href.replace(/^mailto:|^tel:/i, '').includes(label.replace(/\/$/, ''))) a.textContent = `${label} (${href.replace(/^mailto:/i, '')})`; }
  return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}