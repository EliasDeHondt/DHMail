/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { get } from '../core/db';
import { getSecret } from '../core/secrets';
import { gapi } from '../calendar/google';
import { graph } from '../calendar/microsoft';
import { Row, birthdayParts, fold, googlePerson, nameOf, outlookContact, toRow, vEsc } from './copy';

// Changes and deletions of contacts that live in an account (Google, Outlook, CardDAV). Only the fields
// DHMail edits are replaced; everything else on the contact (photo, addresses, ...) stays as it is.

const consent = (err: any) => (err?.code === 'OAUTH_REAUTH' || err?.status === 403) ? Object.assign(new Error('DHMail may not change contacts in this Outlook account yet. Sign in to the account again to grant access.'), { code: 'CONTACTS_WRITE_CONSENT' }) : err;

function contactRow(id: number) {
  const r = get('SELECT c.*, s.kind, s.account_id, s.url AS source_url, s.username AS source_username, s.id AS sid FROM contacts c JOIN contact_sources s ON s.id = c.source_id WHERE c.id = ?', id);
  if (!r) throw Object.assign(new Error('Contact not found'), { status: 404 });
  if (r.kind === 'google' && String(r.remote_id ?? '').startsWith('otherContacts/')) throw Object.assign(new Error('Google keeps this address under "other contacts"; it cannot be changed there'), { status: 403 });
  if (!r.remote_id) throw Object.assign(new Error('This contact cannot be changed'), { status: 400 });
  return r;
}

async function davFetch(r: any, method: string, body?: string) {
  const auth = 'Basic ' + Buffer.from(`${r.source_username ?? ''}:${getSecret(`source:${r.sid}:password`) ?? ''}`).toString('base64');
  const url = new URL(r.remote_id, r.source_url).toString();
  const res = await fetch(url, { method, headers: { Authorization: auth, ...(body ? { 'Content-Type': 'text/vcard; charset=utf-8' } : {}) }, body });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`CardDAV server answered ${res.status}`);
  return res;
}

/** the stored vCard with only the edited properties replaced */
async function patchedVCard(r: any, c: Row) {
  const original = await (await davFetch(r, 'GET')).text();
  const lines = [`FN:${vEsc(nameOf(c))}`, `N:${vEsc(c.lastName)};${vEsc(c.firstName)};;;`];
  for (const e of c.emails) lines.push(`EMAIL${e.label ? `;TYPE=${vEsc(e.label).toUpperCase()}` : ''}:${vEsc(e.value)}`);
  for (const p of c.phones) lines.push(`TEL${p.label ? `;TYPE=${vEsc(p.label).toUpperCase()}` : ''}:${vEsc(p.value)}`);
  if (c.company) lines.push(`ORG:${vEsc(c.company)}`);
  if (c.title) lines.push(`TITLE:${vEsc(c.title)}`);
  if (c.notes) lines.push(`NOTE:${vEsc(c.notes)}`);
  const b = birthdayParts(c.birthday);
  if (b) lines.push(`BDAY:${b.year ?? '-'}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`);
  // text level: drop the properties DHMail edits (also grouped ones like item1.EMAIL) and keep every other line as it was
  const managed = /^([\w-]+\.)?(FN|N|EMAIL|TEL|ORG|TITLE|NOTE|BDAY)[;:]/i;
  const kept = original.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(l => l.trim() && !managed.test(l) && !/^END:VCARD/i.test(l));
  return [...kept, ...lines, 'END:VCARD'].map(fold).join('\r\n') + '\r\n';
}

export async function updateRemoteContact(id: number, input: Partial<Row>) {
  const r = contactRow(id);
  const c: Row = { ...toRow(r), ...input, photo: r.photo };
  if (r.kind === 'google') {
    const meta = await gapi(r.account_id, `https://people.googleapis.com/v1/${r.remote_id}?personFields=metadata`);
    await gapi(r.account_id, `https://people.googleapis.com/v1/${r.remote_id}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers,organizations,birthdays,biographies`, { method: 'PATCH', body: JSON.stringify({ etag: meta?.etag, ...googlePerson(c) }) });
  } else if (r.kind === 'microsoft') {
    const body: any = outlookContact(c);
    for (const k of ['givenName', 'surname', 'companyName', 'jobTitle', 'personalNotes', 'birthday', 'mobilePhone']) if (body[k] === undefined) body[k] = null;
    try { await graph(r.account_id, `/me/contacts/${encodeURIComponent(r.remote_id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true, 'contactswrite'); } catch (err) { throw consent(err); }
  } else if (r.kind === 'carddav') await davFetch(r, 'PUT', await patchedVCard(r, c));
  else throw Object.assign(new Error('This contact cannot be changed'), { status: 400 });
  return r.source_id as number;
}

export async function deleteRemoteContact(id: number) {
  const r = contactRow(id);
  if (r.kind === 'google') await gapi(r.account_id, `https://people.googleapis.com/v1/${r.remote_id}:deleteContact`, { method: 'DELETE' });
  else if (r.kind === 'microsoft') { try { await graph(r.account_id, `/me/contacts/${encodeURIComponent(r.remote_id)}`, { method: 'DELETE' }, true, 'contactswrite'); } catch (err) { throw consent(err); } }
  else if (r.kind === 'carddav') await davFetch(r, 'DELETE');
  else throw Object.assign(new Error('This contact cannot be deleted'), { status: 400 });
  return r.source_id as number;
}