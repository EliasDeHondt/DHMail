export type Provider = 'google' | 'microsoft' | 'imap';
export type AuthType = 'oauth' | 'password';
export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | 'important';
export type CalendarSource = 'google' | 'microsoft' | 'caldav' | 'ics' | 'local' | 'birthdays' | 'holidays';
export type ContactSourceKind = 'google' | 'microsoft' | 'carddav' | 'local';
export type AccountState = 'idle' | 'connecting' | 'online' | 'syncing' | 'error' | 'offline';
export interface AccountFeatures { mail: boolean; calendar: boolean; contacts: boolean; }
export interface Account { id: number; name: string; email: string; provider: Provider; authType: AuthType; imapHost: string; imapPort: number; imapSecure: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean; username: string; color: string; signature: string; features: AccountFeatures; sortOrder: number; createdAt: string; }
export interface AccountInput { name: string; email: string; provider: Provider; authType: AuthType; imapHost: string; imapPort: number; imapSecure: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean; username: string; password?: string; refreshToken?: string; color: string; signature?: string; features: AccountFeatures; }
export interface AccountStatus { accountId: number; state: AccountState; message?: string; }
export interface OAuthResult { email: string; name: string; refreshToken: string; }
export type OAuthProvider = 'google' | 'microsoft';
export interface ServerConfig { imapHost: string; imapPort: number; imapSecure: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean; username: string; }
export interface DiscoverResult { ok: boolean; config: ServerConfig | null; suggest: OAuthProvider | null; error: string | null; }
export interface Folder { id: number; accountId: number; path: string; name: string; parentPath: string | null; delimiter: string; specialUse: SpecialUse | null; unseen: number; total: number; depth: number; sortOrder: number; selectable: boolean; }
export interface Address { name: string; address: string; }
export interface MessageSummary { id: number; accountId: number; folderId: number; uid: number; messageId: string | null; subject: string; from: Address[]; to: Address[]; cc: Address[]; date: string | null; size: number; seen: boolean; flagged: boolean; answered: boolean; draft: boolean; hasAttachments: boolean; preview: string | null; categories: number[]; threadId?: string | null; }
export interface AttachmentInfo { index: number; filename: string; contentType: string; size: number; cid: string | null; inline: boolean; }
export interface MessageBody extends MessageSummary { html: string | null; text: string | null; attachments: AttachmentInfo[]; inReplyTo: string | null; references: string[]; bcc: Address[]; replyTo: Address[]; }
export interface ListQuery { accountId: number; folderId: number; offset: number; limit: number; search?: string; unreadOnly?: boolean; flaggedOnly?: boolean; categoryId?: number | null; }
export interface ListResult { messages: MessageSummary[]; related?: MessageSummary[]; total: number; serverTotal: number; }
export interface MessageRef { accountId: number; folderId: number; uid: number; }
export interface OutgoingAttachment { filename: string; path?: string; contentBase64?: string; contentType?: string; size: number; }
export interface OutgoingMail { accountId: number; from?: string; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; text?: string; attachments: OutgoingAttachment[]; inReplyTo?: string | null; references?: string[]; answered?: MessageRef | null; forwardOf?: MessageRef | null; draftUid?: number | null; }
export interface DraftResult { uid: number | null; }
export interface Category { id: number; name: string; color: string; sortOrder: number; }
export interface Calendar { id: number; accountId: number | null; source: CalendarSource; remoteId: string | null; name: string; color: string; url: string | null; username: string | null; visible: boolean; readOnly: boolean; group: string; sortOrder: number; lastSync: string | null; error: string | null; }
export interface Attendee { name: string; email: string; status: string; }
export interface CalendarEvent { id: number; calendarId: number; uid: string; remoteId: string | null; title: string; description: string; location: string; start: string; end: string; allDay: boolean; status: string; organizer: string | null; attendees: Attendee[]; recurring: boolean; color: string; readOnly: boolean; categories: EventCategory[]; }
export interface EventCategory { name: string; color: string; }
export interface EventInput { id?: number; calendarId: number; title: string; description: string; location: string; start: string; end: string; allDay: boolean; }
export interface CalendarInput { source: CalendarSource; name: string; color: string; url?: string; username?: string; password?: string; icsData?: string; }
export interface ContactField { value: string; label: string; }
export interface Contact { id: number; source: ContactSourceKind; accountId: number | null; sourceId: number | null; remoteId: string | null; displayName: string; firstName: string; lastName: string; emails: ContactField[]; phones: ContactField[]; company: string; title: string; notes: string; birthday: string | null; photo: string | null; readOnly: boolean; updatedAt: string; }
export interface ContactInput { id?: number; displayName: string; firstName: string; lastName: string; emails: ContactField[]; phones: ContactField[]; company: string; title: string; notes: string; birthday: string | null; }
export interface ContactSource { id: number; accountId: number | null; kind: ContactSourceKind; url: string | null; username: string | null; name: string; lastSync: string | null; error: string | null; }
export interface ContactSourceInput { name: string; url: string; username: string; password: string; }
export interface PlaceSuggestion { label: string; title: string; detail: string; }
export interface Suggestion { name: string; address: string; source: string; }
export interface Settings { theme: 'light' | 'dark' | 'system'; language: 'nl' | 'en'; blockRemoteImages: boolean; notifications: boolean; markReadDelaySeconds: number; syncIntervalMinutes: number; weekStartsOn: number; workDayStart: number; workDayEnd: number; googleClientId: string; googleClientSecret: string; microsoftClientId: string; microsoftTenant: string; defaultAccountId: number | null; darkMailBodies: boolean; autoLockMinutes: number; }
export interface LockStatus { hasPin: boolean; length: number | null; retryAfter: number; }
export interface UnlockResult { ok: boolean; retryAfter: number; }
export interface SavedFile { path: string; name: string; size: number; }
export interface AppInfo { version: string; dataPath: string; platform: string; }
export interface SyncState { accountId: number | null; kind: 'mail' | 'calendar' | 'contacts'; busy: boolean; message?: string; }
export interface Api {
  'app:info': () => AppInfo;
  'app:openExternal': (url: string) => void;
  'geo:suggest': (query: string, lang?: string) => PlaceSuggestion[];
  'app:pickFiles': () => SavedFile[];
  'app:pickFile': (filters: { name: string; extensions: string[] }[]) => { path: string; name: string; content: string } | null;
  'app:titleBar': (colors: { color: string; symbolColor: string; modal?: boolean }) => void;
  'settings:get': () => Settings;
  'settings:set': (patch: Partial<Settings>) => Settings;
  'lock:status': () => LockStatus;
  'lock:setup': (pin: string) => UnlockResult;
  'lock:unlock': (pin: string) => UnlockResult;
  'lock:change': (current: string, next: string) => UnlockResult;
  'accounts:list': () => Account[];
  'accounts:reorder': (ids: number[]) => Account[];
  'accounts:oauthReady': () => Record<OAuthProvider, boolean>;
  'accounts:connect': (provider: OAuthProvider) => Account;
  'accounts:discover': (email: string, password: string, username?: string) => DiscoverResult;
  'accounts:add': (input: AccountInput) => Account;
  'accounts:update': (id: number, patch: Partial<AccountInput>) => Account;
  'accounts:remove': (id: number) => void;
  'accounts:test': (input: AccountInput) => { ok: boolean; error?: string };
  'accounts:reauth': (id: number) => OAuthResult;
  'accounts:status': () => AccountStatus[];
  'accounts:reconnect': (id: number) => void;
  'mail:folders': (accountId: number) => Folder[];
  'mail:syncFolders': (accountId: number) => Folder[];
  'mail:syncFolder': (accountId: number, folderId: number) => void;
  'mail:loadOlder': (accountId: number, folderId: number) => number;
  'mail:list': (query: ListQuery) => ListResult;
  'mail:searchServer': (accountId: number, folderId: number, query: string) => MessageSummary[];
  'mail:get': (ref: MessageRef, markSeen: boolean) => MessageBody | null;
  'mail:attachment': (ref: MessageRef, index: number) => string | null;
  'mail:setFlags': (refs: MessageRef[], flags: { seen?: boolean; flagged?: boolean }) => void;
  'mail:move': (refs: MessageRef[], targetFolderId: number) => void;
  'mail:delete': (refs: MessageRef[]) => void;
  'mail:archive': (refs: MessageRef[]) => void;
  'mail:junk': (refs: MessageRef[], isJunk: boolean) => void;
  'mail:send': (mail: OutgoingMail) => { accepted: string[]; rejected: string[] };
  'mail:saveDraft': (mail: OutgoingMail) => DraftResult;
  'mail:discardDraft': (accountId: number, uid: number) => void;
  'mail:emptyFolder': (accountId: number, folderId: number) => void;
  'mail:createFolder': (accountId: number, path: string) => Folder[];
  'mail:deleteFolder': (accountId: number, folderId: number) => Folder[];
  'mail:renameFolder': (accountId: number, folderId: number, name: string) => Folder[];
  'mail:suggest': (query: string) => Suggestion[];
  'categories:list': () => Category[];
  'categories:save': (category: Partial<Category>) => Category[];
  'categories:remove': (id: number) => Category[];
  'categories:assign': (refs: MessageRef[], categoryId: number, assigned: boolean) => void;
  'calendar:list': () => Calendar[];
  'calendar:add': (input: CalendarInput) => Calendar[];
  'calendar:update': (id: number, patch: Partial<Calendar>) => Calendar[];
  'calendar:remove': (id: number) => Calendar[];
  'calendar:sync': (id?: number | null) => Calendar[];
  'calendar:events': (start: string, end: string) => CalendarEvent[];
  'calendar:saveEvent': (input: EventInput) => CalendarEvent;
  'calendar:deleteEvent': (id: number) => void;
  'contacts:list': (query?: string) => Contact[];
  'contacts:sources': () => ContactSource[];
  'contacts:addSource': (input: ContactSourceInput) => ContactSource[];
  'contacts:removeSource': (id: number) => ContactSource[];
  'contacts:sync': () => ContactSource[];
  'contacts:save': (input: ContactInput) => Contact;
  'contacts:remove': (id: number) => void;
  'contacts:importVcf': (vcf: string) => number;
}
export type ApiChannel = keyof Api;
export interface Events {
  'mail:changed': { accountId: number; folderId: number | null };
  'mail:new': { accountId: number; messages: MessageSummary[] };
  'mail:counts': Folder[];
  'account:status': AccountStatus;
  'calendar:changed': { calendarId: number | null };
  'contacts:changed': { sourceId: number | null };
  'sync:state': SyncState;
  'notification:open': MessageRef;
  'theme:system': { dark: boolean };
}
export type EventChannel = keyof Events;
export interface Bridge {
  invoke<K extends ApiChannel>(channel: K, ...args: Parameters<Api[K]>): Promise<ReturnType<Api[K]>>;
  on<K extends EventChannel>(channel: K, listener: (payload: Events[K]) => void): () => void;
}
