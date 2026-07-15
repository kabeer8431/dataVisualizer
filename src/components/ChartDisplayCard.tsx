import type { MouseEvent } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  SunburstChart,
  Tooltip,
  XAxis,
  YAxis,
  type SunburstData,
} from 'recharts'

type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'sunburst'

type ChartModel = {
  chartData: Record<string, string | number>[]
  pieData: Array<{ name: string; value: number }>
  seriesKeys: string[]
  filteredRowCount: number
}

type Props = {
  renderChart: boolean
  chartType: ChartType
  colors: string[]
  renderChartModel: ChartModel
  sourceChartModel: ChartModel
  renderPerfNotice: string
  pivotRowColumn: string
  currentSunburstNode: SunburstData | null
  currentSunburstPath: string[]
  currentSunburstTotal: number
  sunburstStackLength: number
  sunburstHoverNode: SunburstData | null
  sunburstHoverPosition: { x: number; y: number }
  onChartMouseMove: (event: MouseEvent<HTMLDivElement>) => void
  onExportPivotCsv: () => void
  onGoSunburstBack: () => void
  onGoSunburstHome: () => void
  onSunburstClick: (node: SunburstData) => void
  onSunburstMouseEnter: (node: SunburstData) => void
  onSunburstMouseLeave: () => void
}

function ChartDisplayCard({
  renderChart,
  chartType,
  colors,
  renderChartModel,
  sourceChartModel,
  renderPerfNotice,
  pivotRowColumn,
  currentSunburstNode,
  currentSunburstPath,
  currentSunburstTotal,
  sunburstStackLength,
  sunburstHoverNode,
  sunburstHoverPosition,
  onChartMouseMove,
  onExportPivotCsv,
  onGoSunburstBack,
  onGoSunburstHome,
  onSunburstClick,
  onSunburstMouseEnter,
  onSunburstMouseLeave,
}: Props) {
  if (!renderChart) {
    return null
  }

  return (
    <section className="card chart-card">
      <h2>Interactive Chart</h2>
      {chartType !== 'sunburst' && (
        <div className="pivot-actions">
          <button type="button" className="toolbar-btn" onClick={onExportPivotCsv}>
            Export Pivot CSV
          </button>
        </div>
      )}
      {renderPerfNotice ? <p className="notice">{renderPerfNotice}</p> : null}
      {chartType === 'sunburst' && currentSunburstNode && (
        <div className="sunburst-toolbar">
          <button
            type="button"
            className="toolbar-btn"
            onClick={onGoSunburstBack}
            disabled={sunburstStackLength <= 1}
          >
            Back
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={onGoSunburstHome}
            disabled={sunburstStackLength <= 1}
          >
            Home
          </button>
          <p className="breadcrumb">{currentSunburstPath.join(' / ')}</p>
        </div>
      )}
      <div className="chart-wrap" onMouseMove={onChartMouseMove}>
        {chartType === 'sunburst' && sunburstHoverNode ? (
          <div
            className="sunburst-callout"
            role="status"
            aria-live="polite"
            style={{
              left: `${sunburstHoverPosition.x}px`,
              top: `${sunburstHoverPosition.y}px`,
            }}
          >
            <p>
              <strong>Segment:</strong> {String(sunburstHoverNode.name)}
            </p>
            <p>
              <strong>Value:</strong> {(sunburstHoverNode.value ?? 0).toLocaleString()}
            </p>
            <p>
              <strong>Share:</strong>{' '}
              {currentSunburstTotal > 0
                ? `${(((sunburstHoverNode.value ?? 0) / currentSunburstTotal) * 100).toFixed(2)}%`
                : '0.00%'}
            </p>
            <p>
              <strong>Path:</strong> {[...currentSunburstPath, String(sunburstHoverNode.name)].join(' / ')}
            </p>
          </div>
        ) : null}
        {chartType !== 'sunburst' && renderChartModel.chartData.length === 0 ? (
          <div className="empty-state">
            <p>No chart data available for current filters/settings.</p>
            <p>Try clearing filters, changing aggregation, or increasing Top N.</p>
          </div>
        ) : null}
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart
              data={renderChartModel.chartData}
              margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
            >
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
              <YAxis />
              <Tooltip />
              <Legend />
              {renderChartModel.seriesKeys.map((col, index) => (
                <Bar key={col} dataKey={col} fill={colors[index % colors.length]} />
              ))}
            </BarChart>
          ) : null}

          {chartType === 'line' ? (
            <LineChart
              data={renderChartModel.chartData}
              margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
            >
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
              <YAxis />
              <Tooltip />
              <Legend />
              {renderChartModel.seriesKeys.map((col, index) => (
                <Line
                  key={col}
                  dataKey={col}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2.2}
                  dot={false}
                  type="monotone"
                />
              ))}
            </LineChart>
          ) : null}

          {chartType === 'area' ? (
            <AreaChart
              data={renderChartModel.chartData}
              margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
            >
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
              <YAxis />
              <Tooltip />
              <Legend />
              {renderChartModel.seriesKeys.map((col, index) => (
                <Area
                  key={col}
                  dataKey={col}
                  stroke={colors[index % colors.length]}
                  fill={colors[index % colors.length]}
                  fillOpacity={0.32}
                  type="monotone"
                />
              ))}
            </AreaChart>
          ) : null}

          {chartType === 'scatter' ? (
            <ScatterChart margin={{ top: 16, right: 20, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="xLabel" name={pivotRowColumn} type="category" />
              <YAxis
                dataKey={renderChartModel.seriesKeys[0]}
                name={renderChartModel.seriesKeys[0] ?? 'Value'}
              />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Legend />
              <Scatter
                data={renderChartModel.chartData}
                fill={colors[0]}
                name={renderChartModel.seriesKeys[0] ?? 'Value'}
              />
            </ScatterChart>
          ) : null}

          {chartType === 'pie' ? (
            <PieChart>
              <Tooltip />
              <Legend />
              <Pie
                data={renderChartModel.pieData}
                dataKey="value"
                nameKey="name"
                outerRadius={140}
                innerRadius={50}
                label
              >
                {renderChartModel.pieData.map((entry, index) => (
                  <Cell key={`${String(entry.name)}-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : null}

          {chartType === 'sunburst' && currentSunburstNode ? (
            <SunburstChart
              data={currentSunburstNode}
              dataKey="value"
              nameKey="name"
              width="100%"
              height="100%"
              innerRadius={35}
              ringPadding={3}
              stroke="#ffffff"
              onClick={onSunburstClick}
              onMouseEnter={onSunburstMouseEnter}
              onMouseLeave={onSunburstMouseLeave}
            />
          ) : null}
        </ResponsiveContainer>
      </div>
      {chartType !== 'sunburst' && sourceChartModel.chartData.length > 0 && (
        <div className="pivot-preview">
          <h3>Pivot Data Preview</h3>
          <div className="pivot-preview-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  {sourceChartModel.seriesKeys.map((series) => (
                    <th key={`head-${series}`}>{series}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sourceChartModel.chartData.slice(0, 30).map((entry) => (
                  <tr key={`row-${String(entry.xLabel)}`}>
                    <td>{String(entry.xLabel)}</td>
                    {sourceChartModel.seriesKeys.map((series) => (
                      <td key={`cell-${String(entry.xLabel)}-${series}`}>
                        {Number(entry[series] ?? 0).toLocaleString()}
                      </td>
                    ))}
                    <td>{Number(entry.total ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sourceChartModel.chartData.length > 30 && (
            <p className="subtle">
              Showing first 30 rows out of {sourceChartModel.chartData.length.toLocaleString()}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export default ChartDisplayCard
