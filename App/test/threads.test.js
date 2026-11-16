/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

const test = require('node:test');
const assert = require('node:assert');
const { openDb, closeDb, run } = require('../dist/main/main/core/db.js');
const { threadIndex } = require('../dist/main/main/mail/threads.js');

test('conversations group replies by headers and by reply subject', () => {
  openDb(':memory:');
  try {
    run("INSERT INTO accounts(id, name, email, provider, auth_type, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, color, features, created_at) VALUES (1, 'A', 'a@x.be', 'imap', 'password', 'h', 993, 1, 'h', 465, 1, 'a', '#4f94f0', '{}', '2026-01-01')");
    run("INSERT INTO folders(id, account_id, path, name) VALUES (1, 1, 'INBOX', 'INBOX'), (2, 1, 'Sent', 'Sent')");
    const add = (id, folder, mid, irt, subject) => run('INSERT INTO messages(id, account_id, folder_id, uid, message_id, in_reply_to, subject) VALUES (?, 1, ?, ?, ?, ?, ?)', id, folder, id, mid, irt, subject);
    add(1, 1, '<a@x>', null, 'Statuut student');
    add(2, 2, '<b@x>', '<a@x>', 'Re: Statuut student');
    add(3, 1, '<c@x>', '<b@x>', 'Antw: Statuut student');
    add(4, 1, '<d@x>', null, 'RE: Statuut student');
    add(5, 1, '<e@x>', null, 'Iets anders');
    add(6, 1, '<f@x>', null, 'Statuut');
    const idx = threadIndex(1);
    const t = id => idx.threadOf.get(id);
    assert.strictEqual(t(2), t(1));
    assert.strictEqual(t(3), t(1));
    assert.strictEqual(t(4), t(1));
    assert.notStrictEqual(t(5), t(1));
    assert.notStrictEqual(t(6), t(1));
    assert.deepStrictEqual(idx.members.get(t(1)).sort(), [1, 2, 3, 4]);
  } finally { closeDb(); }
});