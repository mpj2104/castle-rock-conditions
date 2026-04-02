import { writeFile } from 'node:fs/promises'

import {
  cardinalFromDegrees,
  ensureDataDirs,
  manifestPath,
  partitionFilename,
  writePartitionFile,
} from './utils.mjs'

function sampleObservation(timestamp, index) {
  const oscillation = Math.sin(index / 9)
  const swing = Math.cos(index / 15)
  const temperatureF = 57 + oscillation * 9 + swing * 4
  const humidityPct = 48 - oscillation * 14 + (index % 13 === 0 ? 8 : 0)
  const fuelMoisturePct = 10 + Math.max(0, humidityPct - 25) * 0.18
  const windSpeedMph = Math.max(0, 3 + Math.cos(index / 7) * 3 + (index % 19 === 0 ? 5 : 0))
  const windGustMph = windSpeedMph + 4 + Math.max(0, Math.sin(index / 5) * 4)
  const windDirectionDeg = (220 + Math.sin(index / 10) * 70 + index * 2) % 360
  const hourlyPrecipIn = index % 37 === 0 ? 0.11 : index % 41 === 0 ? 0.04 : 0

  return {
    timestamp,
    stationId: 'BNDC1',
    source: 'sample',
    temperatureF: Number(temperatureF.toFixed(1)),
    humidityPct: Number(Math.min(100, Math.max(10, humidityPct)).toFixed(0)),
    fuelMoisturePct: Number(fuelMoisturePct.toFixed(1)),
    windSpeedMph: Number(windSpeedMph.toFixed(1)),
    windGustMph: Number(windGustMph.toFixed(1)),
    windDirectionDeg: Number(windDirectionDeg.toFixed(0)),
    windDirectionCardinal: cardinalFromDegrees(windDirectionDeg),
    hourlyPrecipIn,
  }
}

async function main() {
  await ensureDataDirs()

  const now = new Date()
  const observations = []
  for (let hourOffset = 60 * 24; hourOffset >= 0; hourOffset -= 1) {
    const timestamp = new Date(now.getTime() - hourOffset * 60 * 60 * 1000).toISOString()
    observations.push(sampleObservation(timestamp, observations.length))
  }

  const groups = observations.reduce((map, observation) => {
    const monthKey = observation.timestamp.slice(0, 7)
    const entries = map.get(monthKey) ?? []
    entries.push(observation)
    map.set(monthKey, entries)
    return map
  }, new Map())

  const partitions = []
  for (const [monthKey, entries] of groups.entries()) {
    const file = partitionFilename(monthKey)
    await writePartitionFile(file, entries)
    partitions.push({
      file,
      start: entries[0].timestamp,
      end: entries[entries.length - 1].timestamp,
      count: entries.length,
    })
  }

  partitions.sort((left, right) => left.file.localeCompare(right.file))

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        stationId: 'BNDC1',
        stationName: 'Ben Lomond RAWS',
        source: 'Sample data scaffolded locally',
        timezone: 'America/Los_Angeles',
        generatedAt: new Date().toISOString(),
        latestObservationAt: observations[observations.length - 1].timestamp,
        metrics: {
          temperatureTargetF: 60,
          humidityTargetPct: 35,
        },
        partitions,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`Generated ${observations.length} sample observations.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})