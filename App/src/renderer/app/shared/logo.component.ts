/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
@Component({ selector: 'app-logo', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: `<img class="mark" src="assets/logo.svg" alt="" draggable="false"/>@if (wordmark) {<span class="word">DHMail</span>}`, styles: [`:host { display: inline-flex; align-items: center; gap: 8px; } .mark { width: var(--logo-size, 28px); height: var(--logo-size, 28px); flex: none; } .word { font-size: calc(var(--logo-size, 28px) * 0.62); font-weight: 700; letter-spacing: 0.3px; color: var(--primary); line-height: 1; }`] })
export class LogoComponent { @Input() wordmark = true; }