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
  const worker = async () => { while (next < todo.length) { const c = todo[next++]; try { c.photo = await graphDataUrl(accountId, `/me/contacts/${encodeURIComponent(c.remoteId!)}/photo/$value`); if (!c.photo) checkedWithoutPhoto.set(`${accountId}:${c.remoteId}`, Date.now()); } catch (err: any) { if (err?.status === 429) { log('contact photos throttled'); next = todo.length; } } } };
  await Promise.all(Array.from({ length: 6 }, worker));
}
