// Geocoding API clients — Open-Meteo (forward) + Nominatim (reverse).
// Nominatim usage policy: max 1 request/second, valid User-Agent with contact URL.
// See https://operations.osmfoundation.org/policies/nominatim/

import { API, TIMEOUT, IDENTITY } from "../shared/constants.js";

const GEOCODE_URL = API.GEOCODING;
const REVERSE_URL = API.REVERSE_GEOCODE;

// Nominatim rate limiter — enforce max 1 request/second.
// Timestamp-based: simple, no promise chain growth, no race condition.
let lastNominatimCall = 0;
async function nominatimThrottle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, 1000 - (now - lastNominatimCall));
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();
}

export async function fetchGeocode(query: string, count = 5) {
  const params = new URLSearchParams({ name: query, count: String(count), language: "en", format: "json" });
  const res = await fetch(`${GEOCODE_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT.GEOCODE) });
  if (!res.ok) throw new Error(`Geocoding API error: ${res.status} ${res.statusText}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const results = (data.results ?? []).map((r: Record<string, unknown>) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    countryCode: r.country_code,
    admin1: r.admin1 ?? null,
    elevation: r.elevation ?? null,
    timezone: r.timezone ?? null,
    population: r.population ?? null,
  }));
  return { total: results.length, results };
}

export async function fetchReverseGeocode(latitude: number, longitude: number) {
  await nominatimThrottle();
  const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: "json" });
  const res = await fetch(`${REVERSE_URL}?${params}`, {
    headers: { "User-Agent": IDENTITY.USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT.GEOCODE),
  });
  if (!res.ok) throw new Error(`Reverse geocoding error: ${res.status} ${res.statusText}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  if (data.error) throw new Error(`Reverse geocoding: ${data.error}`);
  const addr = data.address ?? {};
  return {
    name: data.name ?? null,
    displayName: data.display_name ?? null,
    latitude: parseFloat(data.lat),
    longitude: parseFloat(data.lon),
    address: {
      road: addr.road ?? null,
      city: addr.city ?? addr.town ?? addr.village ?? null,
      state: addr.state ?? null,
      country: addr.country ?? null,
      postcode: addr.postcode ?? null,
    },
  };
}
