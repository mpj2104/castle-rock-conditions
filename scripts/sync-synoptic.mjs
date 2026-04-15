import process from 'node:process'

import {
  DEFAULT_STATION_ID,
  DEFAULT_VARIABLES,
  getToken,
  groupByMonth,
  normalizeStation,
  parseArgs,
  partitionFilename,
  readPartitionFile,
  recomputeHourlyPrecipFromAccum,
  requestJson,
  writePartitionFile,
} from './utils.mjs'

function buildTimeWindow(args) {
  if (args.start && args.end) {
    return { start: args.start, end: args.end }
  }

  if (args.recent) {
    return { recent: args.recent }
  }

  return { recent: '4320' }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const stationId = args.stid ?? DEFAULT_STATION_ID
  const token = getToken()

  const url = new URL('https://api.synopticdata.com/v2/stations/timeseries')
  url.searchParams.set('token', token)
  url.searchParams.set('stid', stationId)
  url.searchParams.set('vars', args.vars ?? DEFAULT_VARIABLES.join(','))
  url.searchParams.set('units', 'english,speed|mph,fuel_moisture|%')
  url.searchParams.set('obtimezone', 'UTC')
  url.searchParams.set('showemptyvars', '1')

  const timeWindow = buildTimeWindow(args)
  if ('recent' in timeWindow) {
    url.searchParams.set('recent', timeWindow.recent)
  } else {
    url.searchParams.set('start', timeWindow.start)
    url.searchParams.set('end', timeWindow.end)
  }

  const payload = await requestJson(url.toString())
  const station = payload.STATION?.[0]
  if (!station) {
    throw new Error(`No station observations returned for ${stationId}.`)
  }

  const observations = normalizeStation(station)
  const monthlyGroups = groupByMonth(observations)

  function mergeByTimestamp(existing, incoming) {
    const merged = new Map(existing.map((entry) => [entry.timestamp, entry]))
    for (const entry of incoming) {
      merged.set(entry.timestamp, entry)
    }

    return [...merged.values()].sort((left, right) => {
      return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    })
  }

  async function readPartitionOrEmpty(filename) {
    try {
      return await readPartitionFile(filename)
    } catch {
      return []
    }
  }

  for (const [monthKey, incomingEntries] of monthlyGroups.entries()) {
    const file = partitionFilename(monthKey)
    const existingEntries = (await readPartitionOrEmpty(file)).filter((entry) => entry.source !== 'sample')
    const mergedEntries = mergeByTimestamp(existingEntries, incomingEntries)
    const mergedWithRecomputedPrecip = recomputeHourlyPrecipFromAccum(mergedEntries)
    await writePartitionFile(file, mergedWithRecomputedPrecip)
  }

  console.log(`Wrote ${observations.length} observations across ${monthlyGroups.size} partition(s).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})