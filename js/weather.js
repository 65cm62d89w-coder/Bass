/* weather.js — fetches live weather from Open-Meteo (free, no API key).
 * Docs: https://open-meteo.com/
 */

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/**
 * Fetch the weather bundle we need for the forecast.
 * Returns metric-free, app-ready object (Fahrenheit / mph / inHg).
 */
async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'cloud_cover',
      'surface_pressure',
      'wind_speed_10m',
      'wind_direction_10m',
      'is_day',
      'weather_code',
    ].join(','),
    hourly: ['temperature_2m', 'surface_pressure', 'cloud_cover', 'precipitation_probability', 'wind_speed_10m', 'is_day'].join(','),
    daily: ['sunrise', 'sunset', 'temperature_2m_max', 'temperature_2m_min', 'moon_phase'].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: '2',
  });

  const res = await fetch(`${OPEN_METEO}?${params.toString()}`);
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  const data = await res.json();

  // Pressure trend: compare pressure 3h ago vs now from the hourly series.
  const trend = computePressureTrend(data);

  return {
    raw: data,
    tempF: data.current.temperature_2m,
    feelsF: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    precip: data.current.precipitation,
    cloudPct: data.current.cloud_cover,
    pressureHpa: data.current.surface_pressure,
    pressureInHg: +(data.current.surface_pressure * 0.02953).toFixed(2),
    windMph: data.current.wind_speed_10m,
    windDir: data.current.wind_direction_10m,
    isDay: data.current.is_day === 1,
    weatherCode: data.current.weather_code,
    pressureTrend: trend.direction,
    pressureChange: trend.change,
    pressureState: pressureState(data.current.surface_pressure),
    sunrise: data.daily.sunrise?.[0],
    sunset: data.daily.sunset?.[0],
    hiF: data.daily.temperature_2m_max?.[0],
    loF: data.daily.temperature_2m_min?.[0],
    moonPhase: data.daily.moon_phase?.[0],
    timezone: data.timezone,
  };
}

function computePressureTrend(data) {
  const series = data.hourly?.surface_pressure;
  const times = data.hourly?.time;
  if (!series || !times) return { direction: 'steady', change: 0 };

  const nowIso = data.current.time;
  let nowIdx = times.indexOf(nowIso);
  if (nowIdx === -1) {
    // Find nearest hour to current time.
    const nowMs = new Date(nowIso).getTime();
    nowIdx = times.reduce((best, t, i) => {
      return Math.abs(new Date(t).getTime() - nowMs) <
        Math.abs(new Date(times[best]).getTime() - nowMs) ? i : best;
    }, 0);
  }
  const pastIdx = Math.max(0, nowIdx - 3);
  const change = series[nowIdx] - series[pastIdx]; // hPa over ~3h
  let direction = 'steady';
  if (change <= -1.0) direction = 'falling';
  else if (change >= 1.0) direction = 'rising';
  return { direction, change: +change.toFixed(1) };
}

function pressureState(hpa) {
  if (hpa >= 1022) return 'high';
  if (hpa <= 1009) return 'low';
  return 'normal';
}

/** Forward geocode a place name -> list of {name, lat, lon, admin, country}. */
async function geocodePlace(query) {
  const params = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' });
  const res = await fetch(`${GEOCODE}?${params.toString()}`);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    admin: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** Reverse geocode lat/lon -> friendly label. Best-effort; falls back to coords. */
async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`${REVERSE}?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    if (!res.ok) throw new Error('reverse failed');
    const d = await res.json();
    const label = [d.locality || d.city, d.principalSubdivisionCode || d.principalSubdivision]
      .filter(Boolean).join(', ');
    return label || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  } catch {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

window.fetchWeather = fetchWeather;
window.geocodePlace = geocodePlace;
window.reverseGeocode = reverseGeocode;
