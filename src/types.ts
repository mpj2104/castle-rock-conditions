export type RangePreset = '24h' | '72h' | '7d' | '30d' | 'all'

export type Observation = {
  timestamp: string
  stationId: string
  source: 'sample' | 'synoptic'
  temperatureF: number | null
  humidityPct: number | null
  fuelMoisturePct: number | null
  windSpeedMph: number | null
  windGustMph: number | null
  windDirectionDeg: number | null
  windDirectionCardinal: string | null
  precipAccumIn: number | null
  hourlyPrecipIn: number | null
}

export type DataPartition = {
  file: string
  start: string
  end: string
  count: number
}

export type DataManifest = {
  stationId: string
  stationName: string
  source: string
  timezone: string
  generatedAt: string
  latestObservationAt: string
  metrics: {
    temperatureTargetF: number
    humidityTargetPct: number
  }
  partitions: DataPartition[]
}