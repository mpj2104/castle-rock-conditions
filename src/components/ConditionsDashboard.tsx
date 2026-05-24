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
const MAPCLICK_JSON_URL =
  'https://forecast.weather.gov/MapClick.php?lat=37.235&lon=-122.1046&FcstType=json&unit=0&lg=english'
const NOAA_FORECAST_URL =
  'https://forecast.weather.gov/MapClick.php?lon=-122.10464186850001&lat=37.23500005365938#.ZGzoAuzMKDX'

type ClimbingStatus = 'green' | 'red' | 'neutral'

type ForecastPeriod = {
  name: string
  startTime: string
  endTime: string
  detailedForecast: string
}

type ForecastState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; periods: ForecastPeriod[]; updatedAt: string }

type MapClickForecastResponse = {
  creationDate?: string
  time?: {
    startPeriodName?: string[]
    startValidTime?: string[]
  }
  data?: {
    text?: string[]
  }
}

function isNightForecastPeriod(period: ForecastPeriod): boolean {
  const normalizedName = period.name.toLowerCase()
  if (normalizedName.includes('night') || normalizedName.includes('tonight') || normalizedName.includes('overnight')) {
    return true
  }

  const startTime = Date.parse(period.startTime)
  if (!Number.isFinite(startTime)) {
    return false
  }

  const startHour = new Date(startTime).getHours()
  return startHour >= 18 || startHour < 6
}

function getForecastTemperatureBand(period: ForecastPeriod): 'cool' | 'warm' | 'hot' | 'wet' | 'neutral' {
  const hasPrecipitationMention = /(rain|drizzle|showers?|thunderstorms?|precip(?:itation)?|sleet|snow|flurr(?:y|ies)|sprinkles?)/i.test(
    period.detailedForecast,
  )
  if (hasPrecipitationMention) {
    return 'wet'
  }

  const match = period.detailedForecast.match(/(?:high|low)\s(?:near|around)\s(-?\d+)/i)
  if (!match) {
    return 'neutral'
  }

  const temperature = Number.parseInt(match[1], 10)
  if (!Number.isFinite(temperature)) {
    return 'neutral'
  }

  if (temperature <= 69) {
    return 'cool'
  }

  if (temperature <= 79) {
    return 'warm'
  }

  return 'hot'
}

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
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia('(max-width: 640px)').matches
  })
  const [isForecastOpen, setIsForecastOpen] = useState(false)
  const [forecastState, setForecastState] = useState<ForecastState>({ status: 'idle' })
  const [isForecastRefreshing, setIsForecastRefreshing] = useState(false)
  const [forecastWarning, setForecastWarning] = useState<string | null>(null)

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    setIsMobile(mediaQuery.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [])

  useEffect(() => {
    if (!isForecastOpen) {
      return
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsForecastOpen(false)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isForecastOpen])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadNoaaForecast() {
      if (!cancelled) {
        setIsForecastRefreshing(true)
        setForecastState((current) => (current.status === 'ready' ? current : { status: 'loading' }))
      }

      try {
        const forecastResponse = await fetch(MAPCLICK_JSON_URL, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!forecastResponse.ok) {
          throw new Error(`NOAA MapClick request failed (${forecastResponse.status}).`)
        }

        const forecastData = (await forecastResponse.json()) as MapClickForecastResponse
        const periodNames = forecastData.time?.startPeriodName ?? []
        const periodStarts = forecastData.time?.startValidTime ?? []
        const periodTexts = forecastData.data?.text ?? []

        const periods = periodNames
          .map((name, index) => {
            const startTime = periodStarts[index] ?? ''
            const nextStartTime = periodStarts[index + 1] ?? ''
            const startMs = Date.parse(startTime)
            const nextStartMs = Date.parse(nextStartTime)

            const endTime = Number.isFinite(nextStartMs)
              ? new Date(nextStartMs).toISOString()
              : Number.isFinite(startMs)
                ? new Date(startMs + 12 * 60 * 60 * 1000).toISOString()
                : ''

            return {
              name: name || 'Forecast',
              startTime,
              endTime,
              detailedForecast: (periodTexts[index] ?? '').trim(),
            }
          })
          .filter((period) => period.detailedForecast.length > 0)

        if (periods.length === 0) {
          throw new Error('NOAA detailed forecast was empty.')
        }

        if (cancelled) {
          return
        }

        setForecastWarning(null)
        setForecastState({
          status: 'ready',
          periods,
          updatedAt: forecastData.creationDate ?? new Date().toISOString(),
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        if (cancelled) {
          return
        }

        const failureMessage = error instanceof Error ? error.message : 'Failed to refresh NOAA detailed forecast.'
        setForecastWarning('NOAA refresh failed. Showing last successful forecast.')
        setForecastState((current) => {
          if (current.status === 'ready') {
            return current
          }

          return {
            status: 'error',
            message: failureMessage,
          }
        })
      } finally {
        if (!cancelled) {
          setIsForecastRefreshing(false)
        }
      }
    }

    void loadNoaaForecast()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [refreshTick])

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

  const activeForecastPeriod = useMemo(() => {
    if (forecastState.status !== 'ready' || forecastState.periods.length === 0) {
      return null
    }

    const now = Date.now()
    const currentPeriod = forecastState.periods.find((period) => {
      const startTime = Date.parse(period.startTime)
      const endTime = Date.parse(period.endTime)
      return Number.isFinite(startTime) && Number.isFinite(endTime) && startTime <= now && endTime > now
    })

    if (currentPeriod) {
      const currentEndTime = Date.parse(currentPeriod.endTime)
      const isTransitionalThisPeriod = currentPeriod.name.toLowerCase().startsWith('this ')
      const nextPeriod = forecastState.periods.find((period) => {
        const startTime = Date.parse(period.startTime)
        return Number.isFinite(startTime) && startTime > now
      })

      if (isTransitionalThisPeriod && Number.isFinite(currentEndTime) && nextPeriod) {
        const millisUntilCurrentEnds = currentEndTime - now
        const handoffWindowMs = 3 * 60 * 60 * 1000
        if (millisUntilCurrentEnds <= handoffWindowMs) {
          return nextPeriod
        }
      }

      return currentPeriod
    }

    const nextPeriod = forecastState.periods.find((period) => {
      const startTime = Date.parse(period.startTime)
      return Number.isFinite(startTime) && startTime > now
    })

    return nextPeriod ?? forecastState.periods[0]
  }, [forecastState])

  const modalForecastPeriods = useMemo(() => {
    if (forecastState.status !== 'ready' || forecastState.periods.length === 0) {
      return []
    }

    if (!activeForecastPeriod) {
      return forecastState.periods
    }

    const selectedIndex = forecastState.periods.findIndex(
      (period) => period.name === activeForecastPeriod.name && period.startTime === activeForecastPeriod.startTime,
    )

    if (selectedIndex <= 0) {
      return forecastState.periods
    }

    return forecastState.periods.slice(selectedIndex)
  }, [forecastState, activeForecastPeriod])

  const modalForecastRows = useMemo(() => {
    const rows: Array<{ day: ForecastPeriod | null; night: ForecastPeriod | null }> = []
    let pendingRow: { day: ForecastPeriod | null; night: ForecastPeriod | null } = { day: null, night: null }

    for (const period of modalForecastPeriods) {
      if (isNightForecastPeriod(period)) {
        if (pendingRow.night) {
          rows.push(pendingRow)
          pendingRow = { day: null, night: period }
          continue
        }

        pendingRow.night = period
        rows.push(pendingRow)
        pendingRow = { day: null, night: null }
        continue
      }

      if (pendingRow.day) {
        rows.push(pendingRow)
        pendingRow = { day: period, night: null }
        continue
      }

      pendingRow.day = period
    }

    if (pendingRow.day || pendingRow.night) {
      rows.push(pendingRow)
    }

    return rows
  }, [modalForecastPeriods])

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
        <article className="summary-card snapshot-card latest-card latest-reading-card">
          <p className="control-label">Latest reading</p>
          <strong>{formatObservationTime(state.manifest.latestObservationAt)}</strong>
          <a
            className="station-link"
            href={NOAA_FORECAST_URL}
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

        <ForecastCard
          period={activeForecastPeriod}
          loading={(forecastState.status === 'loading' || forecastState.status === 'idle') && !activeForecastPeriod}
          hasError={forecastState.status === 'error' && !activeForecastPeriod}
          isRefreshing={isForecastRefreshing && activeForecastPeriod !== null}
          warning={forecastWarning}
          onOpen={() => {
            setIsForecastOpen(true)
          }}
        />

        <TemperatureHumidityCard
          temperature={formatValue(latestObservation?.temperatureF ?? null, ' F')}
          humidity={formatValue(latestObservation?.humidityPct ?? null, '%')}
          fuelMoisture={formatValue(latestObservation?.fuelMoisturePct ?? null, '%', 1)}
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
        <HistoryChart observations={deferredObservations} compact={isMobile} />
      </section>

      {isForecastOpen ? (
        <div className="forecast-modal-backdrop" role="presentation" onClick={() => setIsForecastOpen(false)}>
          <section
            className="forecast-modal"
            role="dialog"
            aria-modal="true"
            aria-label="NOAA detailed forecast"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="forecast-modal-header">
              <h2>NOAA Detailed Forecast</h2>
              <button
                className="forecast-close"
                type="button"
                onClick={() => {
                  setIsForecastOpen(false)
                }}
                aria-label="Close forecast dialog"
              >
                Close
              </button>
            </div>

            {forecastState.status === 'loading' ? <p className="body-copy">Loading forecast text...</p> : null}

            {isForecastRefreshing && forecastState.status === 'ready' ? (
              <p className="forecast-updated">Updating latest forecast...</p>
            ) : null}

            {forecastState.status === 'error' ? (
              <div>
                <p className="body-copy">{forecastState.message}</p>
              </div>
            ) : null}

            {forecastState.status === 'ready' ? (
              <div>
                <p className="forecast-updated">Updated {formatObservationTime(forecastState.updatedAt)}</p>
                {forecastWarning ? <p className="forecast-warning">{forecastWarning}</p> : null}
                <div className="forecast-period-list">
                  {modalForecastRows.flatMap((row, rowIndex) => [
                    row.day ? (
                      <article
                        key={`${row.day.name}-${row.day.startTime}`}
                        className={`forecast-period-card forecast-period-card--${getForecastTemperatureBand(row.day)}`}
                      >
                        <h3>{row.day.name}</h3>
                        <p>{row.day.detailedForecast}</p>
                      </article>
                    ) : (
                      <div
                        key={`empty-day-${rowIndex}`}
                        className="forecast-period-card forecast-period-card--empty"
                        aria-hidden="true"
                      />
                    ),
                    row.night ? (
                      <article
                        key={`${row.night.name}-${row.night.startTime}`}
                        className={`forecast-period-card forecast-period-card--${getForecastTemperatureBand(row.night)}`}
                      >
                        <h3>{row.night.name}</h3>
                        <p>{row.night.detailedForecast}</p>
                      </article>
                    ) : (
                      <div
                        key={`empty-night-${rowIndex}`}
                        className="forecast-period-card forecast-period-card--empty"
                        aria-hidden="true"
                      />
                    ),
                  ])}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
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

type RainCardProps = {
  hourlyRain: string
  past72hRain: string
}

type TemperatureHumidityCardProps = {
  temperature: string
  humidity: string
  fuelMoisture: string
}

type ForecastCardProps = {
  period: ForecastPeriod | null
  loading: boolean
  hasError: boolean
  isRefreshing: boolean
  warning: string | null
  onOpen: () => void
}

type WindCardProps = {
  windSpeed: string
  windGust: string
}

function TemperatureHumidityCard({ temperature, humidity, fuelMoisture }: TemperatureHumidityCardProps) {
  return (
    <article className="summary-card conditions-card conditions-summary-card">
      <p className="control-label">Conditions</p>
      <div className="stacked-card-values">
        <div className="stacked-card-row">
          <span>Temperature</span>
          <strong className="summary-value--temperature">{temperature}</strong>
        </div>
        <div className="stacked-card-row">
          <span>Humidity</span>
          <strong className="summary-value--humidity">{humidity}</strong>
        </div>
        <div className="stacked-card-row">
          <span>Fuel Moisture</span>
          <strong className="summary-value--fuel">{fuelMoisture}</strong>
        </div>
      </div>
    </article>
  )
}

function ForecastCard({ period, loading, hasError, isRefreshing, warning, onOpen }: ForecastCardProps) {
  return (
    <article className="summary-card forecast-card forecast-summary-card">
      <p className="control-label">Forecast</p>

      {loading ? <p className="forecast-card-text">Loading detailed forecast...</p> : null}

      {isRefreshing ? <p className="forecast-meta">Updating forecast...</p> : null}

      {hasError ? <p className="forecast-card-text">Detailed forecast unavailable right now.</p> : null}

      {warning ? <p className="forecast-warning">{warning}</p> : null}

      {period ? (
        <>
          <p className="forecast-card-text">
            {`${period.name}: ${period.detailedForecast} `}
            <button
              className="forecast-inline-link"
              type="button"
              onClick={onOpen}
            >
              Detailed forecasting...
            </button>
          </p>
        </>
      ) : null}

    </article>
  )
}

function WindCard({ windSpeed, windGust }: WindCardProps) {
  return (
    <article className="summary-card wind-summary-card">
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
    <article className="summary-card rain-card rain-summary-card">
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