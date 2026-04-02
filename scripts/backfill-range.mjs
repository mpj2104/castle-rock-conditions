import process from 'node:process'
import { spawnSync } from 'node:child_process'

import {
  DEFAULT_STATION_ID,
  DEFAULT_VARIABLES,
  getToken,
  groupByMonth,
  normalizeStation,
  parseArgs,
  partitionFilename,
  readPartitionFile,
  requestJson,
  rootDir,
  writePartitionFile,
} from './utils.mjs'

function parseSynopticUtc(value) {
  if (!/^\d{12}$/.test(value)) {
    throw new Error(`Invalid timestamp "${value}". Expected YYYYMMDDHHmm in UTC.`)
  }

  const year = Number(value.slice(0, 4))
  const monthIndex = Number(value.slice(4, 6)) - 1
  const day = Number(value.slice(6, 8))
  const hour = Number(value.slice(8, 10))
  const minute = Number(value.slice(10, 12))

  return new Date(Date.UTC(year, monthIndex, day, hour, minute, 0, 0))
}

function toSynopticUtc(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  return `${y}${m}${d}${hh}${mm}`
}

function endOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 0, 0))
}

function buildMonthlyChunks(start, end) {
  const chunks = []
  let cursor = new Date(start.getTime())

  while (cursor <= end) {
    const chunkStart = new Date(cursor.getTime())
    const monthEnd = endOfMonthUtc(cursor)
    const chunkEnd = monthEnd < end ? monthEnd : end

    chunks.push({
      start: toSynopticUtc(chunkStart),
      end: toSynopticUtc(chunkEnd),
    })

    cursor = new Date(chunkEnd.getTime() + 60 * 1000)
  }

  return chunks
}

async function fetchRangeChunk({ token, stationId, variables, start, end }) {
  const url = new URL('https://api.synopticdata.com/v2/stations/timeseries')
  url.searchParams.set('token', token)
  url.searchParams.set('stid', stationId)
  url.searchParams.set('vars', variables.join(','))
  url.searchParams.set('units', 'english,speed|mph,fuel_moisture|%')
  url.searchParams.set('obtimezone', 'UTC')
  url.searchParams.set('showemptyvars', '1')
  url.searchParams.set('start', start)
  url.searchParams.set('end', end)

  const payload = await requestJson(url.toString())
  const station = payload.STATION?.[0]

  if (!station) {
    return []
  }

  return normalizeStation(station)
}

function mergeByTimestamp(existing, incoming) {
  const merged = new Map(existing.map((entry) => [entry.timestamp, entry]))

  for (const observation of incoming) {
    merged.set(observation.timestamp, observation)
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

function printUsage() {
  console.log('Usage: npm run backfill:range -- --start=YYYYMMDDHHmm --end=YYYYMMDDHHmm [--stid=BNDC1] [--vars=air_temp,relative_humidity,...]')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help === 'true' || args.h === 'true') {
    printUsage()
    return
  }

  if (!args.start || !args.end) {
    throw new Error('Both --start and --end are required. Example: --start=202001010000 --end=202512312359')
  }

  const start = parseSynopticUtc(args.start)
  const end = parseSynopticUtc(args.end)

  if (end < start) {
    throw new Error('The --end timestamp must be on or after --start.')
  }

  const stationId = args.stid ?? DEFAULT_STATION_ID
  const variables = (args.vars ?? DEFAULT_VARIABLES.join(',')).split(',').map((entry) => entry.trim()).filter(Boolean)
  const token = getToken()

  const chunks = buildMonthlyChunks(start, end)
  let totalFetched = 0
  const collected = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const observations = await fetchRangeChunk({
      token,
      stationId,
      variables,
      start: chunk.start,
      end: chunk.end,
    })

    totalFetched += observations.length
    collected.push(...observations)
    console.log(`Chunk ${index + 1}/${chunks.length}: ${chunk.start}..${chunk.end} -> ${observations.length} observation(s)`)
  }

  const grouped = groupByMonth(collected)
  let totalWritten = 0

  for (const [monthKey, incomingEntries] of grouped.entries()) {
    const file = partitionFilename(monthKey)
    const existingEntries = (await readPartitionOrEmpty(file)).filter((entry) => entry.source !== 'sample')
    const mergedEntries = mergeByTimestamp(existingEntries, incomingEntries)
    await writePartitionFile(file, mergedEntries)
    totalWritten += mergedEntries.length

    console.log(`Updated ${file}: +${incomingEntries.length} fetched, ${mergedEntries.length} total after merge`)
  }

  const manifestResult = spawnSync('node', ['scripts/build-manifest.mjs'], {
    cwd: rootDir,
    stdio: 'inherit',
  })

  if (manifestResult.status !== 0) {
    throw new Error('Backfill finished, but manifest rebuild failed.')
  }

  console.log(`Backfill complete. Fetched ${totalFetched} observation(s) across ${grouped.size} month partition(s).`)
  console.log(`Total records currently written in touched partitions: ${totalWritten}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
