import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { HistoryChart } from './HistoryChart'
import {
  filterObservations,
  getLatestObservation,
  getPresetStart,
  getRequiredPartitions,
  loadManifest,
  loadObservations,
} from '../lib/data'
import { formatObservationTime, formatValue } from '../lib/format'
import type { DataManifest, Observation, RangePreset } from '../types'

const PRESETS: RangePreset[] = ['24h', '72h', '7d', '30d', 'all']
const AUTO_REFRESH_MS = 5 * 60 * 1000
const BANNER_IMAGES = ['crsp-hands.png', 'crsp-hands-2.png', 'crsp-hands-3.png']
const IMAGE_BASE = `${import.meta.env.BASE_URL}images/`
const RAIN_WINDOW_MS = 72 * 60 * 60 * 1000

type ClimbingStatus = 'green' | 'red' | 'neutral'

function getClimbingStatus(observations: Observation[], latestObservation: Observation | null): ClimbingStatus {
  if (!latestObservation || latestObservation.fuelMoisturePct === null) return 'neutral'

  const fuelMoisturePct = latestObservation.fuelMoisturePct
  const latestTime = new Date(latestObservation.timestamp).getTime()
  const cutoff = latestTime - RAIN_WINDOW_MS

  const lastRainObs = [...observations].reverse().find(
    (obs) => obs.hourlyPrecipIn !== null && obs.hourlyPrecipIn > 0,
  )
  const rainedInLast72h = lastRainObs != null && new Date(lastRainObs.timestamp).getTime() >= cutoff

  if (rainedInLast72h && fuelMoisturePct >= 10) return 'red'
  if (!rainedInLast72h && fuelMoisturePct < 10) return 'green'
  return 'neutral'
}

function getPast72hRain(observations: Observation[], latestObservation: Observation | null): number | null {
  if (!latestObservation) {
    return null
  }

  const latestTime = new Date(latestObservation.timestamp).getTime()
  const cutoff = latestTime - RAIN_WINDOW_MS
  const sum = observations.reduce((total, observation) => {
    const observationTime = new Date(observation.timestamp).getTime()
    if (observationTime < cutoff || observation.hourlyPrecipIn === null || observation.hourlyPrecipIn <= 0) {
      return total
    }

    return total + observation.hourlyPrecipIn
  }, 0)

  return Number(sum.toFixed(2))
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; manifest: DataManifest; observations: Observation[] }

export function ConditionsDashboard() {
  const [preset, setPreset] = useState<RangePreset>('7d')
  const [refreshTick, setRefreshTick] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshTick((current) => current + 1)
    }, AUTO_REFRESH_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      try {
        const manifest = await loadManifest()
        const presetStart = getPresetStart(preset, manifest.latestObservationAt)
        const rainStart = new Date(new Date(manifest.latestObservationAt).getTime() - RAIN_WINDOW_MS)
        const loadStart = presetStart === null
          ? null
          : new Date(Math.min(presetStart.getTime(), rainStart.getTime()))
        const files = getRequiredPartitions(manifest, loadStart)
        const observations = filterObservations(
          await loadObservations(files, manifest.generatedAt),
          loadStart,
        )

        if (!cancelled) {
          setState({ status: 'ready', manifest, observations })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown loading failure.',
          })
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [preset, refreshTick])

  const chartObservations = useMemo(() => {
    if (state.status !== 'ready') {
      return []
    }

    const chartStart = getPresetStart(preset, state.manifest.latestObservationAt)
    return filterObservations(state.observations, chartStart)
  }, [state, preset])

  const deferredObservations = useDeferredValue(chartObservations)

  const latestObservation = useMemo(() => {
    return state.status === 'ready' ? getLatestObservation(state.observations) : null
  }, [state])

  const climbingStatus = useMemo<ClimbingStatus>(() => {
    if (state.status !== 'ready') return 'neutral'
    return getClimbingStatus(state.observations, latestObservation)
  }, [state, latestObservation])

  const past72hRainIn = useMemo(() => {
    if (state.status !== 'ready') {
      return null
    }

    return getPast72hRain(state.observations, latestObservation)
  }, [state, latestObservation])

  if (state.status === 'loading') {
    return (
      <main className="app-shell">
        <TitleBanner />
        <section className="hero-panel loading-panel">
          <p className="eyebrow">Castle Rock Conditions</p>
          <h1>Loading station history and chart partitions.</h1>
        </section>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell">
        <TitleBanner />
        <section className="hero-panel loading-panel">
          <p className="eyebrow">Castle Rock Conditions</p>
          <h1>Data load failed.</h1>
          <p className="body-copy">{state.message}</p>
        </section>
      </main>
    )
  }

  const statusTooltip =
    climbingStatus === 'green' ? 'No rain in 72h AND fuel moisture < 10%'
    : climbingStatus === 'red' ? 'Rained within 72h AND fuel moisture ≥ 10%'
    : 'Mixed signals or insufficient data'

  return (
    <main className="app-shell">
      <TitleBanner />

      <section className="summary-grid">
        <article className="summary-card snapshot-card latest-card">
          <p className="control-label">Latest reading</p>
          <strong>{formatObservationTime(state.manifest.latestObservationAt)}</strong>
          <a
            className="station-link"
            href="https://forecast.weather.gov/MapClick.php?lon=-122.10464186850001&lat=37.23500005365938#.ZGzoAuzMKDX"
            target="_blank"
            rel="noreferrer"
          >
            NOAA BNDC1
          </a>
          <span
            className={`status-dot status-dot--${climbingStatus}`}
            title={statusTooltip}
            aria-label={statusTooltip}
            role="img"
          />
        </article>

        <SummaryCard
          label="Temperature"
          value={formatValue(latestObservation?.temperatureF ?? null, ' F')}
          valueClassName="summary-value--temperature"
        />
        <SummaryCard
          label="Humidity"
          value={formatValue(latestObservation?.humidityPct ?? null, '%')}
          valueClassName="summary-value--humidity"
        />
        <SummaryCard
          label="Fuel Moisture"
          value={formatValue(latestObservation?.fuelMoisturePct ?? null, '%', 1)}
          valueClassName="summary-value--fuel"
        />
        <WindCard
          windSpeed={formatValue(latestObservation?.windSpeedMph ?? null, ' mph')}
          windGust={formatValue(latestObservation?.windGustMph ?? null, ' mph')}
        />
        <RainCard
          hourlyRain={formatValue(latestObservation?.hourlyPrecipIn ?? null, ' in', 2)}
          past72hRain={formatValue(past72hRainIn, ' in', 2)}
        />
      </section>

      <section className="control-row">
        <div>
          <p className="control-label">History window</p>
          <div className="preset-row">
            {PRESETS.map((candidate) => (
              <button
                key={candidate}
                className={`preset-button ${candidate === preset ? 'is-active' : ''}`}
                onClick={() => {
                  startTransition(() => setPreset(candidate))
                }}
                type="button"
              >
                {candidate}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="chart-panel">
        <HistoryChart observations={deferredObservations} />
      </section>
    </main>
  )
}

function TitleBanner() {
  return (
    <section className="title-banner" aria-label="Page title">
      <div className="title-banner-text">
        <h1>Castle Rock Conditions</h1>
      </div>
      <div className="title-banner-art" aria-hidden="true">
        {BANNER_IMAGES.map((file) => (
          <img key={file} src={`${IMAGE_BASE}${file}`} alt="" />
        ))}
      </div>
    </section>
  )
}

type SummaryCardProps = {
  label: string
  value: string
  valueClassName?: string
}

function SummaryCard({ label, value, valueClassName }: SummaryCardProps) {
  return (
    <article className="summary-card">
      <p className="control-label">{label}</p>
      <strong className={valueClassName}>{value}</strong>
    </article>
  )
}

type RainCardProps = {
  hourlyRain: string
  past72hRain: string
}

type WindCardProps = {
  windSpeed: string
  windGust: string
}

function WindCard({ windSpeed, windGust }: WindCardProps) {
  return (
    <article className="summary-card">
      <p className="control-label">Wind</p>
      <div className="stacked-card-values">
        <div className="stacked-card-row">
          <span>Current</span>
          <strong>{windSpeed}</strong>
        </div>
        <div className="stacked-card-row">
          <span>Gust</span>
          <strong>{windGust}</strong>
        </div>
      </div>
    </article>
  )
}

function RainCard({ hourlyRain, past72hRain }: RainCardProps) {
  return (
    <article className="summary-card rain-card">
      <p className="control-label">Rain</p>
      <div className="stacked-card-values">
        <div className="stacked-card-row">
          <span>Hourly</span>
          <strong>{hourlyRain}</strong>
        </div>
        <div className="stacked-card-row">
          <span>Past 72h</span>
          <strong>{past72hRain}</strong>
        </div>
      </div>
    </article>
  )
}