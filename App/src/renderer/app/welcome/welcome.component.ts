import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LogoComponent } from '../shared/logo.component';
import { ConnectComponent } from '../settings/connect.component';
@Component({ selector: 'app-welcome', standalone: true, imports: [TranslatePipe, LogoComponent, ConnectComponent], template: `<div class="welcome"><app-logo class="welcome-logo" [wordmark]="false"></app-logo><h1 class="welcome-title">DHDMail</h1><p class="welcome-sub">{{ 'APP.WELCOME.SUBTITLE' | translate }}</p><div class="welcome-card"><app-connect (connected)="done()"></app-connect></div></div>`, styles: [`:host { display: flex; flex: 1; min-height: 0; overflow-y: auto; } .welcome { display: flex; flex-direction: column; align-items: center; gap: 10px; flex: 1; padding: 48px 24px; text-align: center; animation: pop 0.3s ease-out; } .welcome-logo { --logo-size: 96px; } .welcome-title { margin: 8px 0 0; font-size: 40px; font-weight: 700; color: var(--primary); letter-spacing: 0.02em; } .welcome-sub { margin: 0 0 14px; max-width: 440px; font-size: 15px; color: var(--secondary); } .welcome-card { width: 100%; max-width: 440px; }`] })
export class WelcomeComponent { private router = inject(Router); done() { this.router.navigate(['/mail']); } }
