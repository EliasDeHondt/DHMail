import { Injectable, computed, signal } from '@angular/core';

export interface PendingAction { id: number; kind: string; ids: number[]; message: string; deadline: number; }

/**
 * Deletes that can still be undone. The action only runs when the countdown ends; until then the items
 * are hidden (see hidden()) and the bar at the bottom right offers "Undo", also on other pages.
 * Closing the app before the end simply means nothing is deleted.
 */
@Injectable({ providedIn: 'root' })
export class UndoService {
  readonly pending = signal<PendingAction[]>([]);
  private runs = new Map<number, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }>();
  private seq = 0;

  /** item ids of one kind that are waiting to be deleted */
  hidden(kind: string) { return computed(() => new Set(this.pending().filter(p => p.kind === kind).flatMap(p => p.ids))); }

  schedule(kind: string, ids: number[], message: string, run: () => Promise<void>, seconds = 30): number {
    const id = ++this.seq;
    const deadline = Date.now() + seconds * 1000;
    this.pending.update(list => [...list, { id, kind, ids, message, deadline }]);
    const timer = setTimeout(() => this.commit(id), seconds * 1000);
    this.runs.set(id, { timer, run });
    return id;
  }

  undo(id: number) { const r = this.runs.get(id); if (r) clearTimeout(r.timer); this.runs.delete(id); this.pending.update(list => list.filter(p => p.id !== id)); }

  /** do it now (the countdown ended, or "delete now" was chosen) */
  async commit(id: number) {
    const r = this.runs.get(id); if (!r) return;
    clearTimeout(r.timer); this.runs.delete(id);
    try { await r.run(); } finally { this.pending.update(list => list.filter(p => p.id !== id)); }
  }
}
