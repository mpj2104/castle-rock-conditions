import process from 'node:process'
import { writeFile } from 'node:fs/promises'

import {
  DEFAULT_STATION_ID,
  listPartitionFiles,
  manifestPath,
  readPartitionFile,
} from './utils.mjs'

async function main() {
  const checkOnly = process.argv.includes('--check')
  const partitionFiles = await listPartitionFiles()

  if (partitionFiles.length === 0) {
    throw new Error('No observation partitions found. Run npm run sync:sample or npm run sync:synoptic first.')
  }

  const partitions = await Promise.all(
    partitionFiles.map(async (file) => {
      const observations = await readPartitionFile(file)
      return {
        file,
        start: observations[0].timestamp,
        end: observations[observations.length - 1].timestamp,
        count: observations.length,
      }
    }),
  )

  const manifest = {
    stationId: DEFAULT_STATION_ID,
    stationName: 'Ben Lomond RAWS',
    source: 'Synoptic Weather API archive',
    timezone: 'America/Los_Angeles',
    generatedAt: new Date().toISOString(),
    latestObservationAt: partitions[partitions.length - 1].end,
    metrics: {
      temperatureTargetF: 60,
      humidityTargetPct: 35,
    },
    partitions,
  }

  if (!checkOnly) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  console.log(`Manifest ${checkOnly ? 'validated' : 'written'} for ${partitions.length} partition(s).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})