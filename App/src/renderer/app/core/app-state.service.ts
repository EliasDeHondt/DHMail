/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

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