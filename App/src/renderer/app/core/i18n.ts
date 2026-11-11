import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import nl from '../../assets/i18n/nl.json';
import en from '../../assets/i18n/en.json';
const BUNDLES: Record<string, TranslationObject> = { nl: nl as TranslationObject, en: en as TranslationObject };
export class StaticTranslateLoader implements TranslateLoader { getTranslation(lang: string): Observable<TranslationObject> { return of(BUNDLES[lang] ?? BUNDLES['en']); } }
