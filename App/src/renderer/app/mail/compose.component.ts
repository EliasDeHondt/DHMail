import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import DOMPurify from 'dompurify';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { EMAIL_RE, formatBytes } from '../core/format';
import { IconComponent } from '../shared/icon.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService } from '../shared/dialogs.service';
import { RecipientsInputComponent, extractAddress } from '../shared/recipients-input.component';
import { MessageRef, OutgoingAttachment } from '../../../shared/types';
export interface ComposeInit { mode: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'; accountId: number; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; inReplyTo: string | null; references: string[]; answered: MessageRef | null; forwardOf: MessageRef | null; draftUid: number | null; attachments: OutgoingAttachment[]; }
const MAX_TOTAL = 35 * 1024 * 1024;
/** the fixed font for everything typed or pasted in a mail (signature and quote excluded) */
const BODY_STYLE = 'font-family:Arial,sans-serif;font-size:12pt';
@Component({ selector: 'app-compose', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent, RecipientsInputComponent], templateUrl: './compose.component.html', styleUrl: './compose.component.css' })
export class ComposeComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(StoreService);
  private bridge = inject(BridgeService);
  private toast = inject(ToastService);
  private dialogs = inject(DialogsService);
  private translate = inject(TranslateService);
  @Input({ required: true }) init!: ComposeInit;
  @Output() done = new EventEmitter<boolean>();
  @ViewChild('editor') editor?: ElementRef<HTMLDivElement>;
  @ViewChild('subjectInput') subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('toInput') toInput?: RecipientsInputComponent;
  accountId = 0;
  to: string[] = [];
  cc: string[] = [];
  bcc: string[] = [];
  subject = '';
  attachments: OutgoingAttachment[] = [];
  readonly showCc = signal(false);
  readonly showBcc = signal(false);
  readonly sending = signal(false);
  readonly saving = signal(false);
  readonly status = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly dirty = signal(false);
  readonly draftUid = signal<number | null>(null);
  readonly totalSize = computed(() => this.attachments.reduce((n, a) => n + a.size, 0));
  private autosave: any = null;
  formatBytes = formatBytes;
  /** signature in this message (null = none) */
  signatureId: number | null = null;
  private signatureBlock(id: number | null) { const s = id ? this.store.signatures().find(x => x.id === id) : null; return s ? `<br><br><div class="dhmail-signature">${DOMPurify.sanitize(s.html, { ADD_ATTR: ['style', 'target'] })}</div>` : '<div class="dhmail-signature"></div>'; }
  /** replaces the signature block in the editor (other mailbox chosen, or another signature picked) */
  setSignature(id: number | null) { this.signatureId = id; const el = this.editor?.nativeElement; if (!el) return; const s = id ? this.store.signatures().find(x => x.id === id) : null; let block = el.querySelector<HTMLElement>('.dhmail-signature'); if (!block) { block = document.createElement('div'); block.className = 'dhmail-signature'; const quote = el.querySelector('blockquote, .dhmail-quote'); if (quote) el.insertBefore(block, quote); else el.appendChild(block); } block.innerHTML = s ? DOMPurify.sanitize(s.html, { ADD_ATTR: ['style', 'target'] }) : ''; this.markDirty(); }
  accountChanged() { this.markDirty(); const def = this.store.signatureFor(this.accountId); if ((def?.id ?? null) !== this.signatureId) this.setSignature(def?.id ?? null); }
  ngAfterViewInit() { this.accountId = this.init.accountId; this.to = [...this.init.to]; this.cc = [...this.init.cc]; this.bcc = [...this.init.bcc]; this.subject = this.init.subject; this.attachments = [...this.init.attachments]; this.draftUid.set(this.init.draftUid); this.showCc.set(this.cc.length > 0); this.showBcc.set(this.bcc.length > 0); this.signatureId = this.store.signatureFor(this.accountId)?.id ?? null; const signature = this.init.mode === 'draft' ? '' : this.signatureBlock(this.signatureId); const html = this.init.mode === 'draft' ? this.init.html : (this.init.mode === 'new' ? '<br>' : '') + signature + this.init.html; queueMicrotask(() => { document.execCommand('defaultParagraphSeparator', false, 'div'); const el = this.editor?.nativeElement; if (el) { el.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['style'] }); el.querySelectorAll('.dhmail-body').forEach(d => d.replaceWith(...Array.from(d.childNodes))); } if (this.init.mode === 'new') this.toInput?.focus(); else if (this.init.mode === 'forward') this.toInput?.focus(); else { el?.focus(); const sel = window.getSelection(); if (el && sel) { const range = document.createRange(); range.setStart(el, 0); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); } } }); }
  ngOnDestroy() { clearTimeout(this.autosave); }
  markDirty() { this.dirty.set(true); clearTimeout(this.autosave); this.autosave = setTimeout(() => this.saveDraft(true), 30000); }
  exec(cmd: string, value?: string) { this.editor?.nativeElement.focus(); document.execCommand(cmd, false, value); this.markDirty(); }
  async link() { const sel = window.getSelection(); const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null; const url = await this.dialogs.prompt(this.translate.instant('APP.MAIL.LINK_PROMPT'), 'https://', this.translate.instant('APP.COMMON.ADD')); if (!url?.trim()) return; this.editor?.nativeElement.focus(); if (range) { sel?.removeAllRanges(); sel?.addRange(range); } this.exec('createLink', url.trim()); }
  /** pasting always drops the formatting (like Notepad): only the plain text goes in, in the body font */
  onPaste(e: ClipboardEvent) { const html = e.clipboardData?.getData('text/html') ?? ''; const text = e.clipboardData?.getData('text/plain') || (html ? new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '' : ''); if (!text && !html) return; e.preventDefault(); if (text) document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n')); this.markDirty(); }
  async addFiles() { try { const files = await this.bridge.invoke('app:pickFiles'); for (const f of files) { if (this.attachments.some(a => a.path === f.path)) continue; if (this.totalSize() + f.size > MAX_TOTAL) { this.toast.show(this.translate.instant('APP.MAIL.ATTACHMENTS_TOO_LARGE'), 'error'); break; } this.attachments = [...this.attachments, { filename: f.name, path: f.path, size: f.size }]; } this.markDirty(); } catch (err) { this.toast.error(err); } }
  onDrop(e: DragEvent) { e.preventDefault(); const files = Array.from(e.dataTransfer?.files ?? []); for (const f of files) { const path = (f as any).path as string | undefined; if (path) { if (this.attachments.some(a => a.path === path)) continue; this.attachments = [...this.attachments, { filename: f.name, path, size: f.size }]; } else { const reader = new FileReader(); reader.onload = () => { const b64 = String(reader.result).split(',')[1] ?? ''; this.attachments = [...this.attachments, { filename: f.name, contentBase64: b64, contentType: f.type, size: f.size }]; }; reader.readAsDataURL(f); } } this.markDirty(); }
  removeAttachment(i: number) { this.attachments = this.attachments.filter((_, idx) => idx !== i); this.markDirty(); }
  /** the editor HTML for sending/saving: everything the user wrote is wrapped in Arial 12pt; the signature and the quoted mail keep their own look */
  private bodyHtml() { const el = this.editor?.nativeElement; if (!el) return ''; const root = el.cloneNode(true) as HTMLElement; let run: HTMLElement | null = null; for (const node of Array.from(root.childNodes)) { if (node instanceof HTMLElement && node.matches('.dhmail-signature, .dhmail-quote')) { run = null; continue; } if (!run) { run = document.createElement('div'); run.className = 'dhmail-body'; run.setAttribute('style', BODY_STYLE); root.insertBefore(run, node); } run.appendChild(node); } return root.innerHTML; }
  private payload() { const html = this.bodyHtml(); return { accountId: this.accountId, to: this.to.map(c => c.trim()), cc: this.cc.map(c => c.trim()), bcc: this.bcc.map(c => c.trim()), subject: this.subject.trim(), html, attachments: this.attachments, inReplyTo: this.init.inReplyTo, references: this.init.references, answered: this.init.answered, forwardOf: this.init.forwardOf, draftUid: this.draftUid() }; }
  invalid = () => [...this.to, ...this.cc, ...this.bcc].filter(c => !EMAIL_RE.test(extractAddress(c)));
  async send() { if (this.sending()) return; this.error.set(null); if (!this.to.length && !this.cc.length && !this.bcc.length) { this.error.set(this.translate.instant('APP.MAIL.NO_RECIPIENTS')); this.toInput?.focus(); return; } const bad = this.invalid(); if (bad.length) { this.error.set(this.translate.instant('APP.MAIL.INVALID_RECIPIENT', { address: bad[0] })); return; } if (!this.subject.trim() && !await this.dialogs.confirm(this.translate.instant('APP.MAIL.NO_SUBJECT_CONFIRM'), this.translate.instant('APP.MAIL.SEND'))) return; this.sending.set(true); this.status.set(this.translate.instant('APP.MAIL.SENDING')); clearTimeout(this.autosave); try { const r = await this.bridge.invoke('mail:send', this.payload()); if (r.rejected.length) this.toast.show(this.translate.instant('APP.MAIL.PARTIALLY_REJECTED', { list: r.rejected.join(', ') }), 'error'); this.dirty.set(false); this.done.emit(true); } catch (err) { this.error.set(err instanceof Error ? err.message : String(err)); this.status.set(null); } finally { this.sending.set(false); } }
  async saveDraft(auto = false) { if (this.saving() || this.sending()) return; if (auto && !this.dirty()) return; this.saving.set(true); this.status.set(this.translate.instant('APP.MAIL.SAVING_DRAFT')); try { const r = await this.bridge.invoke('mail:saveDraft', this.payload()); this.draftUid.set(r.uid); this.dirty.set(false); this.status.set(this.translate.instant('APP.MAIL.DRAFT_SAVED')); if (!auto) { this.done.emit(false); } } catch (err) { this.status.set(null); if (!auto) this.toast.error(err); } finally { this.saving.set(false); } }
  async discard() { if (this.dirty() && !await this.dialogs.confirm(this.translate.instant('APP.MAIL.DISCARD_CONFIRM'), this.translate.instant('APP.MAIL.DISCARD'), true)) return; clearTimeout(this.autosave); const uid = this.draftUid(); if (uid && this.init.mode === 'draft' || uid) { if (await this.dialogs.confirm(this.translate.instant('APP.MAIL.DELETE_DRAFT_CONFIRM'), this.translate.instant('APP.COMMON.DELETE'), true)) this.bridge.invoke('mail:discardDraft', this.accountId, uid).catch(err => this.toast.error(err)); } this.done.emit(false); }
  @HostListener('document:keydown', ['$event']) onKey(e: KeyboardEvent) { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); this.send(); } else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveDraft(false); } else if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest('.suggest')) { this.discard(); } }
}
