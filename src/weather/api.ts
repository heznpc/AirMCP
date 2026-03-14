// Weather API client using Open-Meteo (free, no API key required).

const BASE_URL = "https://api.open-meteo.com/v1/forecast";

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code: number): string {
  return WEATHER_CODES[code] ?? `Unknown (code ${code})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOpenMeteo(latitude: number, longitude: number, extra: Record<string, string>): Promise<any> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone: "auto", ...extra });
  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchCurrentWeather(latitude: number, longitude: number) {
  const data = await fetchOpenMeteo(latitude, longitude, {
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover",
  });
  const c = data.current;
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    weatherCode: c.weather_code,
    weatherDescription: describeWeatherCode(c.weather_code),
    windSpeed: c.wind_speed_10m,
    windDirection: c.wind_direction_10m,
    precipitation: c.precipitation,
    cloudCover: c.cloud_cover,
    units: { temperature: "\u00b0C", windSpeed: "km/h", precipitation: "mm" },
  };
}

export async function fetchDailyForecast(latitude: number, longitude: number, days: number) {
  const data = await fetchOpenMeteo(latitude, longitude, {
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    forecast_days: String(days),
  });
  const d = data.daily;
  return d.time.map((date: string, i: number) => ({
    date,
    weatherCode: d.weather_code[i],
    weatherDescription: describeWeatherCode(d.weather_code[i]),
    temperatureMax: d.temperature_2m_max[i],
    temperatureMin: d.temperature_2m_min[i],
    sunrise: d.sunrise[i],
    sunset: d.sunset[i],
    precipitationSum: d.precipitation_sum[i],
    precipitationProbabilityMax: d.precipitation_probability_max[i],
    windSpeedMax: d.wind_speed_10m_max[i],
  }));
}

export async function fetchHourlyForecast(latitude: number, longitude: number, hours: number) {
  const data = await fetchOpenMeteo(latitude, longitude, {
    hourly: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,precipitation,precipitation_probability,wind_speed_10m,cloud_cover",
    forecast_hours: String(hours),
  });
  const h = data.hourly;
  return h.time.map((time: string, i: number) => ({
    time,
    temperature: h.temperature_2m[i],
    feelsLike: h.apparent_temperature[i],
    humidity: h.relative_humidity_2m[i],
    weatherCode: h.weather_code[i],
    weatherDescription: describeWeatherCode(h.weather_code[i]),
    precipitation: h.precipitation[i],
    precipitationProbability: h.precipitation_probability[i],
    windSpeed: h.wind_speed_10m[i],
    cloudCover: h.cloud_cover[i],
  }));
}
