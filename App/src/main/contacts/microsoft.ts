import { graphAll, graphDataUrl } from '../calendar/microsoft';
import { log } from '../core/bus';
import { ParsedContact } from './vcard';
export async function microsoftContacts(accountId: number, known: Map<string, string | null> = new Map()): Promise<ParsedContact[]> { const items = await graphAll(accountId, '/me/contacts?$top=500&$select=id,displayName,givenName,surname,emailAddresses,businessPhones,homePhones,mobilePhone,companyName,jobTitle,personalNotes,birthday'); const out: ParsedContact[] = []; for (const c of items) { const emails = (c.emailAddresses ?? []).map((e: any) => ({ value: e.address ?? '', label: '' })).filter((e: any) => e.value); const display = c.displayName || [c.givenName, c.surname].filter(Boolean).join(' ') || emails[0]?.value; if (!display) continue; const phones = [...(c.businessPhones ?? []).map((v: string) => ({ value: v, label: 'work' })), ...(c.homePhones ?? []).map((v: string) => ({ value: v, label: 'home' })), ...(c.mobilePhone ? [{ value: c.mobilePhone, label: 'mobile' }] : [])]; out.push({ remoteId: c.id, displayName: display, firstName: c.givenName ?? '', lastName: c.surname ?? '', emails, phones, company: c.companyName ?? '', title: c.jobTitle ?? '', notes: c.personalNotes ?? '', birthday: c.birthday ? String(c.birthday).slice(0, 10) : null, photo: null }); } await attachPhotos(accountId, out, known); return out; }
// Outlook keeps contact photos behind a separate request per contact: reuse what is already stored and only
// ask again for contacts without a photo once every 12 hours.
const checkedWithoutPhoto = new Map<string, number>();
async function attachPhotos(accountId: number, list: ParsedContact[], known: Map<string, string | null>) {
  const todo = list.filter(c => { if (!c.remoteId) return false; const have = known.get(c.remoteId); if (have) { c.photo = have; return false; } return Date.now() - (checkedWithoutPhoto.get(`${accountId}:${c.remoteId}`) ?? 0) > 12 * 3600_000; });
  let next = 0;
  // Outlook allows only a few parallel requests per mailbox: 3 workers, and wait + retry when it asks us to slow down
  let failures = 0;
  const fetchPhoto = async (c: ParsedContact) => { for (let attempt = 0; attempt < 4; attempt++) { try { return { photo: await graphDataUrl(accountId, `/me/contacts/${encodeURIComponent(c.remoteId!)}/photo/$value`), ok: true }; } catch (err: any) { const status = err?.status ?? 0; if (status !== 429 && status < 500) return { photo: null, ok: false }; await new Promise(r => setTimeout(r, (err?.retryAfter ?? 2 ** attempt) * 1000)); } } return { photo: null, ok: false }; };
  const worker = async () => { while (next < todo.length && failures < 25) { const c = todo[next++]; const r = await fetchPhoto(c); c.photo = r.photo; if (r.ok && !r.photo) checkedWithoutPhoto.set(`${accountId}:${c.remoteId}`, Date.now()); if (!r.ok) failures++; } };
  await Promise.all(Array.from({ length: 3 }, worker));
  if (failures) log('contact photos: some could not be loaded', failures);
}
