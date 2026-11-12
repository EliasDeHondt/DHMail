import { all, get } from '../core/db';

// Groups an account's messages into conversations (Outlook-style): replies are linked to their
// parent through In-Reply-To / Message-ID, and replies or forwards ("Re:", "Antw:", "Fw:", ...)
// with the same subject join the same conversation even when the header chain is broken.
const PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|antw|antwoord|doorst|tr|sv|vs|rif|enc)\s*(?:\[\d+\])?\s*[:：]\s*)+/i;
const normSubject = (s: string) => s.replace(PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase();
const firstId = (s: string | null) => { if (!s) return null; const m = s.match(/<([^>]+)>/); return (m ? m[1] : s).trim().toLowerCase() || null; };

interface Index { sig: string; threadOf: Map<number, string>; members: Map<string, number[]>; }
const cache = new Map<number, Index>();

export function threadIndex(accountId: number): Index {
  const s = get<{ n: number; m: number | null }>('SELECT COUNT(*) AS n, MAX(id) AS m FROM messages WHERE account_id = ?', accountId)!;
  const sig = `${s.n}:${s.m}`;
  const cached = cache.get(accountId);
  if (cached?.sig === sig) return cached;
  const rows = all<{ id: number; message_id: string | null; in_reply_to: string | null; subject: string }>('SELECT id, message_id, in_reply_to, subject FROM messages WHERE account_id = ?', accountId);
  const parent = new Map<string, string>();
  const find = (x: string): string => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r)!; while (x !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const originals: [string, string][] = [];
  for (const r of rows) {
    const node = 'm' + r.id;
    find(node);
    const mid = firstId(r.message_id), irt = firstId(r.in_reply_to);
    if (mid) union(node, 'i' + mid);
    if (irt) union(node, 'i' + irt);
    const subject = normSubject(r.subject ?? '');
    if (subject.length < 3) continue;
    if (irt || PREFIX.test(r.subject ?? '')) union(node, 's' + subject);
    else originals.push([node, 's' + subject]);
  }
  for (const [node, key] of originals) if (parent.has(key)) union(node, key);
  const byRoot = new Map<string, number[]>();
  for (const r of rows) { const root = find('m' + r.id); const list = byRoot.get(root); if (list) list.push(r.id); else byRoot.set(root, [r.id]); }
  const threadOf = new Map<number, string>(), members = new Map<string, number[]>();
  for (const ids of byRoot.values()) { const key = 't' + Math.min(...ids); members.set(key, ids); for (const id of ids) threadOf.set(id, key); }
  const index = { sig, threadOf, members };
  cache.set(accountId, index);
  return index;
}

