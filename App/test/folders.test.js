const test = require('node:test');
const assert = require('node:assert');
const { openDb, closeDb, run } = require('../dist/main/main/core/db.js');
const { getFolders } = require('../dist/main/main/mail/sync.js');

test('every mailbox shows one archive folder', () => {
  openDb(':memory:');
  try {
    for (const id of [1, 2, 3]) run("INSERT INTO accounts(id, name, email, provider, auth_type, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, color, features, created_at) VALUES (?, 'A', 'a@x.be', 'imap', 'password', 'h', 993, 1, 'h', 465, 1, 'a', '#4f94f0', '{}', '2026-01-01')", id);
    const add = (account, path, special, order = 9) => run('INSERT INTO folders(account_id, path, name, special_use, sort_order) VALUES (?, ?, ?, ?, ?)', account, path, path.split('/').pop(), special, order);
    // Gmail: no archive folder, All Mail is the archive
    add(1, 'INBOX', 'inbox', 0); add(1, '[Gmail]/All Mail', 'all', 6); add(1, '[Gmail]/Important', 'important', 8);
    // Outlook-style: a real Archive plus a duplicate "Archiveren"
    add(2, 'INBOX', 'inbox', 0); add(2, 'Archive', 'archive', 3); add(2, 'Archiveren', 'archive', 3); add(2, 'Notes', null);
    // a mailbox with its own named folder
    add(3, 'INBOX', 'inbox', 0); add(3, 'Projecten', null);
    const names = id => getFolders(id).map(f => `${f.name}:${f.specialUse ?? '-'}`);
    assert.deepStrictEqual(names(1), ['INBOX:inbox', 'All Mail:archive']);
    assert.deepStrictEqual(names(2), ['INBOX:inbox', 'Archive:archive']);
    assert.deepStrictEqual(names(3), ['INBOX:inbox', 'Projecten:-']);
  } finally { closeDb(); }
});
