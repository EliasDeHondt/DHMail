import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BridgeService } from '../core/bridge.service';
import { EMAIL_RE } from '../core/format';
import { Suggestion } from '../../../shared/types';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
@Component({ selector: 'app-recipients-input', standalone: true, imports: [FormsModule, IconComponent, AvatarComponent], templateUrl: './recipients-input.component.html', styleUrl: './recipients-input.component.css' })
export class RecipientsInputComponent {
  private bridge = inject(BridgeService);
  @Input() placeholder = '';
  @Input() chips: string[] = [];
  @Output() chipsChange = new EventEmitter<string[]>();
  @ViewChild('draftInput') draftInput?: ElementRef<HTMLInputElement>;
  draft = '';
  readonly suggestions = signal<Suggestion[]>([]);
  readonly active = signal(0);
  private timer: any = null;
  private seq = 0;
  isValid = (chip: string) => EMAIL_RE.test(extractAddress(chip));
  private emit() { this.chipsChange.emit([...this.chips]); }
  private add(value: string) { const v = value.trim().replace(/[,;]+$/, ''); if (!v) return; if (!this.chips.some(c => extractAddress(c).toLowerCase() === extractAddress(v).toLowerCase())) { this.chips = [...this.chips, v]; this.emit(); } }
  commit() { const s = this.suggestions()[this.active()]; if (s && this.draft) this.choose(s); else { this.add(this.draft); this.draft = ''; this.suggestions.set([]); } }
  choose(s: Suggestion) { this.add(s.name ? `${s.name} <${s.address}>` : s.address); this.draft = ''; this.suggestions.set([]); this.draftInput?.nativeElement.focus(); }
  onInput() { clearTimeout(this.timer); const q = this.draft.trim(); if (!q) { this.suggestions.set([]); return; } const id = ++this.seq; this.timer = setTimeout(() => this.bridge.invoke('mail:suggest', q).then(list => { if (id !== this.seq) return; this.suggestions.set(list); this.active.set(0); }).catch(() => {}), 120); }
  onKeydown(e: KeyboardEvent) { const list = this.suggestions(); if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); this.active.set((this.active() + 1) % list.length); return; } if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); this.active.set((this.active() - 1 + list.length) % list.length); return; } if (e.key === 'Enter' || e.key === 'Tab' && this.draft.trim() || e.key === ',' || e.key === ';') { if (this.draft.trim()) { e.preventDefault(); this.commit(); } return; } if (e.key === 'Escape') { this.suggestions.set([]); return; } if (e.key === 'Backspace' && !this.draft && this.chips.length) { this.chips = this.chips.slice(0, -1); this.emit(); } }
  onPaste(e: ClipboardEvent) { const text = e.clipboardData?.getData('text') ?? ''; if (!/[,;\n]/.test(text)) return; e.preventDefault(); for (const part of text.split(/[,;\n]/)) this.add(part); }
  onBlur() { setTimeout(() => { if (this.draft.trim()) { this.add(this.draft); this.draft = ''; } this.suggestions.set([]); }, 150); }
  remove(i: number) { this.chips = this.chips.filter((_, idx) => idx !== i); this.emit(); }
  focus() { this.draftInput?.nativeElement.focus(); }
}
export const extractAddress = (chip: string) => { const m = /<([^>]+)>\s*$/.exec(chip); return (m ? m[1] : chip).trim(); };
export const chipName = (chip: string) => { const m = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(chip); return m ? m[1].trim() : ''; };
