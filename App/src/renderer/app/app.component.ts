import { Component, HostListener, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs/operators';
import { StoreService } from './core/store.service';
import { BridgeService } from './core/bridge.service';
import { ThemeService } from './core/theme.service';
import { AppStateService } from './core/app-state.service';
import { IconComponent } from './shared/icon.component';
import { LogoComponent } from './shared/logo.component';
import { OverlaysComponent } from './shared/overlays.component';
import { ToastService } from './shared/toast.service';
import { LockService } from './core/lock.service';
import { LockScreenComponent } from './shared/lock-screen.component';
import { UndoBarComponent } from './shared/undo-bar.component';
import { enableCustomSelects } from './core/custom-select';
@Component({ selector: 'app-root', standalone: true, imports: [RouterModule, FormsModule, TranslatePipe, IconComponent, LogoComponent, OverlaysComponent, LockScreenComponent, UndoBarComponent], templateUrl: './app.component.html', styleUrl: './app.component.css' })
export class AppComponent {
  readonly store = inject(StoreService);
  readonly theme = inject(ThemeService);
  readonly state = inject(AppStateService);
  readonly lock = inject(LockService);
  private initializing = false;
  private bridge = inject(BridgeService);
  private router = inject(Router);
  private toast = inject(ToastService);
  readonly failed = signal<string | null>(null);
  readonly busy = computed(() => Object.values(this.store.statuses()).some(s => s.state === 'syncing' || s.state === 'connecting') || !!this.store.syncState());
  readonly errors = computed(() => Object.values(this.store.statuses()).filter(s => s.state === 'error').length);
  constructor() { this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => { const seg = (e as NavigationEnd).urlAfterRedirects.split(/[/?#]/).filter(Boolean)[0] as any; this.state.module.set(seg || 'mail'); }); effect(() => { if (this.lock.mode() === 'unlocked') untracked(() => this.openApp()); }); this.watchModals(); enableCustomSelects(); this.boot(); }
  // dim + disable the native window buttons whenever a dialog backdrop (.overlay) is on screen
  private watchModals() { inject(NgZone).runOutsideAngular(() => { let queued = false; const check = () => { queued = false; this.theme.setModal(!!document.querySelector('.overlay')); }; new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(check); } }).observe(document.body, { childList: true, subtree: true }); }); }
  // settings first (theme + language for the lock screen), then the PIN; app data only loads once unlocked
  private async boot() { try { this.store.applySettings(await this.bridge.invoke('settings:get')); await this.lock.start(); } catch (err) { this.failed.set(err instanceof Error ? err.message : String(err)); } }
  private async openApp() { if (this.initializing || this.store.ready()) return; this.initializing = true; try { await this.store.init(); if (!this.store.accounts().length) this.router.navigate(['/welcome']); this.bridge.on('notification:open', ref => { this.state.pendingOpen.set(ref); this.router.navigate(['/mail']); }); } catch (err) { this.failed.set(err instanceof Error ? err.message : String(err)); } finally { this.initializing = false; } }
  setLanguage(language: 'nl' | 'en') { this.store.saveSettings({ language }).catch(e => this.toast.error(e)); }
  toggleTheme() { const next = this.theme.dark() ? 'light' : 'dark'; this.store.saveSettings({ theme: next }).catch(e => this.toast.error(e)); }
  submitSearch() { if (this.state.module() !== 'mail') this.router.navigate(['/mail']); this.state.searchSubmit.update(n => n + 1); }
  clearSearch() { this.state.search.set(''); this.state.searchSubmit.update(n => n + 1); }
  @HostListener('document:keydown', ['$event']) onKey(e: KeyboardEvent) { if (e.ctrlKey && !e.shiftKey && !e.altKey) { const k = e.key.toLowerCase(); if (k === 'l') { e.preventDefault(); this.lock.lock(); } else if (k === '1') { e.preventDefault(); this.router.navigate(['/mail']); } else if (k === '2') { e.preventDefault(); this.router.navigate(['/calendar']); } else if (k === '3') { e.preventDefault(); this.router.navigate(['/people']); } else if (k === 'e' || k === 'f') { e.preventDefault(); (document.querySelector('.titlebar-search input') as HTMLInputElement | null)?.focus(); } } }
}
