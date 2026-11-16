/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

const test = require('node:test');
const assert = require('node:assert');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { moveDataFolder } = require('../dist/main/main/core/migrate-data.js');

const fill = dir => { mkdirSync(join(dir, 'Network'), { recursive: true }); writeFileSync(join(dir, 'dhmail.db'), 'mail'); writeFileSync(join(dir, 'dhmail.db-wal'), 'wal'); writeFileSync(join(dir, 'Local State'), 'old key'); writeFileSync(join(dir, 'Network', 'Cookies'), 'c'); };

test('data of the DHDMail test build moves back to DHMail', () => {
  const root = mkdtempSync(join(tmpdir(), 'dhd-'));
  try {
    const oldDir = join(root, 'DHDMail'), newDir = join(root, 'DHMail'); fill(oldDir);
    assert.strictEqual(moveDataFolder(oldDir, newDir), true);
    assert.strictEqual(readFileSync(join(newDir, 'dhmail.db'), 'utf8'), 'mail');
    assert.strictEqual(readFileSync(join(newDir, 'dhmail.db-wal'), 'utf8'), 'wal');
    assert.ok(existsSync(join(newDir, 'Network', 'Cookies')));
    assert.ok(!existsSync(oldDir));
    assert.strictEqual(moveDataFolder(oldDir, newDir), false, 'only once');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('files Electron already made in the new folder are replaced by the old ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'dhd-'));
  try {
    const oldDir = join(root, 'DHDMail'), newDir = join(root, 'DHMail'); fill(oldDir);
    mkdirSync(newDir); writeFileSync(join(newDir, 'Local State'), 'new key'); mkdirSync(join(newDir, 'Network'));
    assert.strictEqual(moveDataFolder(oldDir, newDir), true);
    assert.strictEqual(readFileSync(join(newDir, 'Local State'), 'utf8'), 'old key');
    assert.strictEqual(readFileSync(join(newDir, 'dhmail.db'), 'utf8'), 'mail');
    assert.ok(existsSync(join(newDir, 'Network', 'Cookies')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a new folder that already has mail is never overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'dhd-'));
  try {
    const oldDir = join(root, 'DHDMail'), newDir = join(root, 'DHMail'); fill(oldDir);
    mkdirSync(newDir); writeFileSync(join(newDir, 'dhmail.db'), 'newer');
    assert.strictEqual(moveDataFolder(oldDir, newDir), false);
    assert.strictEqual(readFileSync(join(newDir, 'dhmail.db'), 'utf8'), 'newer');
    assert.ok(existsSync(join(oldDir, 'dhmail.db')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});