import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { config as loadEnv } from 'dotenv'

loadEnv({ quiet: true })

export const rootDir = '/Users/mpjiang/Projects/castlerock-conditions'
export const observationsDir = path.join(rootDir, 'public', 'data', 'observations')
export const manifestPath = path.join(rootDir, 'public', 'data', 'manifest.json')

export const DEFAULT_STATION_ID = process.env.SYNOPTIC_STATION_ID ?? 'BNDC1'
export const DEFAULT_VARIABLES = [
  'air_temp',
  'relative_humidity',
  'fuel_moisture',
  'precip_accum',
  'wind_speed',
  'wind_gust',
  'wind_direction',
]

export function getToken() {
  const token = process.env.SYNOPTIC_API_TOKEN
  if (!token) {
    throw new Error('SYNOPTIC_API_TOKEN is required.')
  }

  return token
}

export function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .filter((entry) => entry.startsWith('--'))
      .map((entry) => {
        const [key, value] = entry.slice(2).split('=')
        return [key, value ?? 'true']
      }),
  )
}

export async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'castlerock-conditions/0.1 (github pages sync)',
    },
  })

  if (!response.ok) {
    const safeUrl = new URL(url)
    if (safeUrl.searchParams.has('token')) {
      safeUrl.searchParams.set('token', '[redacted]')
    }

    throw new Error(`Request failed with ${response.status}: ${safeUrl.toString()}`)
  }

  return response.json()
}

export function cardinalFromDegrees(degrees) {
  if (degrees === null || degrees === undefined || Number.isNaN(degrees)) {
    return null
  }

  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const normalized = ((degrees % 360) + 360) % 360
  return directions[Math.round(normalized / 22.5) % directions.length]
}

export function pickSeries(observations, variableName, dateTimes) {
  const key = Object.keys(observations).find((candidate) => candidate.startsWith(`${variableName}_set_`))
  if (!key) {
    return new Array(dateTimes.length).fill(null)
  }

  return observations[key].map((value) => (value === null || value === undefined ? null : Number(value)))
}

export function normalizeStation(station, source = 'synoptic') {
  const dateTimes = station.OBSERVATIONS.date_time
  const temperatures = pickSeries(station.OBSERVATIONS, 'air_temp', dateTimes)
  const humidity = pickSeries(station.OBSERVATIONS, 'relative_humidity', dateTimes)
  const fuelMoisturePrimary = pickSeries(station.OBSERVATIONS, 'fuel_moisture', dateTimes)
  const fuelMoistureFallback = pickSeries(station.OBSERVATIONS, 'dead_fuel_moisture', dateTimes)
  const fuelMoisture = fuelMoisturePrimary.some((value) => value !== null)
    ? fuelMoisturePrimary
    : fuelMoistureFallback
  const windSpeed = pickSeries(station.OBSERVATIONS, 'wind_speed', dateTimes)
  const windGust = pickSeries(station.OBSERVATIONS, 'wind_gust', dateTimes)
  const windDirection = pickSeries(station.OBSERVATIONS, 'wind_direction', dateTimes)
  const precipitation = pickSeries(station.OBSERVATIONS, 'precip_accum', dateTimes)

  return dateTimes.map((timestamp, index) => {
    const previousPrecip = index > 0 ? precipitation[index - 1] : null
    const currentPrecip = precipitation[index]

    let hourlyPrecipIn = null
    if (currentPrecip !== null) {
      if (previousPrecip === null) {
        hourlyPrecipIn = 0
      } else {
        const delta = currentPrecip - previousPrecip
        // BNDC1 precip_accum behaves like an accumulation counter, so only keep realistic hourly increments.
        hourlyPrecipIn = delta >= 0 && delta <= 5 ? delta : 0
      }

      hourlyPrecipIn = Number(hourlyPrecipIn.toFixed(2))
    }

    return {
      timestamp,
      stationId: station.STID,
      source,
      temperatureF: temperatures[index],
      humidityPct: humidity[index],
      fuelMoisturePct: fuelMoisture[index],
      windSpeedMph: windSpeed[index],
      windGustMph: windGust[index],
      windDirectionDeg: windDirection[index],
      windDirectionCardinal: cardinalFromDegrees(windDirection[index]),
      hourlyPrecipIn,
    }
  })
}

export function groupByMonth(observations) {
  return observations.reduce((groups, observation) => {
    const monthKey = observation.timestamp.slice(0, 7)
    const group = groups.get(monthKey) ?? []
    group.push(observation)
    groups.set(monthKey, group)
    return groups
  }, new Map())
}

export async function ensureDataDirs() {
  await mkdir(observationsDir, { recursive: true })
}

export async function writePartitionFile(filename, observations) {
  await ensureDataDirs()
  await writeFile(path.join(observationsDir, filename), `${JSON.stringify(observations, null, 2)}\n`)
}

export async function listPartitionFiles() {
  await ensureDataDirs()
  return (await readdir(observationsDir)).filter((entry) => entry.endsWith('.json')).sort()
}

export async function readPartitionFile(filename) {
  const contents = await readFile(path.join(observationsDir, filename), 'utf8')
  return JSON.parse(contents)
}

export function partitionFilename(monthKey) {
  return `${monthKey}.json`
}