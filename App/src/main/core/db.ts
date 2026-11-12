import { DatabaseSync } from 'node:sqlite';
export type Row = Record<string, any>;
let db: DatabaseSync;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, provider TEXT NOT NULL, auth_type TEXT NOT NULL, imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL, smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL, username TEXT NOT NULL, color TEXT NOT NULL, signature TEXT NOT NULL DEFAULT '', features TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secrets(owner TEXT PRIMARY KEY, value BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS folders(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, path TEXT NOT NULL, name TEXT NOT NULL, parent_path TEXT, delimiter TEXT NOT NULL DEFAULT '/', special_use TEXT, unseen INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, uidvalidity INTEGER, depth INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, synced_at TEXT, lowest_uid INTEGER, complete INTEGER NOT NULL DEFAULT 0, max_uid INTEGER NOT NULL DEFAULT 0, selectable INTEGER NOT NULL DEFAULT 1, UNIQUE(account_id, path));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE, uid INTEGER NOT NULL, message_id TEXT, subject TEXT NOT NULL DEFAULT '', from_json TEXT NOT NULL DEFAULT '[]', to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]', date TEXT, size INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, answered INTEGER NOT NULL DEFAULT 0, draft INTEGER NOT NULL DEFAULT 0, has_attachments INTEGER NOT NULL DEFAULT 0, preview TEXT, preview_part TEXT, in_reply_to TEXT, UNIQUE(folder_id, uid));
CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(folder_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(account_id, message_id);
CREATE TABLE IF NOT EXISTS bodies(message_pk INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, html TEXT, text TEXT, attachments TEXT NOT NULL DEFAULT '[]', bcc_json TEXT NOT NULL DEFAULT '[]', reply_to_json TEXT NOT NULL DEFAULT '[]', in_reply_to TEXT, references_json TEXT NOT NULL DEFAULT '[]', fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS message_categories(account_id INTEGER NOT NULL, message_key TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, PRIMARY KEY(account_id, message_key, category_id));
CREATE TABLE IF NOT EXISTS calendars(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE, source TEXT NOT NULL, remote_id TEXT, name TEXT NOT NULL, color TEXT NOT NULL, url TEXT, username TEXT, visible INTEGER NOT NULL DEFAULT 1, read_only INTEGER NOT NULL DEFAULT 0, group_name TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, last_sync TEXT, error TEXT, ics_data TEXT, ctag TEXT);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, uid TEXT NOT NULL, remote_id TEXT, remote_url TEXT, etag TEXT, recurrence_id TEXT, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', start TEXT NOT NULL, end TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '', organizer TEXT, attendees TEXT NOT NULL DEFAULT '[]', recurring INTEGER NOT NULL DEFAULT 0, ics TEXT, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_range ON events(calendar_id, start, end);
CREATE TABLE IF NOT EXISTS contact_sources(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE, kind TEXT NOT NULL, url TEXT, username TEXT, name TEXT NOT NULL, last_sync TEXT, error TEXT, remote_url TEXT);
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL REFERENCES contact_sources(id) ON DELETE CASCADE, remote_id TEXT, display_name TEXT NOT NULL DEFAULT '', first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', emails TEXT NOT NULL DEFAULT '[]', phones TEXT NOT NULL DEFAULT '[]', company TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', birthday TEXT, photo TEXT, etag TEXT, remote_url TEXT, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(display_name);
CREATE TABLE IF NOT EXISTS recipients(address TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', used_at TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 1);
`;
const bind = (p: any[]) => p.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? v.toISOString() : v);
export function openDb(file: string) { db = new DatabaseSync(file); db.exec('PRAGMA journal_mode=WAL'); db.exec('PRAGMA foreign_keys=ON'); db.exec(SCHEMA); migrate(); return db; }
function migrate() { const has = (table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === col); if (!has('calendars', 'renamed')) db.exec('ALTER TABLE calendars ADD COLUMN renamed INTEGER NOT NULL DEFAULT 0'); if (!has('events', 'categories')) db.exec("ALTER TABLE events ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'"); }
export function closeDb() { if (db) db.close(); }
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...bind(p));
export const get = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).get(...bind(p)) as T | undefined;
export const all = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).all(...bind(p)) as T[];
export const lastId = (r: ReturnType<typeof run>) => Number(r.lastInsertRowid);
export function tx<T>(fn: () => T): T { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
export const now = () => new Date().toISOString();
export const json = <T>(s: string | null | undefined, fallback: T): T => { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } };
