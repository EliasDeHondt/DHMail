import { all, get, lastId, run, tx } from '../core/db';
import { Signature, SignatureInput } from '../../shared/types';

// Named signatures. Every mailbox has at most one default signature; one signature can be the default of
// several mailboxes, so a shared signature only has to be written once.

const clean = (html: string) => String(html ?? '').slice(0, 500_000);

export function listSignatures(): Signature[] {
  const links = all<{ account_id: number; signature_id: number }>('SELECT account_id, signature_id FROM signature_accounts');
  return all<{ id: number; name: string; html: string }>('SELECT id, name, html FROM signatures ORDER BY sort_order, id').map(s => ({ id: s.id, name: s.name, html: s.html, accountIds: links.filter(l => l.signature_id === s.id).map(l => l.account_id) }));
}

function link(signatureId: number, accountIds: number[]) {
  // a mailbox has one default signature: linking it here unlinks it from any other signature
  run('DELETE FROM signature_accounts WHERE signature_id = ?', signatureId);
  for (const id of [...new Set(accountIds.map(Number).filter(Boolean))]) run('INSERT INTO signature_accounts(account_id, signature_id) VALUES(?, ?) ON CONFLICT(account_id) DO UPDATE SET signature_id = excluded.signature_id', id, signatureId);
}

export function saveSignature(input: SignatureInput): Signature[] {
  const name = String(input.name ?? '').trim().slice(0, 120) || 'Handtekening';
  tx(() => {
    let id = input.id;
    if (id && get('SELECT id FROM signatures WHERE id = ?', id)) run('UPDATE signatures SET name = ?, html = ? WHERE id = ?', name, clean(input.html), id);
    else id = lastId(run('INSERT INTO signatures(name, html, sort_order) VALUES(?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM signatures))', name, clean(input.html)));
    link(id!, input.accountIds ?? []);
  });
  return listSignatures();
}

/** Edit a shared signature for one mailbox only: the change becomes a new signature for that mailbox, the others keep the original. */
export function forkSignature(id: number, accountId: number, input: SignatureInput): Signature[] {
  tx(() => {
    const name = String(input.name ?? '').trim().slice(0, 120) || 'Handtekening';
    const copy = lastId(run('INSERT INTO signatures(name, html, sort_order) VALUES(?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM signatures))', name, clean(input.html)));
    run('INSERT INTO signature_accounts(account_id, signature_id) VALUES(?, ?) ON CONFLICT(account_id) DO UPDATE SET signature_id = excluded.signature_id', accountId, copy);
    void id;
  });
  return listSignatures();
}

export function removeSignature(id: number): Signature[] { run('DELETE FROM signatures WHERE id = ?', id); return listSignatures(); }

/** One-time move of the old plain-text signature per account into named signatures. */
export function migrateAccountSignatures() {
  if (get('SELECT id FROM signatures LIMIT 1')) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
  const byText = new Map<string, number[]>();
  for (const a of all<{ id: number; signature: string }>("SELECT id, signature FROM accounts WHERE signature IS NOT NULL AND trim(signature) <> ''")) { const key = a.signature.trim(); byText.set(key, [...(byText.get(key) ?? []), a.id]); }
  let n = 0;
  for (const [text, ids] of byText) saveSignature({ name: byText.size > 1 ? `Handtekening ${++n}` : 'Handtekening', html: esc(text).replace(/\r?\n/g, '<br>'), accountIds: ids });
}
