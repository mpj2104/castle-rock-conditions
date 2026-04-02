const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

export function formatObservationTime(timestamp: string): string {
  return fullDateFormatter.format(new Date(timestamp))
}

export function formatShortTime(timestamp: string): string {
  return dateTimeFormatter.format(new Date(timestamp))
}

export function formatValue(value: number | null, suffix: string, digits = 0): string {
  if (value === null || Number.isNaN(value)) {
    return 'No data'
  }

  return `${value.toFixed(digits)}${suffix}`
}

export function formatCardinal(direction: string | null): string {
  return direction ?? 'Calm'
}

export function minutesSince(timestamp: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000))
}

export function describeFreshness(timestamp: string): string {
  const minutes = minutesSince(timestamp)

  if (minutes < 60) {
    return `${minutes} min ago`
  }

  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours} hr ago`
  }

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}