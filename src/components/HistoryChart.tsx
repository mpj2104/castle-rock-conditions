import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

import { formatShortTime } from '../lib/format'
import type { Observation } from '../types'

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  DataZoomComponent,
  MarkLineComponent,
  UniversalTransition,
  CanvasRenderer,
])

type HistoryChartProps = {
  observations: Observation[]
}

function valueOrDash(value: number | null, suffix: string, digits = 0): string {
  if (value === null || Number.isNaN(value)) {
    return 'No data'
  }

  return `${value.toFixed(digits)}${suffix}`
}

function findPrimeWindows(observations: Observation[]): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = []
  const maxGapMs = 90 * 60 * 1000
  const minDurationMs = 2 * 60 * 60 * 1000

  let startIndex: number | null = null

  const isPrimePoint = (observation: Observation) => {
    if (observation.temperatureF === null || observation.humidityPct === null) {
      return false
    }

    return observation.temperatureF >= 55 && observation.temperatureF <= 65 && observation.humidityPct >= 30 && observation.humidityPct <= 40
  }

  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index]
    const qualifies = isPrimePoint(observation)

    if (!qualifies) {
      if (startIndex !== null) {
        const startTime = new Date(observations[startIndex].timestamp).getTime()
        const endTime = new Date(observations[index - 1].timestamp).getTime()
        if (endTime - startTime >= minDurationMs) {
          windows.push({ start: observations[startIndex].timestamp, end: observations[index - 1].timestamp })
        }
      }
      startIndex = null
      continue
    }

    if (startIndex === null) {
      startIndex = index
      continue
    }

    const previousTime = new Date(observations[index - 1].timestamp).getTime()
    const currentTime = new Date(observation.timestamp).getTime()
    if (currentTime - previousTime > maxGapMs) {
      const startTime = new Date(observations[startIndex].timestamp).getTime()
      const endTime = previousTime
      if (endTime - startTime >= minDurationMs) {
        windows.push({ start: observations[startIndex].timestamp, end: observations[index - 1].timestamp })
      }
      startIndex = index
    }
  }

  if (startIndex !== null && observations.length > 0) {
    const startTime = new Date(observations[startIndex].timestamp).getTime()
    const endTime = new Date(observations[observations.length - 1].timestamp).getTime()
    if (endTime - startTime >= minDurationMs) {
      windows.push({ start: observations[startIndex].timestamp, end: observations[observations.length - 1].timestamp })
    }
  }

  return windows
}

export function HistoryChart({ observations }: HistoryChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!chartRef.current) {
      return undefined
    }

    const chart = echarts.init(chartRef.current, undefined, { renderer: 'canvas' })
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(chartRef.current)

    const markerTimestamp = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const primeWindows = findPrimeWindows(observations)

    chart.setOption({
      animationDuration: 500,
      animationEasing: 'cubicOut',
      backgroundColor: 'transparent',
      color: ['#d37036', '#6a8b5f', '#6d3e24', '#1f1f1b', '#b9a993', '#3f76a8'],
      grid: [
        { left: 70, right: 56, top: 40, height: '20%' },
        { left: 70, right: 56, top: '31%', height: '14%' },
        { left: 70, right: 56, top: '50%', height: '14%' },
        { left: 70, right: 56, top: '69%', height: '14%' },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1, 2, 3],
          filterMode: 'none',
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1, 2, 3],
          bottom: 8,
          height: 26,
          borderColor: 'rgba(39, 33, 20, 0.15)',
          backgroundColor: 'rgba(255, 255, 255, 0.45)',
          fillerColor: 'rgba(211, 112, 54, 0.12)',
          handleStyle: {
            color: '#d37036',
          },
        },
      ],
      axisPointer: {
        link: [{ xAxisIndex: [0, 1, 2, 3] }],
        label: {
          backgroundColor: '#1f1f1b',
        },
      },
      legend: {
        top: 0,
        left: 70,
        itemGap: 18,
        textStyle: {
          color: '#645d52',
        },
      },
      tooltip: {
        trigger: 'axis',
        borderWidth: 0,
        backgroundColor: 'rgba(30, 27, 23, 0.92)',
        textStyle: {
          color: '#fffaf0',
        },
        formatter: (params: unknown) => {
          const entries = Array.isArray(params) ? params : [params]
          const first = entries[0] as { axisValue: string; dataIndex: number }
          const observation = observations[first.dataIndex]
          const lines = [formatShortTime(first.axisValue)]

          lines.push(`Temperature: ${valueOrDash(observation.temperatureF, ' F')}`)
          lines.push(`Humidity: ${valueOrDash(observation.humidityPct, '%')}`)
          lines.push(`Fuel moisture: ${valueOrDash(observation.fuelMoisturePct, '%', 1)}`)
          lines.push(`Wind: ${valueOrDash(observation.windSpeedMph, ' mph', 1)}`)
          lines.push(`Gust: ${valueOrDash(observation.windGustMph, ' mph', 1)}`)
          lines.push(`Precipitation: ${valueOrDash(observation.hourlyPrecipIn ?? null, ' in', 2)}`)

          return lines.join('<br/>')
        },
      },
      xAxis: [0, 1, 2, 3].map((index) => ({
        type: 'time',
        gridIndex: index,
        axisLabel: {
          color: '#645d52',
          hideOverlap: true,
        },
        axisLine: {
          lineStyle: {
            color: 'rgba(39, 33, 20, 0.18)',
          },
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(39, 33, 20, 0.08)',
          },
        },
      })),
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          name: 'Temp F',
          nameLocation: 'middle',
          nameGap: 50,
          min: 0,
          max: 100,
          axisLabel: { color: '#645d52' },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 0,
          name: 'RH %',
          nameLocation: 'middle',
          nameGap: 44,
          min: 0,
          max: 100,
          position: 'right',
          axisLabel: { color: '#645d52' },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'Fuel %',
          nameLocation: 'middle',
          nameGap: 50,
          axisLabel: { color: '#645d52' },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 2,
          name: 'Wind mph',
          nameLocation: 'middle',
          nameGap: 50,
          min: 0,
          axisLabel: { color: '#645d52' },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 3,
          name: 'Rain in',
          nameLocation: 'middle',
          nameGap: 50,
          min: 0,
          axisLabel: { color: '#645d52' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Temperature',
          type: 'line',
          smooth: true,
          showSymbol: false,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: observations.map((observation) => [observation.timestamp, observation.temperatureF]),
          lineStyle: { width: 2.5 },
          markLine: {
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: '#d37036', type: 'dashed' },
            data: [{ yAxis: 60 }],
          },
          markArea: {
            silent: true,
            itemStyle: {
              color: 'rgba(212, 175, 55, 0.26)',
            },
            data: primeWindows.map((window) => [{ xAxis: window.start }, { xAxis: window.end }]),
          },
        },
        {
          name: 'Humidity',
          type: 'line',
          smooth: true,
          showSymbol: false,
          xAxisIndex: 0,
          yAxisIndex: 1,
          data: observations.map((observation) => [observation.timestamp, observation.humidityPct]),
          lineStyle: { width: 2.5 },
          markLine: {
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: '#6a8b5f', type: 'dashed' },
            data: [{ yAxis: 35 }],
          },
        },
        {
          name: 'Fuel Moisture',
          type: 'line',
          smooth: true,
          showSymbol: false,
          xAxisIndex: 1,
          yAxisIndex: 2,
          data: observations.map((observation) => [observation.timestamp, observation.fuelMoisturePct]),
          lineStyle: { width: 2.2 },
          areaStyle: {
            opacity: 0.12,
          },
          markLine: {
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: '#6d3e24', type: 'dashed' },
            data: [{ yAxis: 10 }],
          },
        },
        {
          name: 'Wind Speed',
          type: 'line',
          smooth: true,
          showSymbol: false,
          xAxisIndex: 2,
          yAxisIndex: 3,
          data: observations.map((observation) => [observation.timestamp, observation.windSpeedMph]),
          lineStyle: { width: 2.2 },
        },
        {
          name: 'Wind Gust',
          type: 'line',
          smooth: true,
          showSymbol: false,
          xAxisIndex: 2,
          yAxisIndex: 3,
          data: observations.map((observation) => [observation.timestamp, observation.windGustMph]),
          lineStyle: { width: 1.6, type: 'dashed' },
        },
        {
          name: 'Precipitation',
          type: 'bar',
          xAxisIndex: 3,
          yAxisIndex: 4,
          barMaxWidth: 10,
          itemStyle: { color: '#3f76a8' },
          data: observations.map((observation) => [observation.timestamp, observation.hourlyPrecipIn ?? 0]),
          markLine: {
            symbol: ['none', 'none'],
            lineStyle: { color: '#8a4f2d', type: 'dashed', width: 1.4 },
            label: {
              formatter: '72h ago',
              color: '#8a4f2d',
            },
            data: [{ xAxis: markerTimestamp }],
          },
        },
      ],
    })

    return () => {
      resizeObserver.disconnect()
      chart.dispose()
    }
  }, [observations])

  return <div className="chart-shell" ref={chartRef} />
}