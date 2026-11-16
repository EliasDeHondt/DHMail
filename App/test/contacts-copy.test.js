/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

const test = require('node:test');
const assert = require('node:assert');
const { openDb, closeDb, run, all } = require('../dist/main/main/core/db.js');
const { copyContacts, outlookContact, vcardOf } = require('../dist/main/main/contacts/copy.js');

const full = { displayName: 'Tina Van den Driessche', firstName: 'Tina', lastName: 'Van den Driessche', emails: [1, 2, 3, 4, 5].map(i => ({ value: `tina${i}@x.be`, label: i === 1 ? 'home' : 'work' })), phones: [{ value: '0470 11 22 33', label: 'mobile' }, { value: '0470 99 88 77', label: 'mobile' }, { value: '03 123 45 67', label: 'home' }, { value: '03 765 43 21', label: 'work' }], company: 'UAntwerpen', title: 'Student', notes: 'Kent Elias van school', birthday: '--05-12', photo: null };

test('outlook mapping keeps every detail (extras go to the notes)', () => {
  const o = outlookContact(full);
  assert.strictEqual(o.emailAddresses.length, 3);
  assert.strictEqual(o.mobilePhone, '0470 11 22 33');
  assert.deepStrictEqual(o.homePhones, ['03 123 45 67']);
  assert.deepStrictEqual(o.businessPhones, ['03 765 43 21']);
  assert.strictEqual(o.birthday, undefined);
  for (const lost of ['tina4@x.be', 'tina5@x.be', '0470 99 88 77', 'Verjaardag: 12-05', 'Kent Elias van school']) assert.ok(o.personalNotes.includes(lost), lost);
  assert.strictEqual(outlookContact({ ...full, birthday: '1999-05-12' }).birthday, '1999-05-12T11:59:00Z');
});

test('vcard keeps every detail', async () => {
  const v = await vcardOf(full, 'u1');
  for (const part of ['FN:Tina Van den Driessche', 'N:Van den Driessche;Tina;;;', 'EMAIL;TYPE=WORK:tina5@x.be', 'TEL;TYPE=MOBILE:0470 99 88 77', 'ORG:UAntwerpen', 'TITLE:Student', 'BDAY:--05-12', 'NOTE:Kent Elias van school']) assert.ok(v.includes(part), part);
});

test('copy skips contacts that already exist and keeps all fields', async () => {
  openDb(':memory:');
  try {
    run("INSERT INTO contact_sources(id, kind, name) VALUES (1, 'carddav', 'Bron'), (2, 'local', 'DHMail')");
    const add = (source, name, emails, extra = {}) => run('INSERT INTO contacts(source_id, display_name, first_name, last_name, emails, phones, company, title, notes, birthday, photo, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', source, name, extra.first ?? '', extra.last ?? '', JSON.stringify(emails.map(value => ({ value, label: '' }))), JSON.stringify(extra.phones ?? []), extra.company ?? '', '', extra.notes ?? '', extra.birthday ?? null, extra.photo ?? null, '2026-01-01');
    add(1, 'Tina', ['tina@x.be'], { phones: [{ value: '0470', label: 'mobile' }], company: 'UA', notes: 'n', birthday: '--05-12', photo: 'data:image/png;base64,AAAA' });
    add(1, 'Casper', ['casper@x.be']);
    add(1, 'Zonder Mail', []);
    add(2, 'Casper V.', ['CASPER@x.be']);
    const r = await copyContacts(1, 2, async () => {});
    assert.deepStrictEqual({ total: r.total, created: r.created, skipped: r.skipped, failed: r.failed }, { total: 3, created: 2, skipped: 1, failed: 0 });
    const tina = all("SELECT * FROM contacts WHERE source_id = 2 AND display_name = 'Tina'")[0];
    assert.strictEqual(tina.company, 'UA'); assert.strictEqual(tina.birthday, '--05-12'); assert.strictEqual(tina.photo, 'data:image/png;base64,AAAA'); assert.ok(tina.phones.includes('0470'));
    assert.strictEqual(all('SELECT COUNT(*) AS n FROM contacts WHERE source_id = 1')[0].n, 3, 'source untouched');
    await assert.rejects(copyContacts(1, 1, async () => {}));
  } finally { closeDb(); }
});