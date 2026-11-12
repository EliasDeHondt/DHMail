import { randomUUID } from 'node:crypto';
import { all, get, json, now, run } from '../core/db';
import { ContactCopyResult, ContactField, ContactInput } from '../../shared/types';
import { getSecret } from '../core/secrets';
import { gapi } from '../calendar/google';
import { graph } from '../calendar/microsoft';
import { createVCard } from '../calendar/caldav';
import { log } from '../core/bus';

// Copies every contact of one address book into another one. Nothing is ever changed or deleted in the
// target: contacts that already exist there (same e-mail address, or same name when there is no address)
// are skipped, and every field the target cannot hold is written into the notes so no information is lost.
export interface Row { displayName: string; firstName: string; lastName: string; emails: ContactField[]; phones: ContactField[]; company: string; title: string; notes: string; birthday: string | null; photo: string | null; }
const readRows = (sourceId: number): Row[] => all('SELECT * FROM contacts WHERE source_id = ?', sourceId).map(toRow);
export const toRow = (r: any): Row => ({ displayName: r.display_name ?? '', firstName: r.first_name ?? '', lastName: r.last_name ?? '', emails: json<ContactField[]>(r.emails, []).filter(e => e?.value), phones: json<ContactField[]>(r.phones, []).filter(p => p?.value), company: r.company ?? '', title: r.title ?? '', notes: r.notes ?? '', birthday: r.birthday || null, photo: r.photo || null });
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export const nameOf = (c: Row) => c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.emails[0]?.value || '';
export const birthdayParts = (b: string | null) => { const m = b ? /^(?:(\d{4})|--)?-?(\d{2})-(\d{2})/.exec(b.trim()) : null; return m ? { year: m[1] ? Number(m[1]) : null, month: Number(m[2]), day: Number(m[3]) } : null; };
const withExtra = (notes: string, extra: string[]) => extra.length ? [notes.trim(), `— DHMail (gekopieerd) —\n${extra.join('\n')}`].filter(Boolean).join('\n\n') : notes;

async function photoBytes(photo: string | null): Promise<{ type: string; data: Buffer } | null> {
  if (!photo) return null;
  try {
    const m = /^data:(image\/[\w.+-]+);base64,(.+)$/i.exec(photo);
    if (m) return { type: m[1], data: Buffer.from(m[2], 'base64') };
    if (/^https:\/\//i.test(photo)) { const res = await fetch(photo); if (!res.ok) return null; const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0]; return type.startsWith('image/') ? { type, data: Buffer.from(await res.arrayBuffer()) } : null; }
  } catch {}
  return null;
}

// ---------- targets ----------
async function toLocal(sourceId: number, c: Row) {
  run('INSERT INTO contacts(source_id, display_name, first_name, last_name, emails, phones, company, title, notes, birthday, photo, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', sourceId, nameOf(c), c.firstName, c.lastName, JSON.stringify(c.emails), JSON.stringify(c.phones), c.company, c.title, c.notes, c.birthday, c.photo, now());
}

export function googlePerson(c: Row) {
  const b = birthdayParts(c.birthday);
  return {
    names: [{ givenName: c.firstName || undefined, familyName: c.lastName || undefined, unstructuredName: nameOf(c) }],
    emailAddresses: c.emails.map(e => ({ value: e.value, type: e.label || undefined })),
    phoneNumbers: c.phones.map(p => ({ value: p.value, type: p.label || undefined })),
    organizations: c.company || c.title ? [{ name: c.company || undefined, title: c.title || undefined }] : undefined,
    birthdays: b ? [{ date: { year: b.year ?? undefined, month: b.month, day: b.day } }] : undefined,
    biographies: c.notes ? [{ value: c.notes, contentType: 'TEXT_PLAIN' }] : undefined
  };
}
async function toGoogle(accountId: number, list: Row[], result: ContactCopyResult) {
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    try {
      const data = await gapi(accountId, 'https://people.googleapis.com/v1/people:batchCreateContacts', { method: 'POST', body: JSON.stringify({ contacts: batch.map(c => ({ contactPerson: googlePerson(c) })), readMask: 'names' }) });
      const created: any[] = data?.createdPeople ?? [];
      result.created += created.filter(p => p?.person?.resourceName).length;
      result.failed += batch.length - created.filter(p => p?.person?.resourceName).length;
      for (let k = 0; k < created.length; k++) {
        const resource = created[k]?.person?.resourceName; const photo = resource ? await photoBytes(batch[k]?.photo ?? null) : null;
        if (resource && photo) await gapi(accountId, `https://people.googleapis.com/v1/${resource}:updateContactPhoto`, { method: 'PATCH', body: JSON.stringify({ photoBytes: photo.data.toString('base64') }) }).catch(err => log('google contact photo failed', err?.message));
      }
    } catch (err: any) { result.failed += batch.length; result.errors.push(err?.message ?? String(err)); }
  }
}

export function outlookContact(c: Row) {
  const extra: string[] = [];
  const emails = c.emails.slice(0, 3); for (const e of c.emails.slice(3)) extra.push(`E-mail${e.label ? ` (${e.label})` : ''}: ${e.value}`);
  let mobile: string | null = null; const home: string[] = [], business: string[] = [];
  for (const p of c.phones) {
    const label = (p.label || '').toLowerCase();
    if (/mobi|cell|gsm|iphone/.test(label) && !mobile) mobile = p.value;
    else if (/home|thuis|privé|prive/.test(label) && home.length < 2) home.push(p.value);
    else if (!/home|thuis|privé|prive/.test(label) && business.length < 2 && !/mobi|cell|gsm|iphone/.test(label)) business.push(p.value);
    else if (!mobile && !label) mobile = p.value;
    else extra.push(`Telefoon${p.label ? ` (${p.label})` : ''}: ${p.value}`);
  }
  const b = birthdayParts(c.birthday);
  if (b && !b.year) extra.push(`Verjaardag: ${String(b.day).padStart(2, '0')}-${String(b.month).padStart(2, '0')}`);
  return {
    givenName: c.firstName || undefined, surname: c.lastName || undefined, displayName: nameOf(c),
    emailAddresses: emails.map(e => ({ address: e.value, name: nameOf(c) })),
    mobilePhone: mobile ?? undefined, homePhones: home, businessPhones: business,
    companyName: c.company || undefined, jobTitle: c.title || undefined,
    personalNotes: withExtra(c.notes, extra) || undefined,
    birthday: b?.year ? `${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}T11:59:00Z` : undefined
  };
}
async function toOutlook(accountId: number, list: Row[], result: ContactCopyResult) {
  for (const c of list) {
    try {
      const created = await graph(accountId, '/me/contacts', { method: 'POST', body: JSON.stringify(outlookContact(c)) }, true, 'contactswrite');
      result.created++;
      const photo = created?.id ? await photoBytes(c.photo) : null;
      if (photo) await graph(accountId, `/me/contacts/${encodeURIComponent(created.id)}/photo/$value`, { method: 'PUT', body: new Uint8Array(photo.data), headers: { 'Content-Type': photo.type } }, true, 'contactswrite').catch(err => log('outlook contact photo failed', err?.message));
    } catch (err: any) {
      if (err?.code === 'OAUTH_REAUTH' || err?.code === 'OAUTH_FAILED' || err?.status === 403) throw Object.assign(new Error('DHMail may not write contacts to this Outlook account yet. Add the Outlook account again to grant access, then retry.'), { code: 'CONTACTS_WRITE_CONSENT' });
      result.failed++; result.errors.push(`${nameOf(c)}: ${err?.message ?? err}`);
    }
  }
}

export const vEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
export const fold = (line: string) => { const out: string[] = []; let rest = line; while (rest.length > 75) { out.push(rest.slice(0, 75)); rest = ' ' + rest.slice(75); } out.push(rest); return out.join('\r\n'); };
export async function vcardOf(c: Row, uid: string) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${uid}`, `FN:${vEsc(nameOf(c))}`, `N:${vEsc(c.lastName)};${vEsc(c.firstName)};;;`];
  for (const e of c.emails) lines.push(`EMAIL${e.label ? `;TYPE=${vEsc(e.label).toUpperCase()}` : ''}:${vEsc(e.value)}`);
  for (const p of c.phones) lines.push(`TEL${p.label ? `;TYPE=${vEsc(p.label).toUpperCase()}` : ''}:${vEsc(p.value)}`);
  if (c.company) lines.push(`ORG:${vEsc(c.company)}`);
  if (c.title) lines.push(`TITLE:${vEsc(c.title)}`);
  if (c.notes) lines.push(`NOTE:${vEsc(c.notes)}`);
  const b = birthdayParts(c.birthday);
  if (b) lines.push(`BDAY:${b.year ? b.year : '-'}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`);
  const photo = await photoBytes(c.photo);
  if (photo) lines.push(`PHOTO;ENCODING=b;TYPE=${photo.type.split('/')[1].toUpperCase()}:${photo.data.toString('base64')}`);
  lines.push('END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}
async function toCardDav(source: any, list: Row[], result: ContactCopyResult) {
  const password = getSecret(`source:${source.id}:password`) ?? '';
  for (const c of list) {
    try { const uid = randomUUID(); await createVCard(source.url, source.username ?? '', password, source.remote_url ?? source.url, `${uid}.vcf`, await vcardOf(c, uid)); result.created++; }
    catch (err: any) { result.failed++; result.errors.push(`${nameOf(c)}: ${err?.message ?? err}`); }
  }
}

// ---------- entry point ----------
type Sync = (id: number) => Promise<void>;
const sourceRow = (id: number) => { const s = get('SELECT * FROM contact_sources WHERE id = ?', id); if (!s) throw Object.assign(new Error('Address book not found'), { status: 404 }); return s; };

/** Writes rows into an address book. With skipDuplicates, rows already present there are left out. */
async function writeRows(rows: Row[], to: any, sync: Sync, skipDuplicates: boolean): Promise<ContactCopyResult> {
  // read the target fresh so contacts that are already there are recognised
  if (skipDuplicates && to.kind !== 'local') await sync(to.id).catch(() => {});
  const existing = skipDuplicates ? readRows(to.id) : [];
  const haveEmail = new Set(existing.flatMap(c => c.emails.map(e => norm(e.value))));
  const haveName = new Set(existing.map(c => norm(nameOf(c))).filter(Boolean));
  const result: ContactCopyResult = { total: 0, created: 0, skipped: 0, failed: 0, errors: [] };
  const todo: Row[] = [];
  for (const c of rows) {
    if (!nameOf(c)) continue;
    result.total++;
    const dup = skipDuplicates && (c.emails.length ? c.emails.some(e => haveEmail.has(norm(e.value))) : haveName.has(norm(nameOf(c))));
    if (dup) { result.skipped++; continue; }
    todo.push(c);
    for (const e of c.emails) haveEmail.add(norm(e.value));
    haveName.add(norm(nameOf(c)));
  }
  if (to.kind === 'local') { for (const c of todo) { await toLocal(to.id, c); result.created++; } }
  else if (to.kind === 'google') await toGoogle(to.account_id, todo, result);
  else if (to.kind === 'microsoft') await toOutlook(to.account_id, todo, result);
  else if (to.kind === 'carddav') await toCardDav(to, todo, result);
  else throw Object.assign(new Error('This address book cannot be written to'), { status: 400 });
  if (to.kind !== 'local' && todo.length) await sync(to.id).catch(() => {});
  result.errors = result.errors.slice(0, 10);
  return result;
}

/** Copies a whole address book into another one (existing contacts in the target are skipped). */
export async function copyContacts(fromId: number, toId: number, sync: Sync): Promise<ContactCopyResult> {
  const from = sourceRow(fromId), to = sourceRow(toId);
  if (from.id === to.id) throw Object.assign(new Error('Choose two different address books'), { status: 400 });
  return writeRows(readRows(from.id), to, sync, true);
}
/** Copies one contact into another address book (skipped when it is already there). */
export async function copyContactTo(contactId: number, toId: number, sync: Sync): Promise<ContactCopyResult> {
  const row = get('SELECT * FROM contacts WHERE id = ?', contactId);
  if (!row) throw Object.assign(new Error('Contact not found'), { status: 404 });
  const to = sourceRow(toId);
  if (row.source_id === to.id) throw Object.assign(new Error('The contact is already in this address book'), { status: 400 });
  return writeRows([toRow(row)], to, sync, true);
}
/** Creates a new contact directly in an account's address book (Google, Outlook or CardDAV). */
export async function createContactIn(input: ContactInput, toId: number, sync: Sync): Promise<ContactCopyResult> {
  const row: Row = { displayName: input.displayName ?? '', firstName: input.firstName ?? '', lastName: input.lastName ?? '', emails: (input.emails ?? []).filter(e => e?.value), phones: (input.phones ?? []).filter(p => p?.value), company: input.company ?? '', title: input.title ?? '', notes: input.notes ?? '', birthday: input.birthday || null, photo: null };
  const result = await writeRows([row], sourceRow(toId), sync, false);
  if (result.failed) throw new Error(result.errors[0] ?? 'The contact could not be saved');
  return result;
}
