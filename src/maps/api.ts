// Geocoding API clients — Open-Meteo (forward) + Nominatim (reverse).

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

export async function fetchGeocode(query: string, count = 5) {
  const params = new URLSearchParams({ name: query, count: String(count), language: "en", format: "json" });
  const res = await fetch(`${GEOCODE_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
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
  const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: "json" });
  const res = await fetch(`${REVERSE_URL}?${params}`, {
    headers: { "User-Agent": "AirMCP/2.0 (MCP Server)" },
    signal: AbortSignal.timeout(10_000),
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
