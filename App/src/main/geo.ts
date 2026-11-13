import { PlaceSuggestion } from '../shared/types';
import { log } from './core/bus';
const PHOTON = 'https://photon.komoot.io/api/';
const BIAS = { lat: 50.85, lon: 4.35 };
const cache = new Map<string, PlaceSuggestion[]>();
export async function suggestPlaces(query: string, lang = 'nl'): Promise<PlaceSuggestion[]> {
  const q = query.trim(); if (q.length < 3) return [];
  const key = `${lang}:${q.toLowerCase()}`; const hit = cache.get(key); if (hit) return hit;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lat=${BIAS.lat}&lon=${BIAS.lon}`, { headers: { 'User-Agent': 'DHMail' }, signal: ctrl.signal });
    if (!res.ok) return [];
    const data: any = await res.json(); const region = new Intl.DisplayNames([lang], { type: 'region' }); const seen = new Set<string>(); const out: PlaceSuggestion[] = [];
    for (const f of data?.features ?? []) { const p = f?.properties ?? {}; const road = [p.street, p.housenumber].filter(Boolean).join(' '); const place = p.city ?? p.town ?? p.village ?? (['city', 'town', 'village'].includes(p.osm_value) ? p.name : ''); const town = [p.postcode, place].filter(Boolean).join(' '); let country = p.country ?? ''; try { if (p.countrycode) country = region.of(String(p.countrycode).toUpperCase()) ?? country; } catch {} const title = p.name || road || town; if (!title) continue; const detail = [p.name && road ? road : '', title === town || title === place ? '' : town, country].filter(Boolean).join(', '); const label = [title, detail].filter(Boolean).join(', '); if (seen.has(label)) continue; seen.add(label); out.push({ label, title, detail }); }
    cache.set(key, out); if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return out;
  } catch (err: any) { log('place suggest failed', err?.name === 'AbortError' ? 'timeout' : err?.message); return []; } finally { clearTimeout(timer); }
}
