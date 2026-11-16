/**
    * @author Group DH Team
    * @see https://group-dh.com
    * @since 16/11/2026
**/

import { IcsEvent } from './ics';

// Belgian public holidays (the ten legal holidays plus Easter and Whit Sunday), computed locally
// so they appear once instead of once per mailbox.
const NAMES = {
  nl: { newYear: 'Nieuwjaar', easter: 'Pasen', easterMonday: 'Paasmaandag', labour: 'Dag van de Arbeid', ascension: 'O.L.H. Hemelvaart', pentecost: 'Pinksteren', whitMonday: 'Pinkstermaandag', national: 'Nationale feestdag', assumption: 'O.L.V. Hemelvaart', allSaints: 'Allerheiligen', armistice: 'Wapenstilstand', christmas: 'Kerstmis' },
  en: { newYear: "New Year's Day", easter: 'Easter Sunday', easterMonday: 'Easter Monday', labour: 'Labour Day', ascension: 'Ascension Day', pentecost: 'Whit Sunday', whitMonday: 'Whit Monday', national: 'Belgian National Day', assumption: 'Assumption Day', allSaints: "All Saints' Day", armistice: 'Armistice Day', christmas: 'Christmas Day' }
};

/** Easter Sunday (Gregorian calendar, anonymous algorithm) as a UTC date. */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function belgianHolidays(start: Date, end: Date, language: 'nl' | 'en' = 'nl'): IcsEvent[] {
  const n = NAMES[language] ?? NAMES.nl;
  const out: IcsEvent[] = [];
  const day = (d: Date) => d.toISOString().slice(0, 10);
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    const easter = easterSunday(y);
    const shift = (days: number) => new Date(easter.getTime() + days * 86400000);
    const fixed = (m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
    const list: [string, Date][] = [['newYear', fixed(1, 1)], ['easter', easter], ['easterMonday', shift(1)], ['labour', fixed(5, 1)], ['ascension', shift(39)], ['pentecost', shift(49)], ['whitMonday', shift(50)], ['national', fixed(7, 21)], ['assumption', fixed(8, 15)], ['allSaints', fixed(11, 1)], ['armistice', fixed(11, 11)], ['christmas', fixed(12, 25)]];
    for (const [key, date] of list) {
      if (date < start || date > end) continue;
      out.push({ uid: `be-holiday-${key}-${y}`, recurrenceId: null, title: n[key as keyof typeof n], description: '', location: '', start: day(date), end: day(new Date(date.getTime() + 86400000)), allDay: true, status: '', organizer: null, attendees: [], recurring: true });
    }
  }
  return out;
}

/** Birthday and holiday calendars that mail providers add on their own; DHMail shows its own shared ones instead. */
const BUILT_IN_ID = /#(contacts|holiday)@group\.v\.calendar\.google\.com/i;
const BUILT_IN_NAME = /^(birthdays?|verjaardagen|geburtstage|anniversaires|compleanni|cumpleaños|contacts?|contactpersonen)$|\b(holidays|feestdagen|feiertage|jours fériés|días festivos)\b/i;
export const isBuiltInExtraCalendar = (id: string, name: string) => BUILT_IN_ID.test(decodeURIComponent(id)) || BUILT_IN_NAME.test(name.trim());