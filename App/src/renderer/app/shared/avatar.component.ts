/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { StoreService } from '../core/store.service';
import { colorFor, initials } from '../core/format';
@Component({ selector: 'app-avatar', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: `@if (src) {<img [src]="src" [alt]="name" (error)="onError()" referrerpolicy="no-referrer"/>} @else {<span [style.background]="color">{{ text }}</span>}`, styles: [`:host { display: inline-flex; flex: none; width: var(--avatar-size, 36px); height: var(--avatar-size, 36px); border-radius: 50%; overflow: hidden; user-select: none; } img { width: 100%; height: 100%; object-fit: cover; } span { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #fff; font-size: calc(var(--avatar-size, 36px) * 0.38); font-weight: 600; line-height: 1; }`] })
export class AvatarComponent { private store = inject(StoreService); private broken = false; @Input() name = ''; @Input() address = ''; @Input() photo: string | null = null; /** the contact's own photo, else the photo of a contact with this address */ get src() { return this.broken ? null : this.photo || this.store.photoFor(this.address); } onError() { this.broken = true; } @Input() fixedColor: string | null = null; get text() { return initials(this.name, this.address); } get color() { return this.fixedColor ?? colorFor(this.address || this.name); } }