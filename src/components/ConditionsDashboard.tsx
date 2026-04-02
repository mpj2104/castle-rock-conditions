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

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; manifest: DataManifest; observations: Observation[] }

export function ConditionsDashboard() {
  const [preset, setPreset] = useState<RangePreset>('7d')
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      try {
        const manifest = await loadManifest()
        const start = getPresetStart(preset, manifest.latestObservationAt)
        const files = getRequiredPartitions(manifest, start)
        const observations = filterObservations(
          await loadObservations(files, manifest.generatedAt),
          start,
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
  }, [preset])

  const deferredObservations = useDeferredValue(
    state.status === 'ready' ? state.observations : [],
  )

  const latestObservation = useMemo(() => {
    return state.status === 'ready' ? getLatestObservation(state.observations) : null
  }, [state])

  if (state.status === 'loading') {
    return (
      <main className="app-shell">
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
        <section className="hero-panel loading-panel">
          <p className="eyebrow">Castle Rock Conditions</p>
          <h1>Data load failed.</h1>
          <p className="body-copy">{state.message}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
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
        </article>

        <SummaryCard
          label="Temperature"
          value={formatValue(latestObservation?.temperatureF ?? null, ' F')}
        />
        <SummaryCard
          label="Humidity"
          value={formatValue(latestObservation?.humidityPct ?? null, '%')}
        />
        <SummaryCard
          label="Fuel Moisture"
          value={formatValue(latestObservation?.fuelMoisturePct ?? null, '%', 1)}
        />
        <SummaryCard
          label="Wind"
          value={formatValue(latestObservation?.windSpeedMph ?? null, ' mph', 1)}
        />
        <SummaryCard
          label="Hourly Rain"
          value={formatValue(latestObservation?.hourlyPrecipIn ?? null, ' in', 2)}
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

type SummaryCardProps = {
  label: string
  value: string
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <article className="summary-card">
      <p className="control-label">{label}</p>
      <strong>{value}</strong>
    </article>
  )
}