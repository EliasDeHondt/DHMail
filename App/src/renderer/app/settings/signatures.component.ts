import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import DOMPurify from 'dompurify';
import { StoreService } from '../core/store.service';
import { BridgeService } from '../core/bridge.service';
import { IconComponent } from '../shared/icon.component';
import { ToastService } from '../shared/toast.service';
import { DialogsService } from '../shared/dialogs.service';
import { Signature } from '../../../shared/types';

interface Draft { id?: number; name: string; html: string; accountIds: number[]; }

// Settings → Signatures: named signatures, each the default of one or more mailboxes.
@Component({ selector: 'app-signatures', standalone: true, imports: [FormsModule, TranslatePipe, IconComponent], templateUrl: './signatures.component.html', styleUrl: './signatures.component.css' })
export class SignaturesComponent {
  readonly store = inject(StoreService);
  private bridge = inject(BridgeService);
  private translate = inject(TranslateService);
  private toast = inject(ToastService);
  private dialogs = inject(DialogsService);
  @ViewChild('editor') set editorRef(ref: ElementRef<HTMLElement> | undefined) { this.editor = ref?.nativeElement; if (this.editor && this.pendingHtml !== null) { this.editor.innerHTML = this.pendingHtml; this.pendingHtml = null; } }
  private editor?: HTMLElement;
  private pendingHtml: string | null = null;
  readonly draft = signal<Draft | null>(null);
  /** shown when a shared signature is changed: for every mailbox, or only for one */
  readonly askScope = signal(false);
  scopeAccount: number | null = null;
  readonly saving = signal(false);
  readonly mailAccounts = computed(() => this.store.mailAccounts());
  accountName = (id: number) => this.store.account(id)?.email ?? '';
  usedBy(s: Signature) { return s.accountIds.map(this.accountName).filter(Boolean); }

  create() { this.open({ name: '', html: '', accountIds: [] }); }
  edit(s: Signature) { this.open({ id: s.id, name: s.name, html: s.html, accountIds: [...s.accountIds] }); }
  private open(d: Draft) { this.askScope.set(false); this.draft.set(d); const html = DOMPurify.sanitize(d.html, { ADD_ATTR: ['style', 'target'] }); if (this.editor) this.editor.innerHTML = html; else this.pendingHtml = html; }
  cancel() { this.draft.set(null); this.askScope.set(false); }
  toggleAccount(id: number, on: boolean) { const d = this.draft(); if (!d) return; d.accountIds = on ? [...new Set([...d.accountIds, id])] : d.accountIds.filter(x => x !== id); this.draft.set({ ...d }); }
  /** the signature another mailbox uses now (it would be replaced) */
  currentOf(accountId: number) { const d = this.draft(); const s = this.store.signatures().find(x => x.accountIds.includes(accountId)); return s && s.id !== d?.id ? s.name : null; }

  exec(cmd: string, value?: string) { this.editor?.focus(); document.execCommand(cmd, false, value); }
  async link() { const sel = window.getSelection(); const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null; const url = (await this.dialogs.prompt(this.translate.instant('APP.SIGNATURES.LINK_PROMPT'), 'https://', this.translate.instant('APP.COMMON.ADD')))?.trim(); if (!url || !/^(https?:|mailto:|tel:)/i.test(url)) return; this.editor?.focus(); if (range) { sel?.removeAllRanges(); sel?.addRange(range); } this.exec('createLink', url); }
  async image() { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = () => { const f = input.files?.[0]; if (f) this.insertImage(f); }; input.click(); }
  private insertImage(file: File) { if (file.size > 1_500_000) { this.toast.show(this.translate.instant('APP.SIGNATURES.IMAGE_TOO_BIG'), 'error'); return; } const r = new FileReader(); r.onload = () => this.exec('insertHTML', `<img src="${r.result}" alt="" style="max-width:240px;height:auto">`); r.readAsDataURL(file); }
  onPaste(e: ClipboardEvent) { const file = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/')); if (file) { e.preventDefault(); this.insertImage(file); } }

  private html() { return DOMPurify.sanitize(this.editor?.innerHTML ?? '', { ADD_ATTR: ['style', 'target'] }); }
  async save() {
    const d = this.draft(); if (!d) return;
    const html = this.html();
    const original = d.id ? this.store.signatures().find(s => s.id === d.id) : undefined;
    const changed = !!original && (original.html !== html || original.name !== d.name.trim());
    // a signature used by several mailboxes: ask whether the change is for all of them or for one
    const shared = original ? original.accountIds.filter(id => d.accountIds.includes(id)) : [];
    if (changed && shared.length > 1 && !this.askScope()) { this.scopeAccount = shared[0]; this.askScope.set(true); return; }
    await this.store_(() => this.bridge.invoke('signatures:save', { ...d, html }));
  }
  async saveFor(scope: 'all' | 'one') {
    const d = this.draft(); if (!d?.id) return;
    const html = this.html();
    if (scope === 'all') await this.store_(() => this.bridge.invoke('signatures:save', { ...d, html }));
    else if (this.scopeAccount) { const original = this.store.signatures().find(x => x.id === d.id); const name = original && d.name.trim() === original.name ? `${d.name.trim()} (${this.accountName(this.scopeAccount)})` : d.name; await this.store_(() => this.bridge.invoke('signatures:fork', d.id!, this.scopeAccount!, { ...d, name, html, accountIds: [this.scopeAccount!] })); }
  }
  private async store_(call: () => Promise<Signature[]>) { this.saving.set(true); try { this.store.signatures.set(await call()); this.toast.show(this.translate.instant('APP.SIGNATURES.SAVED'), 'success'); this.cancel(); } catch (err) { this.toast.error(err); } finally { this.saving.set(false); } }
  async remove(s: Signature) { if (!await this.dialogs.confirm(this.translate.instant('APP.SIGNATURES.REMOVE_CONFIRM', { name: s.name }), this.translate.instant('APP.COMMON.REMOVE'), true)) return; this.store.signatures.set(await this.bridge.invoke('signatures:remove', s.id)); if (this.draft()?.id === s.id) this.cancel(); }
}
