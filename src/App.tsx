import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
type DataRow = Record<string, unknown>

const MAX_ROWS = 25000
const COLORS = ['#126782', '#f29559', '#457b9d', '#2a9d8f', '#b56576', '#ff7f51']

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function uniqueHeaders(headerRow: unknown[], width: number): string[] {
  const seen = new Map<string, number>()
  const headers: string[] = []

  for (let i = 0; i < width; i += 1) {
    const raw = headerRow[i]
    const normalized = String(raw ?? '').trim()
    const base = normalized.length > 0 ? normalized : `Column_${i + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headers.push(count === 0 ? base : `${base}_${count + 1}`)
  }

  return headers
}

function aggregateRowValue(row: DataRow, measureColumn?: string): number {
  if (!measureColumn) {
    return 1
  }

  const amount = toNumber(row[measureColumn])
  return amount ?? 0
}

function buildSunburstHierarchy(
  sourceRows: DataRow[],
  hierarchyColumns: string[],
  measureColumn?: string,
): SunburstData {
  const root: SunburstData = { name: 'All Data', children: [] }

  if (sourceRows.length === 0) {
    root.value = 0
    return root
  }

  if (hierarchyColumns.length === 0) {
    root.value = sourceRows.reduce(
      (sum, row) => sum + aggregateRowValue(row, measureColumn),
      0,
    )
    return root
  }

  const build = (rowsAtLevel: DataRow[], depth: number): SunburstData[] => {
    const key = hierarchyColumns[depth]
    const groups = new Map<string, DataRow[]>()

    rowsAtLevel.forEach((row) => {
      const name = String(row[key] ?? 'Unknown')
      const bucket = groups.get(name)
      if (bucket) {
        bucket.push(row)
      } else {
        groups.set(name, [row])
      }
    })

    return Array.from(groups.entries()).map(([name, groupedRows], index) => {
      const base: SunburstData = {
        name,
        fill: COLORS[(depth + index) % COLORS.length],
      }

      if (depth < hierarchyColumns.length - 1) {
        const children = build(groupedRows, depth + 1)
        const value = children.reduce((sum, child) => sum + (child.value ?? 0), 0)
        return {
          ...base,
          value,
          children,
        }
      }

      const value = groupedRows.reduce(
        (sum, row) => sum + aggregateRowValue(row, measureColumn),
        0,
      )
      return {
        ...base,
        value,
      }
    })
  }

  root.children = build(sourceRows, 0)
  root.value = root.children.reduce((sum, child) => sum + (child.value ?? 0), 0)
  return root
}

function SortableColumnItem({ column }: { column: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`sortable-item ${isDragging ? 'dragging' : ''}`}
    >
      <button className="drag-handle" type="button" {...attributes} {...listeners}>
        drag
      </button>
      <span>{column}</span>
    </li>
  )
}

function App() {
  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<DataRow[]>([])
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [xColumn, setXColumn] = useState('')
  const [yColumns, setYColumns] = useState<string[]>([])
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [renderChart, setRenderChart] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sunburstStack, setSunburstStack] = useState<SunburstData[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setError('')
    setNotice('')
    setRenderChart(false)

    if (!file) {
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', dense: true })
      const firstSheetName = workbook.SheetNames[0]

      if (!firstSheetName) {
        setError('No sheet found in the uploaded file.')
        return
      }

      const sheet = workbook.Sheets[firstSheetName]
      const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
      }) as unknown[][]

      if (matrix.length === 0) {
        setError('The selected sheet is empty.')
        return
      }

      const width = matrix.reduce((max, current) => Math.max(max, current.length), 0)
      if (width === 0) {
        setError('Could not detect any columns in this file.')
        return
      }

      const headers = uniqueHeaders(matrix[0], width)
      const dataRows = matrix.slice(1, MAX_ROWS + 1).map((cells) => {
        const row: DataRow = {}
        headers.forEach((header, index) => {
          row[header] = cells[index] ?? null
        })
        return row
      })

      if (matrix.length - 1 > MAX_ROWS) {
        setNotice(
          `Loaded first ${MAX_ROWS.toLocaleString()} rows for smooth chart rendering out of ${(matrix.length - 1).toLocaleString()} rows.`,
        )
      }

      setFileName(file.name)
      setColumns(headers)
      setRows(dataRows)
      setSelectedColumns(headers)
      setXColumn(headers[0] ?? '')
      setYColumns(headers.slice(1, 3))
    } catch {
      setError('Unable to parse the file. Please upload a valid .xlsx or .xls file.')
    }
  }

  const toggleColumn = (column: string) => {
    setSelectedColumns((previous) => {
      if (previous.includes(column)) {
        return previous.filter((item) => item !== column)
      }
      return [...previous, column]
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    setSelectedColumns((previous) => {
      const oldIndex = previous.indexOf(String(active.id))
      const newIndex = previous.indexOf(String(over.id))

      if (oldIndex === -1 || newIndex === -1) {
        return previous
      }

      return arrayMove(previous, oldIndex, newIndex)
    })
  }

  const chartData = useMemo(() => {
    if (!renderChart || rows.length === 0 || !xColumn) {
      return []
    }

    if (chartType === 'pie') {
      const targetY = yColumns[0]
      if (!targetY) {
        return []
      }

      const aggregated = new Map<string, number>()
      rows.forEach((row) => {
        const category = String(row[xColumn] ?? 'Unknown')
        const amount = toNumber(row[targetY])
        if (amount === null) {
          return
        }
        aggregated.set(category, (aggregated.get(category) ?? 0) + amount)
      })

      return Array.from(aggregated.entries()).map(([name, value]) => ({ name, value }))
    }

    return rows
      .map((row) => {
        const next: Record<string, string | number | null> = {
          xLabel: row[xColumn] == null ? '' : String(row[xColumn]),
        }

        yColumns.forEach((column) => {
          next[column] = toNumber(row[column])
        })

        return next
      })
      .filter((row) => yColumns.some((column) => typeof row[column] === 'number'))
  }, [chartType, renderChart, rows, xColumn, yColumns])

  const sunburstData = useMemo(() => {
    if (!renderChart || chartType !== 'sunburst' || rows.length === 0) {
      return null
    }

    const hierarchyColumns = selectedColumns.slice(0, 4)
    const numericMeasure = yColumns.find((column) =>
      rows.some((row) => toNumber(row[column]) !== null),
    )

    return buildSunburstHierarchy(rows, hierarchyColumns, numericMeasure)
  }, [chartType, renderChart, rows, selectedColumns, yColumns])

  useEffect(() => {
    if (!renderChart || chartType !== 'sunburst' || !sunburstData) {
      setSunburstStack([])
      return
    }

    setSunburstStack([sunburstData])
  }, [chartType, renderChart, sunburstData])

  const currentSunburstNode =
    sunburstStack.length > 0 ? sunburstStack[sunburstStack.length - 1] : null

  const handleSunburstClick = (node: SunburstData) => {
    if (!node.children || node.children.length === 0) {
      return
    }

    setSunburstStack((previous) => [...previous, node])
  }

  const goSunburstHome = () => {
    if (sunburstStack.length > 0) {
      setSunburstStack([sunburstStack[0]])
    }
  }

  const goSunburstBack = () => {
    setSunburstStack((previous) => {
      if (previous.length <= 1) {
        return previous
      }
      return previous.slice(0, -1)
    })
  }

  const submitConfiguration = () => {
    if (chartType === 'sunburst' && selectedColumns.length === 0) {
      setError('Please keep at least one column selected for Sunburst hierarchy.')
      return
    }

    if (chartType !== 'sunburst' && !xColumn) {
      setError('Please choose an X-axis column.')
      return
    }

    if (chartType !== 'sunburst' && yColumns.length === 0) {
      setError('Please choose at least one Y-axis/value column.')
      return
    }

    setError('')
    setRenderChart(true)
  }

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <h1>Excel to Interactive Chart Studio</h1>
        <p>
          Upload a large Excel file, inspect all columns, arrange them, choose a chart type,
          and render an interactive visualization instantly.
        </p>
      </header>

      <section className="card">
        <label htmlFor="excel-file" className="upload-label">
          Upload Excel file (.xlsx, .xls)
        </label>
        <input
          id="excel-file"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleUpload}
          className="file-input"
        />

        {fileName && <p className="meta">Loaded file: {fileName}</p>}
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {columns.length > 0 && (
        <section className="grid-layout">
          <article className="card">
            <h2>All Columns ({columns.length})</h2>
            <p className="subtle">Click to include/exclude columns from arrangement.</p>
            <div className="column-list">
              {columns.map((column) => (
                <button
                  key={column}
                  type="button"
                  onClick={() => toggleColumn(column)}
                  className={`pill ${selectedColumns.includes(column) ? 'active' : ''}`}
                >
                  {column}
                </button>
              ))}
            </div>
          </article>

          <article className="card">
            <h2>Arrange Columns</h2>
            <p className="subtle">Drag to set your preferred column order.</p>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={selectedColumns} strategy={verticalListSortingStrategy}>
                <ul className="sortable-list">
                  {selectedColumns.map((column) => (
                    <SortableColumnItem key={column} column={column} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </article>

          <article className="card">
            <h2>Chart Setup</h2>
            <div className="form-grid">
              <label>
                Chart Type
                <select
                  value={chartType}
                  onChange={(event) => {
                    setChartType(event.target.value as ChartType)
                    setRenderChart(false)
                  }}
                >
                  <option value="bar">Bar</option>
                  <option value="line">Line</option>
                  <option value="area">Area</option>
                  <option value="scatter">Scatter</option>
                  <option value="pie">Pie</option>
                  <option value="sunburst">Sunburst</option>
                </select>
              </label>

              <label>
                X-axis / Category
                <select
                  value={xColumn}
                  onChange={(event) => {
                    setXColumn(event.target.value)
                    setRenderChart(false)
                  }}
                >
                  {selectedColumns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend>Y-axis / Value Columns</legend>
                <div className="checkbox-grid">
                  {selectedColumns
                    .filter((column) => column !== xColumn)
                    .map((column) => (
                      <label key={column} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={yColumns.includes(column)}
                          onChange={() => {
                            setRenderChart(false)
                            setYColumns((previous) =>
                              previous.includes(column)
                                ? previous.filter((item) => item !== column)
                                : [...previous, column],
                            )
                          }}
                        />
                        {column}
                      </label>
                    ))}
                </div>
              </fieldset>

              <button type="button" className="submit-btn" onClick={submitConfiguration}>
                Render Interactive Chart
              </button>
              {chartType === 'sunburst' && (
                <p className="subtle">
                  Sunburst uses your arranged columns as hierarchy (up to first 4 levels).
                </p>
              )}
            </div>
          </article>
        </section>
      )}

      {renderChart && (
        <section className="card chart-card">
          <h2>Interactive Chart</h2>
          {chartType === 'sunburst' && currentSunburstNode && (
            <div className="sunburst-toolbar">
              <button
                type="button"
                className="toolbar-btn"
                onClick={goSunburstBack}
                disabled={sunburstStack.length <= 1}
              >
                Back
              </button>
              <button
                type="button"
                className="toolbar-btn"
                onClick={goSunburstHome}
                disabled={sunburstStack.length <= 1}
              >
                Home
              </button>
              <p className="breadcrumb">
                {sunburstStack.map((node) => String(node.name)).join(' / ')}
              </p>
            </div>
          )}
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'bar' ? (
                <BarChart data={chartData} margin={{ top: 16, right: 20, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {yColumns.map((col, index) => (
                    <Bar key={col} dataKey={col} fill={COLORS[index % COLORS.length]} />
                  ))}
                </BarChart>
              ) : null}

              {chartType === 'line' ? (
                <LineChart data={chartData} margin={{ top: 16, right: 20, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {yColumns.map((col, index) => (
                    <Line
                      key={col}
                      dataKey={col}
                      stroke={COLORS[index % COLORS.length]}
                      strokeWidth={2.2}
                      dot={false}
                      type="monotone"
                    />
                  ))}
                </LineChart>
              ) : null}

              {chartType === 'area' ? (
                <AreaChart data={chartData} margin={{ top: 16, right: 20, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {yColumns.map((col, index) => (
                    <Area
                      key={col}
                      dataKey={col}
                      stroke={COLORS[index % COLORS.length]}
                      fill={COLORS[index % COLORS.length]}
                      fillOpacity={0.32}
                      type="monotone"
                    />
                  ))}
                </AreaChart>
              ) : null}

              {chartType === 'scatter' ? (
                <ScatterChart margin={{ top: 16, right: 20, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" name={xColumn} />
                  <YAxis dataKey={yColumns[0]} name={yColumns[0]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  <Scatter data={chartData} fill={COLORS[0]} name={yColumns[0]} />
                </ScatterChart>
              ) : null}

              {chartType === 'pie' ? (
                <PieChart>
                  <Tooltip />
                  <Legend />
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={140}
                    innerRadius={50}
                    label
                  >
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`${String(entry.name)}-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
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
                  onClick={handleSunburstClick}
                />
              ) : null}
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </main>
  )
}

export default App
