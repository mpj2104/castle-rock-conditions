import process from 'node:process'

import { DEFAULT_STATION_ID, getToken, parseArgs, requestJson } from './utils.mjs'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const stationId = args.stid ?? DEFAULT_STATION_ID
  const token = getToken()

  const url = new URL('https://api.synopticdata.com/v2/stations/metadata')
  url.searchParams.set('token', token)
  url.searchParams.set('stid', stationId)
  url.searchParams.set('complete', '1')
  url.searchParams.set('sensorvars', '1')

  const payload = await requestJson(url.toString())
  const station = payload.STATION?.[0]

  if (!station) {
    throw new Error(`No station returned for ${stationId}.`)
  }

  const variables = Object.entries(station.SENSOR_VARIABLES ?? {}).map(([name, sensors]) => ({
    name,
    sensors: Object.keys(sensors),
  }))

  console.log(
    JSON.stringify(
      {
        stationId: station.STID,
        name: station.NAME,
        network: station.MNET_ID,
        latitude: station.LATITUDE,
        longitude: station.LONGITUDE,
        elevationFt: station.ELEVATION,
        periodOfRecord: station.PERIOD_OF_RECORD,
        variables,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})