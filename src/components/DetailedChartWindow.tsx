import { useEffect, useMemo, useState } from 'react'
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
import {
  type DetailedChartPayload,
} from '../detailPayload'
import { loadDetailedPayload } from '../detailPayloadStore'

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function csvEscape(value: string | number): string {
  const text = String(value)
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

type HoverDetails = {
  kind: 'series' | 'pie' | 'sunburst'
  label: string
  total: number
  values: Array<{ key: string; value: number }>
  note?: string
}

function getRowTotal(row: Record<string, string | number>, seriesKeys: string[]): number {
  if (typeof row.total === 'number') {
    return row.total
  }

  return seriesKeys.reduce((sum, key) => sum + toNumber(row[key]), 0)
}

function DetailedChartWindow() {
  const [payload, setPayload] = useState<DetailedChartPayload | null>(null)
  const [isLoadingPayload, setIsLoadingPayload] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [previewLimit, setPreviewLimit] = useState(200)
  const [hoverDetails, setHoverDetails] = useState<HoverDetails | null>(null)

  useEffect(() => {
    let canceled = false

    const readPayload = async () => {
      try {
        const nextPayload = await loadDetailedPayload()
        if (!canceled) {
          setPayload(nextPayload)
        }
      } catch {
        if (!canceled) {
          setPayload(null)
        }
      } finally {
        if (!canceled) {
          setIsLoadingPayload(false)
        }
      }
    }

    readPayload()

    return () => {
      canceled = true
    }
  }, [])

  const filteredRows = useMemo(() => {
    if (!payload) {
      return []
    }

    const query = filterText.trim().toLowerCase()
    if (!query) {
      return payload.sourceChartModel.chartData
    }

    return payload.sourceChartModel.chartData.filter((row) =>
      Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query)),
    )
  }, [payload, filterText])

  const totals = useMemo(() => {
    if (!payload || payload.chartType === 'sunburst') {
      return []
    }

    return payload.sourceChartModel.chartData.map((row) => {
      if (typeof row.total === 'number') {
        return row.total
      }

      return payload.sourceChartModel.seriesKeys.reduce((sum, key) => sum + toNumber(row[key]), 0)
    })
  }, [payload])

  const stats = useMemo(() => {
    if (totals.length === 0) {
      return null
    }

    const sorted = [...totals].sort((left, right) => left - right)
    const sum = totals.reduce((acc, value) => acc + value, 0)
    const mid = Math.floor(sorted.length / 2)
    const median =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      average: sum / totals.length,
      median,
      sum,
    }
  }, [totals])

  const downloadDetailJson = () => {
    if (!payload) {
      return
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${payload.fileName.replace(/\.[^.]+$/, '') || 'chart'}-detailed-view.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const downloadDetailCsv = () => {
    if (!payload || payload.chartType === 'sunburst') {
      return
    }

    const headers = ['Row', ...payload.sourceChartModel.seriesKeys, 'Total']
    const lines = [headers.map((header) => csvEscape(header)).join(',')]

    payload.sourceChartModel.chartData.forEach((row) => {
      const line = [
        csvEscape(String(row.xLabel ?? '')),
        ...payload.sourceChartModel.seriesKeys.map((series) => csvEscape(toNumber(row[series]))),
        csvEscape(toNumber(row.total)),
      ]
      lines.push(line.join(','))
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${payload.fileName.replace(/\.[^.]+$/, '') || 'chart'}-detailed-data.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  if (isLoadingPayload) {
    return (
      <main className="detail-shell">
        <section className="card detail-empty">
          <h1>Detailed Chart View</h1>
          <p className="subtle">Loading detailed payload...</p>
        </section>
      </main>
    )
  }

  if (!payload) {
    return (
      <main className="detail-shell">
        <section className="card detail-empty">
          <h1>Detailed Chart View</h1>
          <p className="subtle">No chart payload found. Open this window from the main app using Open Detailed Window.</p>
        </section>
      </main>
    )
  }

  const handleSeriesHover = (state: {
    isTooltipActive?: boolean
    activePayload?: Array<{ payload?: Record<string, string | number> }>
    activeLabel?: string | number
  }) => {
    if (!state?.isTooltipActive || !state.activePayload || state.activePayload.length === 0) {
      setHoverDetails(null)
      return
    }

    const row = state.activePayload[0]?.payload
    if (!row) {
      setHoverDetails(null)
      return
    }

    const values = payload.renderChartModel.seriesKeys.map((key) => ({
      key,
      value: toNumber(row[key]),
    }))

    setHoverDetails({
      kind: 'series',
      label: String(state.activeLabel ?? row.xLabel ?? 'Unknown'),
      total: getRowTotal(row, payload.renderChartModel.seriesKeys),
      values,
      note:
        payload.chartType === 'scatter'
          ? 'Scatter maps row label on X and first numeric series on Y.'
          : 'Series values are aggregated into total per row label.',
    })
  }

  const handlePieHover = (entry: { name?: string; value?: number } | null) => {
    if (!entry) {
      setHoverDetails(null)
      return
    }

    setHoverDetails({
      kind: 'pie',
      label: String(entry.name ?? 'Unknown'),
      total: Number(entry.value ?? 0),
      values: [{ key: 'Slice value', value: Number(entry.value ?? 0) }],
      note: 'Pie maps each category into one slice with the aggregated value.',
    })
  }

  const handleSunburstHover = (node: SunburstData | null) => {
    if (!node) {
      setHoverDetails(null)
      return
    }

    const value = Number(node.value ?? 0)
    const share = payload.currentSunburstTotal > 0 ? (value / payload.currentSunburstTotal) * 100 : 0
    setHoverDetails({
      kind: 'sunburst',
      label: String(node.name ?? 'Unknown'),
      total: value,
      values: [{ key: 'Share %', value: share }],
      note: 'Sunburst maps hierarchy levels into radial segments from inner to outer rings.',
    })
  }

  return (
    <main className="detail-shell">
      <header className="card detail-header">
        <div>
          <h1>Detailed Chart Window</h1>
          <p className="subtle">
            Generated {new Date(payload.generatedAt).toLocaleString()} from {payload.fileName} using {payload.dataSourceMode} mode.
          </p>
        </div>
        <div className="detail-actions">
          <button type="button" className="toolbar-btn" onClick={downloadDetailJson}>
            Export Detail JSON
          </button>
          {payload.chartType !== 'sunburst' ? (
            <button type="button" className="toolbar-btn" onClick={downloadDetailCsv}>
              Export Full CSV
            </button>
          ) : null}
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      <section className="detail-metrics-grid">
        <article className="card detail-metric">
          <h3>Chart Type</h3>
          <p>{payload.chartType}</p>
        </article>
        <article className="card detail-metric">
          <h3>Rendered Points</h3>
          <p>{payload.renderChartModel.chartData.length.toLocaleString()}</p>
        </article>
        <article className="card detail-metric">
          <h3>Source Rows</h3>
          <p>{payload.sourceChartModel.chartData.length.toLocaleString()}</p>
        </article>
        <article className="card detail-metric">
          <h3>Series Count</h3>
          <p>{payload.sourceChartModel.seriesKeys.length.toLocaleString()}</p>
        </article>
      </section>

      {payload.renderPerfNotice ? (
        <section className="card">
          <p className="notice">{payload.renderPerfNotice}</p>
        </section>
      ) : null}

      {stats ? (
        <section className="detail-metrics-grid">
          <article className="card detail-metric">
            <h3>Total Sum</h3>
            <p>{stats.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </article>
          <article className="card detail-metric">
            <h3>Average</h3>
            <p>{stats.average.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </article>
          <article className="card detail-metric">
            <h3>Median</h3>
            <p>{stats.median.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </article>
          <article className="card detail-metric">
            <h3>Min / Max</h3>
            <p>
              {stats.min.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {stats.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </article>
        </section>
      ) : null}

      <section className="detail-main-grid">
        <section className="card detail-chart-card">
          <h2>Chart</h2>
          {payload.chartType === 'sunburst' && payload.currentSunburstPath.length > 0 ? (
            <p className="subtle">Path: {payload.currentSunburstPath.join(' / ')}</p>
          ) : null}
          <div className="detail-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              {payload.chartType === 'bar' ? (
                <BarChart
                  data={payload.renderChartModel.chartData}
                  margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
                  onMouseMove={handleSeriesHover}
                  onMouseLeave={() => setHoverDetails(null)}
                >
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={72} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {payload.renderChartModel.seriesKeys.map((col, index) => (
                    <Bar key={col} dataKey={col} fill={payload.colors[index % payload.colors.length]} />
                  ))}
                </BarChart>
              ) : null}

              {payload.chartType === 'line' ? (
                <LineChart
                  data={payload.renderChartModel.chartData}
                  margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
                  onMouseMove={handleSeriesHover}
                  onMouseLeave={() => setHoverDetails(null)}
                >
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={72} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {payload.renderChartModel.seriesKeys.map((col, index) => (
                    <Line
                      key={col}
                      dataKey={col}
                      stroke={payload.colors[index % payload.colors.length]}
                      strokeWidth={2.2}
                      dot={false}
                      type="monotone"
                    />
                  ))}
                </LineChart>
              ) : null}

              {payload.chartType === 'area' ? (
                <AreaChart
                  data={payload.renderChartModel.chartData}
                  margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
                  onMouseMove={handleSeriesHover}
                  onMouseLeave={() => setHoverDetails(null)}
                >
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={72} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {payload.renderChartModel.seriesKeys.map((col, index) => (
                    <Area
                      key={col}
                      dataKey={col}
                      stroke={payload.colors[index % payload.colors.length]}
                      fill={payload.colors[index % payload.colors.length]}
                      fillOpacity={0.32}
                      type="monotone"
                    />
                  ))}
                </AreaChart>
              ) : null}

              {payload.chartType === 'scatter' ? (
                <ScatterChart
                  margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
                  onMouseMove={handleSeriesHover}
                  onMouseLeave={() => setHoverDetails(null)}
                >
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" name={payload.pivotRowColumn} type="category" />
                  <YAxis
                    dataKey={payload.renderChartModel.seriesKeys[0]}
                    name={payload.renderChartModel.seriesKeys[0] ?? 'Value'}
                  />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  <Scatter
                    data={payload.renderChartModel.chartData}
                    fill={payload.colors[0]}
                    name={payload.renderChartModel.seriesKeys[0] ?? 'Value'}
                  />
                </ScatterChart>
              ) : null}

              {payload.chartType === 'pie' ? (
                <PieChart>
                  <Tooltip />
                  <Legend />
                  <Pie
                    data={payload.renderChartModel.pieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={180}
                    innerRadius={60}
                    label
                    onMouseEnter={(entry) => handlePieHover(entry as { name?: string; value?: number })}
                    onMouseLeave={() => setHoverDetails(null)}
                  >
                    {payload.renderChartModel.pieData.map((entry, index) => (
                      <Cell key={`${String(entry.name)}-${index}`} fill={payload.colors[index % payload.colors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              ) : null}

              {payload.chartType === 'sunburst' && payload.currentSunburstNode ? (
                <SunburstChart
                  data={payload.currentSunburstNode}
                  dataKey="value"
                  nameKey="name"
                  width="100%"
                  height="100%"
                  innerRadius={40}
                  ringPadding={4}
                  stroke="#ffffff"
                  onMouseEnter={(node) => handleSunburstHover(node)}
                  onMouseLeave={() => handleSunburstHover(null)}
                />
              ) : null}
            </ResponsiveContainer>
          </div>
        </section>

        <aside className="card detail-insights-card">
          <h2>Right-Side Details</h2>

          <section className="detail-section">
            <h3>How Data Is Mapped</h3>
            <ul>
              <li>Mode: {payload.dataSourceMode}</li>
              <li>Chart: {payload.chartType}</li>
              <li>Row/Dimension Field: {payload.pivotRowColumn || '(auto)'}</li>
              <li>Series Split Field: {payload.pivotSeriesColumn || '(none)'}</li>
              <li>Value Field: {payload.pivotValueColumn || '(none)'}</li>
              <li>Aggregation: {payload.pivotAggregation}</li>
              <li>
                Filter: {payload.filterColumn || '(none)'}
                {payload.filterQuery ? ` contains "${payload.filterQuery}"` : ''}
              </li>
              <li>Selected Columns: {payload.selectedColumnCount.toLocaleString()}</li>
              <li>Rendered Points: {payload.renderChartModel.chartData.length.toLocaleString()}</li>
              <li>Source Rows: {payload.sourceChartModel.chartData.length.toLocaleString()}</li>
            </ul>
          </section>

          <section className="detail-section">
            <h3>Live Hover Details</h3>
            {hoverDetails ? (
              <div className="detail-hover-box">
                <p><strong>Label:</strong> {hoverDetails.label}</p>
                <p>
                  <strong>Total:</strong>{' '}
                  {hoverDetails.total.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </p>
                {hoverDetails.values.map((item) => (
                  <p key={`${hoverDetails.label}-${item.key}`}>
                    <strong>{item.key}:</strong>{' '}
                    {item.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </p>
                ))}
                {hoverDetails.note ? <p className="subtle">{hoverDetails.note}</p> : null}
              </div>
            ) : (
              <p className="subtle">Hover on the chart to inspect mapped values and breakdown here.</p>
            )}
          </section>

          <section className="detail-section">
            <h3>Interpretation Notes</h3>
            <ul>
              <li>The chart is interactive and this panel updates from active hover point.</li>
              <li>If sampling/grouping was applied, rendered points can be fewer than source rows.</li>
              <li>Use Export Full CSV for complete aggregated rows used by this visualization.</li>
            </ul>
          </section>
        </aside>
      </section>

      {payload.chartType !== 'sunburst' ? (
        <section className="card detail-table-card">
          <h2>Detailed Data Table</h2>
          <div className="detail-controls">
            <label>
              Search rows
              <input
                type="text"
                value={filterText}
                placeholder="Search any value"
                onChange={(event) => setFilterText(event.target.value)}
              />
            </label>
            <label>
              Preview rows
              <select value={previewLimit} onChange={(event) => setPreviewLimit(Number(event.target.value))}>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </label>
          </div>
          <p className="subtle">
            Showing {Math.min(filteredRows.length, previewLimit).toLocaleString()} of {filteredRows.length.toLocaleString()} matching rows.
          </p>
          <div className="pivot-preview-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  {payload.sourceChartModel.seriesKeys.map((series) => (
                    <th key={`detail-head-${series}`}>{series}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.slice(0, previewLimit).map((row, index) => (
                  <tr key={`detail-row-${index}-${String(row.xLabel)}`}>
                    <td>{String(row.xLabel ?? '')}</td>
                    {payload.sourceChartModel.seriesKeys.map((series) => (
                      <td key={`detail-cell-${index}-${series}`}>
                        {toNumber(row[series]).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                    ))}
                    <td>{toNumber(row.total).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  )
}

export default DetailedChartWindow
