/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

const test = require('node:test');
const assert = require('node:assert');
const { openDb, closeDb, run } = require('../dist/main/main/core/db.js');
const { ruleMatches, planFor, saveRule, listRules, reorderRules } = require('../dist/main/main/mail/rules.js');

const mail = (from, subject = '', to = []) => ({ accountId: 1, from: [{ name: 'Shop', address: from }], to: to.map(a => ({ name: '', address: a })), cc: [], subject });
const rule = (id, conditions, actions, extra = {}) => ({ id, name: 'r' + id, accountId: null, enabled: true, matchAll: true, conditions, actions: { destination: 'none', folderPath: null, categoryIds: [], markRead: false, flag: false, ...actions }, stop: false, sortOrder: id, ...extra });

test('conditions match on address, domain, name and subject (case-insensitive, comma lists)', () => {
  assert.ok(ruleMatches({ matchAll: true, conditions: [{ field: 'from', value: 'News@Shop.be' }] }, mail('news@shop.be')));
  assert.ok(ruleMatches({ matchAll: true, conditions: [{ field: 'from', value: 'x@y.be, @shop.be' }] }, mail('news@shop.be')));
  assert.ok(ruleMatches({ matchAll: true, conditions: [{ field: 'from', value: 'shop' }] }, mail('a@b.be')), 'display name counts');
  assert.ok(!ruleMatches({ matchAll: true, conditions: [{ field: 'from', value: 'other.be' }] }, mail('news@shop.be')));
  assert.ok(ruleMatches({ matchAll: true, conditions: [{ field: 'to', value: 'me@x.be' }] }, mail('a@b.be', '', ['me@x.be'])));
  const both = [{ field: 'from', value: 'shop.be' }, { field: 'subject', value: 'factuur' }];
  assert.ok(!ruleMatches({ matchAll: true, conditions: both }, mail('a@shop.be', 'Nieuws')));
  assert.ok(ruleMatches({ matchAll: false, conditions: both }, mail('a@shop.be', 'Nieuws')));
  assert.ok(!ruleMatches({ matchAll: true, conditions: [{ field: 'from', value: ' , ' }] }, mail('a@shop.be')), 'empty rule matches nothing');
});

test('plans combine rules in order; the first destination wins and stop ends the chain', () => {
  const rules = [rule(1, [{ field: 'from', value: 'shop.be' }], { destination: 'junk', categoryIds: [2] }), rule(2, [{ field: 'from', value: 'shop.be' }], { destination: 'archive', markRead: true }, { stop: true }), rule(3, [{ field: 'from', value: 'shop.be' }], { flag: true })];
  assert.deepStrictEqual(planFor(rules, mail('a@shop.be')), { destination: 'junk', folderPath: null, categoryIds: [2], markRead: true, flag: false });
  assert.strictEqual(planFor(rules, mail('a@other.be')), null);
  assert.strictEqual(planFor([rule(1, [{ field: 'from', value: 'shop.be' }], { flag: true }, { accountId: 2 })], mail('a@shop.be')), null, 'rule for another mailbox');
});

test('rules are validated, stored and reordered', () => {
  openDb(':memory:');
  try {
    run("INSERT INTO accounts(id, name, email, provider, auth_type, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, color, features, created_at) VALUES (1, 'A', 'a@x.be', 'imap', 'password', 'h', 993, 1, 'h', 465, 1, 'a', '#4f94f0', '{}', '2026-01-01')");
    assert.throws(() => saveRule({ conditions: [], actions: { destination: 'junk' } }));
    assert.throws(() => saveRule({ conditions: [{ field: 'from', value: 'x' }], actions: { destination: 'none' } }));
    // a folder needs one mailbox
    assert.throws(() => saveRule({ accountId: null, conditions: [{ field: 'from', value: 'x' }], actions: { destination: 'folder', folderPath: 'Werk' } }));
    saveRule({ accountId: 1, conditions: [{ field: 'from', value: ' spam@x.be ' }], actions: { destination: 'junk' } });
    saveRule({ name: 'Werk', accountId: 1, conditions: [{ field: 'subject', value: 'werk' }], actions: { destination: 'folder', folderPath: 'Werk', categoryIds: [3, 3] } });
    let rules = listRules();
    assert.deepStrictEqual(rules.map(r => r.name), ['spam@x.be', 'Werk']);
    assert.deepStrictEqual(rules[1].actions, { destination: 'folder', folderPath: 'Werk', categoryIds: [3], markRead: false, flag: false });
    rules = reorderRules([rules[1].id, rules[0].id]);
    assert.deepStrictEqual(rules.map(r => r.name), ['Werk', 'spam@x.be']);
    run('DELETE FROM accounts WHERE id = 1');
    assert.strictEqual(listRules().length, 0, 'rules go with their mailbox');
  } finally { closeDb(); }
});