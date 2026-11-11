import { Injectable, signal } from '@angular/core';
import { MessageRef } from '../../../shared/types';
@Injectable({ providedIn: 'root' })
export class AppStateService {
  readonly search = signal('');
  readonly searchSubmit = signal(0);
  readonly pendingOpen = signal<MessageRef | null>(null);
  readonly composeTo = signal<string | null>(null);
  readonly module = signal<'mail' | 'calendar' | 'people' | 'settings' | 'welcome'>('mail');
}
