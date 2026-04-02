import type { DataManifest, Observation, RangePreset } from '../types'

const PRESET_DURATIONS: Record<Exclude<RangePreset, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '72h': 72 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

function withCacheBust(path: string, token: string): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}v=${encodeURIComponent(token)}`
}

export async function loadManifest(): Promise<DataManifest> {
  const response = await fetch(withCacheBust('./data/manifest.json', Date.now().toString()), {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Failed to load data manifest.')
  }

  return (await response.json()) as DataManifest
}

export function getPresetStart(preset: RangePreset, latestTimestamp: string): Date | null {
  if (preset === 'all') {
    return null
  }

  return new Date(new Date(latestTimestamp).getTime() - PRESET_DURATIONS[preset])
}

export function getRequiredPartitions(manifest: DataManifest, start: Date | null): string[] {
  if (start === null) {
    return manifest.partitions.map((partition) => partition.file)
  }

  return manifest.partitions
    .filter((partition) => new Date(partition.end).getTime() >= start.getTime())
    .map((partition) => partition.file)
}

export async function loadObservations(files: string[], versionToken: string): Promise<Observation[]> {
  const responses = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(withCacheBust(`./data/observations/${file}`, versionToken), {
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`Failed to load observation partition ${file}.`)
      }

      return (await response.json()) as Observation[]
    }),
  )

  return responses.flat().sort((left, right) => {
    return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  })
}

export function filterObservations(observations: Observation[], start: Date | null): Observation[] {
  if (start === null) {
    return observations
  }

  return observations.filter((observation) => new Date(observation.timestamp).getTime() >= start.getTime())
}

export function getLatestObservation(observations: Observation[]): Observation | null {
  return observations.length > 0 ? observations[observations.length - 1] : null
}

export function isPrimeWindow(observation: Observation | null): boolean {
  if (!observation || observation.temperatureF === null || observation.humidityPct === null) {
    return false
  }

  return Math.abs(observation.temperatureF - 60) <= 4 && Math.abs(observation.humidityPct - 35) <= 8
}