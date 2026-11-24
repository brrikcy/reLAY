import { db } from '../db.ts';
import { now } from '../lib/ids.ts';

const definitions = [
  {
    id: 'builtin_search_wikipedia', name: 'search_wikipedia', description: 'Search Wikipedia for background information, public figures, companies, places, technologies, and established facts. Returns article summaries and source links. Do not use for breaking news or private data.',
    url: 'https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q={{query}}&limit=5',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'A focused search query', minLength: 2, maxLength: 200 } }, required: ['query'], additionalProperties: false },
  },
  {
    id: 'builtin_get_weather', name: 'get_weather', description: 'Get the current weather and daily forecast for a city using Open-Meteo. Use for current weather, temperatures, precipitation, and wind. This is live data, not model knowledge.',
    url: 'https://api.open-meteo.com/v1/forecast?latitude={{latitude}}&longitude={{longitude}}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5',
    parameters: { type: 'object', properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } }, required: ['latitude', 'longitude'], additionalProperties: false },
  },
  {
    id: 'builtin_geocode_city', name: 'geocode_city', description: 'Find latitude, longitude, country, and timezone for a city or place. Use before get_weather when coordinates are not known.',
    url: 'https://geocoding-api.open-meteo.com/v1/search?name={{name}}&count=5&language=en&format=json',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'City or place name', minLength: 2, maxLength: 150 } }, required: ['name'], additionalProperties: false },
  },
  {
    id: 'builtin_lookup_country', name: 'lookup_country', description: 'Look up public information about a country, including capital, population, currencies, languages, and region.',
    url: 'https://countries.dev/name/{{name}}',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'Country name', minLength: 2, maxLength: 100 } }, required: ['name'], additionalProperties: false },
  },
  {
    id: 'builtin_exchange_rates', name: 'get_exchange_rates', description: 'Get current foreign exchange rates relative to a base currency using the public Frankfurter API. Use for approximate informational conversions, not financial execution.',
    url: 'https://api.frankfurter.dev/v1/latest?base={{base}}&symbols={{symbols}}',
    parameters: { type: 'object', properties: { base: { type: 'string', description: 'Three-letter base currency code', minLength: 3, maxLength: 3 }, symbols: { type: 'string', description: 'Comma-separated target currency codes, e.g. USD,GBP,JPY', minLength: 3, maxLength: 100 } }, required: ['base', 'symbols'], additionalProperties: false },
  },
  {
    id: 'builtin_public_holidays', name: 'get_public_holidays', description: 'Look up public holidays for a country and year using Nager.Date. Useful for planning and scheduling.',
    url: 'https://date.nager.at/api/v3/PublicHolidays/{{year}}/{{countryCode}}',
    parameters: { type: 'object', properties: { year: { type: 'integer', minimum: 2000, maximum: 2100 }, countryCode: { type: 'string', description: 'Two-letter ISO country code', minLength: 2, maxLength: 2 } }, required: ['year', 'countryCode'], additionalProperties: false },
  },
] as const;

export const builtinToolDefinitions = definitions;

export function ensureBuiltinTools(): void {
  const timestamp = now();
  const insert = db.prepare('INSERT OR IGNORE INTO tools (id, name, description, method, url, headers, secret_headers, parameters, permission, enabled, timeout_ms, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const definition of definitions) {
    insert.run(definition.id, definition.name, definition.description, 'GET', definition.url, JSON.stringify({ Accept: 'application/json', 'User-Agent': 'Relay-Local-Agent/0.2' }), '{}', JSON.stringify(definition.parameters), 'auto', 1, 15000, 1, timestamp, timestamp);
  }
}
