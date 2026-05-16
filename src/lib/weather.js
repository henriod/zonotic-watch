/**
 * Open-Meteo client — fetches current temperature, humidity, and today's
 * rainfall for every county in a single request.
 *
 * Zero setup: free, no API key, no registration, CORS-enabled.
 * Docs: https://open-meteo.com/en/docs
 */

const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";

/**
 * Fetch live weather for a set of counties.
 *
 * Open-Meteo accepts comma-separated coordinate lists and returns one result
 * per location, in input order — so all counties come back in one request.
 *
 * @param {{ id: string, lat: number, lng: number }[]} counties
 * @param {(status: string) => void} [onStatus] - progress callback
 * @returns {Promise<Record<string, { temp: number, hum: number, rain: number }>>}
 *   map of county id → weather (°C, % RH, mm rain today)
 */
export async function fetchCountyWeather(counties, onStatus) {
  if (!counties?.length) return {};

  onStatus?.("Fetching weather…");
  const params = new URLSearchParams({
    latitude: counties.map((c) => c.lat).join(","),
    longitude: counties.map((c) => c.lng).join(","),
    current: "temperature_2m,relative_humidity_2m",
    daily: "precipitation_sum",
    forecast_days: "1",
    timezone: "auto",
  });

  const res = await fetch(`${OPEN_METEO_API}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} ${res.statusText}`);

  const data = await res.json();
  // A single location returns an object; multiple return an array.
  const locations = Array.isArray(data) ? data : [data];

  const weather = {};
  counties.forEach((c, i) => {
    const loc = locations[i];
    if (!loc?.current) return;
    weather[c.id] = {
      temp: Math.round(loc.current.temperature_2m),
      hum: Math.round(loc.current.relative_humidity_2m),
      rain: Math.round(loc.daily?.precipitation_sum?.[0] ?? 0),
    };
  });
  return weather;
}

/**
 * Resolve a county's weather: the live Open-Meteo value if it has loaded,
 * otherwise the county's seeded `wx` sample.
 *
 * @param {{ id: string, wx: object }} county
 * @param {Record<string, object>} weather - map from `fetchCountyWeather`
 * @returns {{ temp: number, hum: number, rain: number }}
 */
export function countyWeather(county, weather) {
  return weather[county.id] ?? county.wx;
}
