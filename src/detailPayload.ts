import type { SunburstData } from 'recharts'

export type DetailedChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'sunburst'

export type DetailedChartModel = {
  chartData: Record<string, string | number>[]
  pieData: Array<{ name: string; value: number }>
  seriesKeys: string[]
  filteredRowCount: number
}

export type DetailedChartPayload = {
  version: 1
  generatedAt: string
  fileName: string
  chartType: DetailedChartType
  dataSourceMode: 'pivot' | 'query' | 'wizard'
  pivotRowColumn: string
  pivotSeriesColumn: string
  pivotValueColumn: string
  pivotAggregation: 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max'
  filterColumn: string
  filterQuery: string
  selectedColumnCount: number
  renderPerfNotice: string
  colors: string[]
  renderChartModel: DetailedChartModel
  sourceChartModel: DetailedChartModel
  currentSunburstNode: SunburstData | null
  currentSunburstPath: string[]
  currentSunburstTotal: number
}

export const DETAILED_CHART_STORAGE_KEY = 'data-visualizer-detailed-chart-v1'
