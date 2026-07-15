import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
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
import initSqlJs from 'sql.js'
import type { Database, QueryExecResult, SqlJsStatic } from 'sql.js'

type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'sunburst'
type DataRow = Record<string, unknown>
type ParsedDataResult = {
  headers: string[]
  dataRows: DataRow[]
  notice?: string
}

type SheetDataState = {
  workbook: XLSX.WorkBook | null
  sheetNames: string[]
  selectedSheet: string
}

type PivotAggregation = 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max'

type PivotSortOrder = 'none' | 'desc' | 'asc'

type PivotAccumulator = {
  rows: number
  numericCount: number
  sum: number
  min: number
  max: number
  distinctValues: Set<string>
}

type ViewConfig = {
  chartType: ChartType
  dataSourceMode: DataSourceMode
  pivotRowColumn: string
  pivotSeriesColumn: string
  pivotValueColumn: string
  pivotAggregation: PivotAggregation
  pivotSortOrder: PivotSortOrder
  pivotTopN: number
  filterColumn: string
  filterQuery: string
  querySql: string
  wizardGoal: WizardGoal
  wizardMetric: string
  wizardDimension: string
  wizardSeries: string
  sunburstHierarchyColumns: string[]
  selectedColumns: string[]
}

type SavedView = {
  id: string
  name: string
  config: ViewConfig
}

type DataSourceMode = 'pivot' | 'query' | 'wizard'

type WizardGoal = 'compare' | 'trend' | 'composition' | 'relationship' | 'hierarchy'

type ColumnInsights = {
  numeric: string[]
  temporal: string[]
  categorical: string[]
}

type WizardTemplate = {
  id: string
  label: string
  goal: WizardGoal
  chartType: ChartType
  description: string
}

type ChartModel = {
  chartData: Record<string, string | number>[]
  pieData: Array<{ name: string; value: number }>
  seriesKeys: string[]
  filteredRowCount: number
}

type AppLogEntry = {
  id: string
  level: 'info' | 'error'
  message: string
  timestamp: string
}

const MAX_ROWS = 25000
const COLORS = ['#126782', '#f29559', '#457b9d', '#2a9d8f', '#b56576', '#ff7f51']
const SETTINGS_STORAGE_KEY = 'data-visualizer-settings-v1'
const SAVED_VIEWS_STORAGE_KEY = 'data-visualizer-saved-views-v1'
const SQLITE_DB_STORAGE_KEY = 'data-visualizer-sqlite-db-v1'
const SQL_TABLE_SOURCE = 'uploaded_data'

const WIZARD_TEMPLATES: WizardTemplate[] = [
  {
    id: 'tmpl-top-categories',
    label: 'Top Categories',
    goal: 'compare',
    chartType: 'bar',
    description: 'Compare totals across categories.',
  },
  {
    id: 'tmpl-monthly-trend',
    label: 'Monthly Trend',
    goal: 'trend',
    chartType: 'line',
    description: 'Show metric movement over time.',
  },
  {
    id: 'tmpl-share-breakdown',
    label: 'Share Breakdown',
    goal: 'composition',
    chartType: 'pie',
    description: 'Understand contribution by segment.',
  },
  {
    id: 'tmpl-hierarchy-view',
    label: 'Hierarchy View',
    goal: 'hierarchy',
    chartType: 'sunburst',
    description: 'Drill through multi-level structure.',
  },
]

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function looksLikeDate(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const text = value.trim()
  if (!text) {
    return false
  }

  const isoLike = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text)
  if (!isoLike) {
    return false
  }

  return !Number.isNaN(Date.parse(text))
}

function getColumnInsights(headers: string[], dataRows: DataRow[]): ColumnInsights {
  const numeric: string[] = []
  const temporal: string[] = []
  const categorical: string[] = []

  headers.forEach((header) => {
    const sample = dataRows.slice(0, 250).map((row) => row[header]).filter((value) => value != null)

    const numericHits = sample.filter((value) => toNumber(value) !== null).length
    const dateHits = sample.filter((value) => looksLikeDate(value)).length

    if (numericHits > 0 && numericHits >= sample.length * 0.55) {
      numeric.push(header)
      return
    }

    if (dateHits > 0 && dateHits >= sample.length * 0.45) {
      temporal.push(header)
      return
    }

    categorical.push(header)
  })

  return { numeric, temporal, categorical }
}

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

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1) {
    return ''
  }
  return fileName.slice(lastDot + 1).toLowerCase()
}

function parseMatrixData(matrix: unknown[][]): ParsedDataResult {
  if (matrix.length === 0) {
    throw new Error('The selected file is empty.')
  }

  const width = matrix.reduce((max, current) => Math.max(max, current.length), 0)
  if (width === 0) {
    throw new Error('Could not detect any columns in this file.')
  }

  const headers = uniqueHeaders(matrix[0], width)
  const dataRows = matrix.slice(1, MAX_ROWS + 1).map((cells) => {
    const row: DataRow = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? null
    })
    return row
  })

  const result: ParsedDataResult = {
    headers,
    dataRows,
  }

  if (matrix.length - 1 > MAX_ROWS) {
    result.notice = `Loaded first ${MAX_ROWS.toLocaleString()} rows for smooth chart rendering out of ${(matrix.length - 1).toLocaleString()} rows.`
  }

  return result
}

function normalizeJsonRecords(parsed: unknown): DataRow[] {
  const toRows = (value: unknown[]): DataRow[] =>
    value.map((entry, index) => {
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        return entry as DataRow
      }

      if (Array.isArray(entry)) {
        const row: DataRow = {}
        entry.forEach((cell, cellIndex) => {
          row[`Column_${cellIndex + 1}`] = cell
        })
        return row
      }

      return { value: entry, rowIndex: index + 1 }
    })

  if (Array.isArray(parsed)) {
    return toRows(parsed)
  }

  if (parsed !== null && typeof parsed === 'object') {
    const objectValue = parsed as Record<string, unknown>
    const firstArray = Object.values(objectValue).find((value) => Array.isArray(value))
    if (Array.isArray(firstArray)) {
      return toRows(firstArray)
    }
  }

  throw new Error('JSON must be an array, or an object containing an array field.')
}

function parseJsonData(text: string): ParsedDataResult {
  const parsed = JSON.parse(text) as unknown
  const allRows = normalizeJsonRecords(parsed)

  if (allRows.length === 0) {
    throw new Error('The JSON file has no rows.')
  }

  const limitedRows = allRows.slice(0, MAX_ROWS)
  const headerSeen = new Set<string>()
  const headers: string[] = []

  limitedRows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!headerSeen.has(key)) {
        headerSeen.add(key)
        headers.push(key)
      }
    })
  })

  if (headers.length === 0) {
    throw new Error('Could not detect any fields in the JSON rows.')
  }

  const dataRows = limitedRows.map((row) => {
    const normalized: DataRow = {}
    headers.forEach((header) => {
      normalized[header] = row[header] ?? null
    })
    return normalized
  })

  const result: ParsedDataResult = {
    headers,
    dataRows,
  }

  if (allRows.length > MAX_ROWS) {
    result.notice = `Loaded first ${MAX_ROWS.toLocaleString()} rows for smooth chart rendering out of ${allRows.length.toLocaleString()} rows.`
  }

  return result
}

function parseWorkbookSheet(workbook: XLSX.WorkBook, sheetName: string): ParsedDataResult {
  const sheet = workbook.Sheets[sheetName]

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" was not found in the uploaded file.`)
  }

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  }) as unknown[][]

  return parseMatrixData(matrix)
}

function getSunburstFill(depth: number, index: number): string {
  const hue = (depth * 36 + index * 57) % 360
  const saturation = Math.max(74 - depth * 6, 52)
  const lightness = Math.min(42 + depth * 7, 57)
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

function pickDefaultValueColumn(headers: string[], dataRows: DataRow[]): string {
  const firstNumeric = headers.find((header) =>
    dataRows.some((row) => toNumber(row[header]) !== null),
  )

  if (firstNumeric) {
    return firstNumeric
  }

  return headers[0] ?? ''
}

function createPivotAccumulator(): PivotAccumulator {
  return {
    rows: 0,
    numericCount: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    distinctValues: new Set<string>(),
  }
}

function resolvePivotValue(accumulator: PivotAccumulator, aggregation: PivotAggregation): number {
  if (aggregation === 'count') {
    return accumulator.rows
  }

  if (aggregation === 'countDistinct') {
    return accumulator.distinctValues.size
  }

  if (aggregation === 'sum') {
    return accumulator.sum
  }

  if (aggregation === 'avg') {
    return accumulator.numericCount > 0 ? accumulator.sum / accumulator.numericCount : 0
  }

  if (aggregation === 'min') {
    return accumulator.numericCount > 0 ? accumulator.min : 0
  }

  return accumulator.numericCount > 0 ? accumulator.max : 0
}

function shouldFallbackToCount(
  rows: DataRow[],
  pivotValueColumn: string,
  pivotAggregation: PivotAggregation,
): boolean {
  if (pivotAggregation === 'count' || pivotAggregation === 'countDistinct') {
    return false
  }

  return !rows.some((row) => toNumber(row[pivotValueColumn]) !== null)
}

function csvEscape(value: string | number): string {
  const text = String(value)
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

function saveSqliteToLocalStorage(db: Database): void {
  const exported = db.export()
  localStorage.setItem(SQLITE_DB_STORAGE_KEY, JSON.stringify(Array.from(exported)))
}

function readSavedViewsFromDb(db: Database): SavedView[] {
  const result = db.exec(
    'SELECT id, name, config_json FROM saved_views ORDER BY created_at DESC LIMIT 25',
  )

  if (result.length === 0) {
    return []
  }

  const first = result[0]
  const idIndex = first.columns.indexOf('id')
  const nameIndex = first.columns.indexOf('name')
  const configIndex = first.columns.indexOf('config_json')

  if (idIndex === -1 || nameIndex === -1 || configIndex === -1) {
    return []
  }

  return first.values
    .map((row) => {
      const id = String(row[idIndex] ?? '')
      const name = String(row[nameIndex] ?? '')
      const configText = String(row[configIndex] ?? '{}')

      if (!id || !name) {
        return null
      }

      try {
        const config = JSON.parse(configText) as ViewConfig
        return { id, name, config }
      } catch {
        return null
      }
    })
    .filter((item): item is SavedView => item !== null)
}

function rebuildSourceTable(db: Database, sourceRows: DataRow[], headers: string[]): void {
  db.run(`DROP TABLE IF EXISTS ${SQL_TABLE_SOURCE}`)

  if (headers.length === 0) {
    return
  }

  const numericFlags = headers.map((header) =>
    sourceRows.some((row) => toNumber(row[header]) !== null),
  )

  const createColumns = headers
    .map((header, index) => `${quoteSqlIdentifier(header)} ${numericFlags[index] ? 'REAL' : 'TEXT'}`)
    .join(', ')
  db.run(`CREATE TABLE ${SQL_TABLE_SOURCE} (${createColumns})`)

  const insertColumns = headers.map((header) => quoteSqlIdentifier(header)).join(', ')
  const placeholders = headers.map(() => '?').join(', ')
  const stmt = db.prepare(
    `INSERT INTO ${SQL_TABLE_SOURCE} (${insertColumns}) VALUES (${placeholders})`,
  )

  sourceRows.forEach((row) => {
    const values = headers.map((header, index) => {
      const raw = row[header]
      if (raw == null) {
        return null
      }

      if (numericFlags[index]) {
        const parsed = toNumber(raw)
        return parsed ?? null
      }

      return String(raw)
    })

    stmt.run(values)
  })

  stmt.free()
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
        fill: getSunburstFill(depth, index),
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
  const [pivotRowColumn, setPivotRowColumn] = useState('')
  const [pivotSeriesColumn, setPivotSeriesColumn] = useState('')
  const [pivotValueColumn, setPivotValueColumn] = useState('')
  const [pivotAggregation, setPivotAggregation] = useState<PivotAggregation>('sum')
  const [pivotSortOrder, setPivotSortOrder] = useState<PivotSortOrder>('desc')
  const [pivotTopN, setPivotTopN] = useState(20)
  const [filterColumn, setFilterColumn] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [sunburstHierarchyColumns, setSunburstHierarchyColumns] = useState<string[]>([])
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [renderChart, setRenderChart] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sunburstStack, setSunburstStack] = useState<SunburstData[]>([])
  const [sheetData, setSheetData] = useState<SheetDataState>({
    workbook: null,
    sheetNames: [],
    selectedSheet: '',
  })
  const [sunburstHoverNode, setSunburstHoverNode] = useState<SunburstData | null>(null)
  const [sunburstHoverPosition, setSunburstHoverPosition] = useState({ x: 120, y: 120 })
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [viewNameInput, setViewNameInput] = useState('')
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('pivot')
  const [wizardGoal, setWizardGoal] = useState<WizardGoal>('compare')
  const [wizardMetric, setWizardMetric] = useState('')
  const [wizardDimension, setWizardDimension] = useState('')
  const [wizardSeries, setWizardSeries] = useState('')
  const [querySql, setQuerySql] = useState(
    `SELECT ${quoteSqlIdentifier('Country')} AS category, SUM(${quoteSqlIdentifier('Sales')}) AS value\nFROM ${SQL_TABLE_SOURCE}\nGROUP BY ${quoteSqlIdentifier('Country')}\nORDER BY value DESC\nLIMIT 20`,
  )
  const [queryRows, setQueryRows] = useState<Record<string, string | number>[]>([])
  const [queryColumns, setQueryColumns] = useState<string[]>([])
  const [queryNotice, setQueryNotice] = useState('')
  const [sqliteReady, setSqliteReady] = useState(false)
  const [sqlError, setSqlError] = useState('')
  const [showLogs, setShowLogs] = useState(false)
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([])
  const importConfigInputRef = useRef<HTMLInputElement | null>(null)
  const sqliteRef = useRef<Database | null>(null)

  const columnInsights = useMemo(() => getColumnInsights(selectedColumns, rows), [selectedColumns, rows])

  const pushLog = (level: AppLogEntry['level'], message: string) => {
    const entry: AppLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
    }
    setAppLogs((previous) => [entry, ...previous].slice(0, 150))
  }

  useEffect(() => {
    try {
      const serialized = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (!serialized) {
        return
      }

      const parsed = JSON.parse(serialized) as Partial<{
        chartType: ChartType
        pivotAggregation: PivotAggregation
        pivotSortOrder: PivotSortOrder
        pivotTopN: number
      }>

      if (parsed.chartType) {
        setChartType(parsed.chartType)
      }
      if (parsed.pivotAggregation) {
        setPivotAggregation(parsed.pivotAggregation)
      }
      if (parsed.pivotSortOrder) {
        setPivotSortOrder(parsed.pivotSortOrder)
      }
      if (typeof parsed.pivotTopN === 'number' && Number.isFinite(parsed.pivotTopN)) {
        setPivotTopN(Math.max(0, parsed.pivotTopN))
      }
    } catch {
      // Ignore malformed saved settings.
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          chartType,
          pivotAggregation,
          pivotSortOrder,
          pivotTopN,
        }),
      )
    } catch {
      // Ignore localStorage write errors.
    }
  }, [chartType, pivotAggregation, pivotSortOrder, pivotTopN])

  useEffect(() => {
    let canceled = false

    const setupSqlite = async () => {
      try {
        const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => sqlWasmUrl })
        const serializedDb = localStorage.getItem(SQLITE_DB_STORAGE_KEY)
        const db = serializedDb
          ? new SQL.Database(Uint8Array.from(JSON.parse(serializedDb) as number[]))
          : new SQL.Database()

        db.run(
          `CREATE TABLE IF NOT EXISTS saved_views (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          )`,
        )

        if (canceled) {
          db.close()
          return
        }

        sqliteRef.current = db
        setSavedViews(readSavedViewsFromDb(db))
        setSqliteReady(true)
        pushLog('info', 'SQLite initialized and ready.')
      } catch {
        if (!canceled) {
          setSqlError('SQLite initialization failed. Query mode and DB persistence are unavailable.')
          setSqliteReady(false)
          pushLog('error', 'SQLite initialization failed.')
        }
      }
    }

    setupSqlite()

    return () => {
      canceled = true
      if (sqliteRef.current) {
        sqliteRef.current.close()
        sqliteRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(savedViews))
  }, [savedViews])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setError('')
    setNotice('')
    setRenderChart(false)
    pushLog('info', 'File upload started.')

    if (!file) {
      return
    }

    try {
      const extension = getFileExtension(file.name)
      let parsedData: ParsedDataResult

      if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
        const workbook =
          extension === 'csv'
            ? XLSX.read(await file.text(), { type: 'string', dense: true })
            : XLSX.read(await file.arrayBuffer(), { type: 'array', dense: true })
        const firstSheetName = workbook.SheetNames[0]

        if (!firstSheetName) {
          setError('No sheet found in the uploaded file.')
          return
        }

        parsedData = parseWorkbookSheet(workbook, firstSheetName)
        setSheetData({
          workbook,
          sheetNames: workbook.SheetNames,
          selectedSheet: firstSheetName,
        })
      } else if (extension === 'json') {
        parsedData = parseJsonData(await file.text())
        setSheetData({
          workbook: null,
          sheetNames: [],
          selectedSheet: '',
        })
      } else {
        setError('Unsupported file type. Upload .xlsx, .xls, .csv, or .json.')
        return
      }

      setFileName(file.name)
      setColumns(parsedData.headers)
      setRows(parsedData.dataRows)
      setSelectedColumns(parsedData.headers)
      setPivotRowColumn(parsedData.headers[0] ?? '')
      setPivotSeriesColumn('')
      setPivotValueColumn(pickDefaultValueColumn(parsedData.headers, parsedData.dataRows))
      setPivotAggregation('count')
      setPivotSortOrder('desc')
      setPivotTopN(20)
      setFilterColumn(parsedData.headers[0] ?? '')
      setFilterQuery('')
      setSunburstHierarchyColumns(parsedData.headers.slice(0, 2))
      const insights = getColumnInsights(parsedData.headers, parsedData.dataRows)
      setWizardMetric(insights.numeric[0] ?? parsedData.headers[0] ?? '')
      setWizardDimension(insights.categorical[0] ?? parsedData.headers[0] ?? '')
      setWizardSeries(insights.categorical[1] ?? '')
      setWizardGoal('compare')
      setNotice(parsedData.notice ?? '')
      pushLog(
        'info',
        `File loaded: ${file.name} (${parsedData.dataRows.length.toLocaleString()} rows, ${parsedData.headers.length} columns).`,
      )

      if (sqliteRef.current) {
        rebuildSourceTable(sqliteRef.current, parsedData.dataRows, parsedData.headers)
        saveSqliteToLocalStorage(sqliteRef.current)
        pushLog('info', `SQLite source table refreshed from ${file.name}.`)
      }
    } catch (parseError) {
      if (parseError instanceof Error) {
        setError(parseError.message)
        pushLog('error', `File parse failed: ${parseError.message}`)
      } else {
        setError('Unable to parse the file. Please upload a valid .xlsx, .xls, .csv, or .json file.')
        pushLog('error', 'File parse failed: unknown error.')
      }
    }
  }

  const handleSheetChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSheet = event.target.value

    if (!sheetData.workbook) {
      return
    }

    try {
      const parsedData = parseWorkbookSheet(sheetData.workbook, nextSheet)
      setSheetData((previous) => ({ ...previous, selectedSheet: nextSheet }))
      setColumns(parsedData.headers)
      setRows(parsedData.dataRows)
      setSelectedColumns(parsedData.headers)
      setPivotRowColumn(parsedData.headers[0] ?? '')
      setPivotSeriesColumn('')
      setPivotValueColumn(pickDefaultValueColumn(parsedData.headers, parsedData.dataRows))
      setPivotAggregation('count')
      setPivotSortOrder('desc')
      setPivotTopN(20)
      setFilterColumn(parsedData.headers[0] ?? '')
      setFilterQuery('')
      setSunburstHierarchyColumns(parsedData.headers.slice(0, 2))
      const insights = getColumnInsights(parsedData.headers, parsedData.dataRows)
      setWizardMetric(insights.numeric[0] ?? parsedData.headers[0] ?? '')
      setWizardDimension(insights.categorical[0] ?? parsedData.headers[0] ?? '')
      setWizardSeries(insights.categorical[1] ?? '')
      setWizardGoal('compare')
      setNotice(parsedData.notice ?? '')
      setError('')
      setRenderChart(false)
      setSunburstHoverNode(null)
      pushLog('info', `Sheet switched to ${nextSheet}.`)

      if (sqliteRef.current) {
        rebuildSourceTable(sqliteRef.current, parsedData.dataRows, parsedData.headers)
        saveSqliteToLocalStorage(sqliteRef.current)
        pushLog('info', `SQLite source table refreshed from sheet ${nextSheet}.`)
      }
    } catch (parseError) {
      if (parseError instanceof Error) {
        setError(parseError.message)
        pushLog('error', `Sheet read failed: ${parseError.message}`)
      } else {
        setError('Unable to read the selected sheet. Please try another one.')
        pushLog('error', 'Sheet read failed: unknown error.')
      }
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

  const pivotModel = useMemo(() => {
    if (!renderChart || chartType === 'sunburst' || rows.length === 0 || !pivotRowColumn) {
      return {
        chartData: [] as Record<string, string | number>[],
        pieData: [] as Array<{ name: string; value: number }>,
        seriesKeys: [] as string[],
        filteredRowCount: 0,
      }
    }

    const normalizedFilter = filterQuery.trim().toLowerCase()
    const filteredRows =
      normalizedFilter.length > 0 && filterColumn
        ? rows.filter((row) =>
            String(row[filterColumn] ?? '')
              .toLowerCase()
              .includes(normalizedFilter),
          )
        : rows

    const rowMap = new Map<string, Map<string, PivotAccumulator>>()
    const seriesOrdered: string[] = []
    const seenSeries = new Set<string>()
    const effectiveAggregation = shouldFallbackToCount(
      filteredRows,
      pivotValueColumn,
      pivotAggregation,
    )
      ? 'count'
      : pivotAggregation

    filteredRows.forEach((row) => {
      const rowKey = String(row[pivotRowColumn] ?? 'Unknown')
      const seriesKey = pivotSeriesColumn ? String(row[pivotSeriesColumn] ?? 'Unknown') : 'Value'

      if (!seenSeries.has(seriesKey)) {
        seenSeries.add(seriesKey)
        seriesOrdered.push(seriesKey)
      }

      let rowBucket = rowMap.get(rowKey)
      if (!rowBucket) {
        rowBucket = new Map<string, PivotAccumulator>()
        rowMap.set(rowKey, rowBucket)
      }

      let cellAccumulator = rowBucket.get(seriesKey)
      if (!cellAccumulator) {
        cellAccumulator = createPivotAccumulator()
        rowBucket.set(seriesKey, cellAccumulator)
      }

      cellAccumulator.rows += 1
      cellAccumulator.distinctValues.add(String(row[pivotValueColumn] ?? ''))
      const numericValue = toNumber(row[pivotValueColumn])
      if (numericValue !== null) {
        cellAccumulator.numericCount += 1
        cellAccumulator.sum += numericValue
        if (numericValue < cellAccumulator.min) {
          cellAccumulator.min = numericValue
        }
        if (numericValue > cellAccumulator.max) {
          cellAccumulator.max = numericValue
        }
      }
    })

    let chartData = Array.from(rowMap.entries()).map(([rowKey, seriesMap]) => {
      const next: Record<string, string | number> = { xLabel: rowKey }
      let rowTotal = 0

      seriesOrdered.forEach((seriesKey) => {
        const accumulator = seriesMap.get(seriesKey)
        const value = accumulator ? resolvePivotValue(accumulator, effectiveAggregation) : 0
        next[seriesKey] = value
        rowTotal += value
      })

      next.total = rowTotal
      return next
    })

    if (pivotSortOrder !== 'none') {
      chartData = [...chartData].sort((left, right) => {
        const diff = Number(right.total ?? 0) - Number(left.total ?? 0)
        return pivotSortOrder === 'desc' ? diff : -diff
      })
    }

    if (pivotTopN > 0) {
      chartData = chartData.slice(0, pivotTopN)
    }

    const pieData = chartData.map((entry) => ({
      name: String(entry.xLabel),
      value: Number(entry.total ?? 0),
    }))

    return {
      chartData,
      pieData,
      seriesKeys: seriesOrdered,
      filteredRowCount: filteredRows.length,
    }
  }, [
    chartType,
    filterColumn,
    filterQuery,
    pivotAggregation,
    pivotRowColumn,
    pivotSeriesColumn,
    pivotSortOrder,
    pivotTopN,
    pivotValueColumn,
    renderChart,
    rows,
  ])

  const sunburstData = useMemo(() => {
    const sourceRows = dataSourceMode === 'query' ? queryRows : rows
    if (!renderChart || chartType !== 'sunburst' || sourceRows.length === 0) {
      return null
    }

    const hierarchyBase = dataSourceMode === 'query' ? queryColumns : selectedColumns
    const hierarchyColumns = sunburstHierarchyColumns
      .filter((column) => hierarchyBase.includes(column) && column !== pivotValueColumn)
      .slice(0, 4)
    const numericMeasure = sourceRows.some((row) => toNumber(row[pivotValueColumn]) !== null)
      ? pivotValueColumn
      : undefined

    return buildSunburstHierarchy(sourceRows, hierarchyColumns, numericMeasure)
  }, [
    chartType,
    dataSourceMode,
    pivotValueColumn,
    queryColumns,
    queryRows,
    renderChart,
    rows,
    selectedColumns,
    sunburstHierarchyColumns,
  ])

  const activeChartModel: ChartModel =
    dataSourceMode === 'query'
      ? {
          chartData: queryRows,
          pieData: queryRows.map((row, index) => {
            const label =
              String(row.name ?? row.label ?? row.category ?? row.xLabel ?? `Row ${index + 1}`)
            const numericValueColumn = queryColumns.find((column) =>
              queryRows.some((candidate) => typeof candidate[column] === 'number'),
            )
            const value = numericValueColumn ? Number(row[numericValueColumn] ?? 0) : 0
            return { name: label, value }
          }),
          seriesKeys: queryColumns.filter(
            (column) => column !== 'xLabel' && queryRows.some((row) => typeof row[column] === 'number'),
          ),
          filteredRowCount: queryRows.length,
        }
      : pivotModel

  useEffect(() => {
    if (!renderChart || chartType !== 'sunburst' || !sunburstData) {
      setSunburstStack([])
      setSunburstHoverNode(null)
      return
    }

    setSunburstStack([sunburstData])
    setSunburstHoverNode(null)
  }, [chartType, renderChart, sunburstData])

  const currentSunburstNode =
    sunburstStack.length > 0 ? sunburstStack[sunburstStack.length - 1] : null

  const handleSunburstClick = (node: SunburstData) => {
    if (!node.children || node.children.length === 0) {
      return
    }

    setSunburstStack((previous) => [...previous, node])
    setSunburstHoverNode(null)
  }

  const goSunburstHome = () => {
    if (sunburstStack.length > 0) {
      setSunburstStack([sunburstStack[0]])
      setSunburstHoverNode(null)
    }
  }

  const goSunburstBack = () => {
    setSunburstStack((previous) => {
      if (previous.length <= 1) {
        return previous
      }
      return previous.slice(0, -1)
    })
    setSunburstHoverNode(null)
  }

  const currentSunburstTotal = currentSunburstNode?.value ?? 0
  const currentSunburstPath = sunburstStack.map((node) => String(node.name))
  const isSunburstChart = chartType === 'sunburst'
  const isSeriesChart = chartType === 'bar' || chartType === 'line' || chartType === 'area'
  const isPieOrScatter = chartType === 'pie' || chartType === 'scatter'
  const wizardRecommendations = useMemo(() => {
    const recommendations: Array<{ label: string; message: string; apply: () => void }> = []

    if (columnInsights.temporal.length > 0 && columnInsights.numeric.length > 0) {
      recommendations.push({
        label: 'Trend Over Time',
        message: `${columnInsights.numeric[0]} by ${columnInsights.temporal[0]} as line chart`,
        apply: () => {
          setDataSourceMode('wizard')
          setWizardGoal('trend')
          setWizardMetric(columnInsights.numeric[0])
          setWizardDimension(columnInsights.temporal[0])
          setWizardSeries(columnInsights.categorical[0] ?? '')
        },
      })
    }

    if (columnInsights.categorical.length > 0 && columnInsights.numeric.length > 0) {
      recommendations.push({
        label: 'Category Comparison',
        message: `${columnInsights.numeric[0]} by ${columnInsights.categorical[0]} as bar chart`,
        apply: () => {
          setDataSourceMode('wizard')
          setWizardGoal('compare')
          setWizardMetric(columnInsights.numeric[0])
          setWizardDimension(columnInsights.categorical[0])
          setWizardSeries(columnInsights.categorical[1] ?? '')
        },
      })
    }

    if (columnInsights.categorical.length > 1 && columnInsights.numeric.length > 0) {
      recommendations.push({
        label: 'Hierarchy Breakdown',
        message: `${columnInsights.numeric[0]} across ${columnInsights.categorical[0]} -> ${columnInsights.categorical[1]}`,
        apply: () => {
          setDataSourceMode('wizard')
          setWizardGoal('hierarchy')
          setWizardMetric(columnInsights.numeric[0])
          setWizardDimension(columnInsights.categorical[0])
          setWizardSeries(columnInsights.categorical[1])
        },
      })
    }

    return recommendations.slice(0, 3)
  }, [columnInsights])

  const submitConfiguration = () => {
    if (
      chartType === 'sunburst' &&
      sunburstHierarchyColumns.filter((column) => column !== pivotValueColumn).length === 0
    ) {
      setError('Please choose at least one hierarchy field for Sunburst.')
      return
    }

    if (chartType !== 'sunburst' && !pivotRowColumn) {
      setError('Please choose a Rows field for pivot output.')
      return
    }

    if (chartType !== 'sunburst' && !pivotValueColumn) {
      setError('Please choose a Values field for pivot output.')
      return
    }

    setError('')
    setRenderChart(true)
    pushLog('info', `Rendered ${chartType} chart using ${dataSourceMode} mode.`)
  }

  const applyWizardTemplate = (template: WizardTemplate) => {
    setDataSourceMode('wizard')
    setWizardGoal(template.goal)

    if (template.goal === 'trend') {
      setWizardDimension(columnInsights.temporal[0] ?? columnInsights.categorical[0] ?? selectedColumns[0] ?? '')
      setWizardMetric(columnInsights.numeric[0] ?? selectedColumns[0] ?? '')
      setWizardSeries(columnInsights.categorical[0] ?? '')
      return
    }

    setWizardDimension(columnInsights.categorical[0] ?? selectedColumns[0] ?? '')
    setWizardMetric(columnInsights.numeric[0] ?? selectedColumns[0] ?? '')
    setWizardSeries(columnInsights.categorical[1] ?? '')
  }

  const renderFromWizard = () => {
    if (!wizardDimension) {
      setError('Guided Builder needs a category/time field.')
      return
    }

    if (!wizardMetric) {
      setError('Guided Builder needs a metric/value field.')
      return
    }

    setDataSourceMode('pivot')
    setPivotRowColumn(wizardDimension)
    setPivotValueColumn(wizardMetric)
    setPivotSeriesColumn(wizardSeries)

    if (wizardGoal === 'compare') {
      setChartType('bar')
      setPivotAggregation('sum')
    } else if (wizardGoal === 'trend') {
      setChartType('line')
      setPivotAggregation('sum')
    } else if (wizardGoal === 'composition') {
      setChartType('pie')
      setPivotSeriesColumn('')
      setPivotAggregation('sum')
    } else if (wizardGoal === 'relationship') {
      setChartType('scatter')
      setPivotSeriesColumn('')
      setPivotAggregation('avg')
    } else {
      setChartType('sunburst')
      const hierarchy = [wizardDimension, wizardSeries]
        .filter((item) => item && selectedColumns.includes(item))
        .concat(selectedColumns.filter((item) => item !== wizardDimension && item !== wizardSeries))
      setSelectedColumns(hierarchy)
      setSunburstHierarchyColumns([wizardDimension, wizardSeries].filter((item) => Boolean(item)))
    }

    setError('')
    setRenderChart(true)
    pushLog('info', `Guided Builder rendered ${wizardGoal} visualization.`)
  }

  const handleChartMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (chartType !== 'sunburst' || !sunburstHoverNode) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    setSunburstHoverPosition({ x, y })
  }

  const sunburstSelectableColumns =
    dataSourceMode === 'query'
      ? queryColumns.filter((column) => column !== pivotValueColumn)
      : selectedColumns.filter((column) => column !== pivotValueColumn)

  useEffect(() => {
    const sanitized = sunburstHierarchyColumns.filter((column) =>
      sunburstSelectableColumns.includes(column),
    )

    if (sanitized.length !== sunburstHierarchyColumns.length) {
      setSunburstHierarchyColumns(sanitized.slice(0, 4))
      return
    }

    if (sanitized.length === 0 && sunburstSelectableColumns.length > 0) {
      setSunburstHierarchyColumns(sunburstSelectableColumns.slice(0, 2))
    }
  }, [sunburstHierarchyColumns, sunburstSelectableColumns])

  const toggleSunburstHierarchyColumn = (column: string) => {
    setSunburstHierarchyColumns((previous) => {
      if (previous.includes(column)) {
        return previous.filter((item) => item !== column)
      }

      if (previous.length >= 4) {
        return previous
      }

      return [...previous, column]
    })
    setRenderChart(false)
  }

  const resetPivotControls = () => {
    const defaults = {
      row: selectedColumns[0] ?? '',
      value: pickDefaultValueColumn(selectedColumns, rows),
      filter: selectedColumns[0] ?? '',
    }

    setPivotRowColumn(defaults.row)
    setPivotSeriesColumn('')
    setPivotValueColumn(defaults.value)
    setPivotAggregation('count')
    setPivotSortOrder('desc')
    setPivotTopN(20)
    setFilterColumn(defaults.filter)
    setFilterQuery('')
    setSunburstHierarchyColumns(selectedColumns.slice(0, 2))
    setRenderChart(false)
    pushLog('info', 'Pivot controls reset to defaults.')
  }

  const buildCurrentViewConfig = (): ViewConfig => ({
    chartType,
    dataSourceMode,
    pivotRowColumn,
    pivotSeriesColumn,
    pivotValueColumn,
    pivotAggregation,
    pivotSortOrder,
    pivotTopN,
    filterColumn,
    filterQuery,
    querySql,
    wizardGoal,
    wizardMetric,
    wizardDimension,
    wizardSeries,
    sunburstHierarchyColumns,
    selectedColumns,
  })

  const applyViewConfig = (config: ViewConfig) => {
    setChartType(config.chartType)
    setDataSourceMode(config.dataSourceMode ?? 'pivot')
    setPivotRowColumn(config.pivotRowColumn)
    setPivotSeriesColumn(config.pivotSeriesColumn)
    setPivotValueColumn(config.pivotValueColumn)
    setPivotAggregation(config.pivotAggregation)
    setPivotSortOrder(config.pivotSortOrder)
    setPivotTopN(Math.max(0, config.pivotTopN))
    setFilterColumn(config.filterColumn)
    setFilterQuery(config.filterQuery)
    setQuerySql(config.querySql ?? querySql)
    setWizardGoal(config.wizardGoal ?? wizardGoal)
    setWizardMetric(config.wizardMetric ?? wizardMetric)
    setWizardDimension(config.wizardDimension ?? wizardDimension)
    setWizardSeries(config.wizardSeries ?? wizardSeries)
    setSunburstHierarchyColumns(config.sunburstHierarchyColumns ?? sunburstHierarchyColumns)
    if (Array.isArray(config.selectedColumns) && config.selectedColumns.length > 0) {
      setSelectedColumns(config.selectedColumns)
    }
    setRenderChart(false)
    setError('')
  }

  const saveCurrentView = () => {
    const name = viewNameInput.trim()
    if (!name) {
      setError('Please enter a name before saving a view.')
      pushLog('error', 'Save view failed: missing name.')
      return
    }

    const nextView: SavedView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      config: buildCurrentViewConfig(),
    }

    if (sqliteRef.current) {
      sqliteRef.current.run(
        'INSERT OR REPLACE INTO saved_views (id, name, config_json, created_at) VALUES (?, ?, ?, ?)',
        [nextView.id, nextView.name, JSON.stringify(nextView.config), new Date().toISOString()],
      )
      saveSqliteToLocalStorage(sqliteRef.current)
      setSavedViews(readSavedViewsFromDb(sqliteRef.current))
      setViewNameInput('')
      setError('')
      pushLog('info', `Saved view "${name}" to SQLite.`)
      return
    }

    setSavedViews((previous) => [nextView, ...previous].slice(0, 25))
    setViewNameInput('')
    setError('')
    pushLog('info', `Saved view "${name}" to local state.`)
  }

  const loadSavedView = (viewId: string) => {
    const target = savedViews.find((view) => view.id === viewId)
    if (!target) {
      return
    }
    applyViewConfig(target.config)
    pushLog('info', `Loaded saved view "${target.name}".`)
  }

  const deleteSavedView = (viewId: string) => {
    if (sqliteRef.current) {
      sqliteRef.current.run('DELETE FROM saved_views WHERE id = ?', [viewId])
      saveSqliteToLocalStorage(sqliteRef.current)
      setSavedViews(readSavedViewsFromDb(sqliteRef.current))
      pushLog('info', 'Deleted saved view from SQLite.')
      return
    }

    setSavedViews((previous) => previous.filter((view) => view.id !== viewId))
    pushLog('info', 'Deleted saved view.')
  }

  const exportCurrentConfig = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      config: buildCurrentViewConfig(),
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName.replace(/\.[^.]+$/, '') || 'chart'}-config.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    pushLog('info', 'Exported current config JSON.')
  }

  const handleImportConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Partial<{ config: ViewConfig } & ViewConfig>
      const config = (parsed.config ?? parsed) as ViewConfig

      if (!config || !config.chartType || !config.pivotRowColumn) {
        setError('Invalid config file format.')
        pushLog('error', 'Import config failed: invalid format.')
        return
      }

      applyViewConfig(config)
      pushLog('info', 'Imported chart config JSON.')
    } catch {
      setError('Unable to import config. Please select a valid JSON file.')
      pushLog('error', 'Import config failed: unreadable JSON.')
    } finally {
      event.target.value = ''
    }
  }

  const downloadPivotCsv = () => {
    if (activeChartModel.chartData.length === 0) {
      setError('No pivot rows available to export.')
      pushLog('error', 'Export CSV failed: no data rows available.')
      return
    }

    const headers = ['Row', ...activeChartModel.seriesKeys, 'Total']
    const lines = [headers.map((item) => csvEscape(item)).join(',')]

    activeChartModel.chartData.forEach((entry) => {
      const rowValues = [
        csvEscape(String(entry.xLabel ?? '')),
        ...activeChartModel.seriesKeys.map((seriesKey) =>
          csvEscape(Number(entry[seriesKey] ?? 0)),
        ),
        csvEscape(Number(entry.total ?? 0)),
      ]
      lines.push(rowValues.join(','))
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName.replace(/\.[^.]+$/, '') || 'pivot'}-pivot.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    pushLog('info', `Exported ${activeChartModel.chartData.length.toLocaleString()} rows to CSV.`)
  }

  const runSqlQuery = () => {
    if (!sqliteRef.current) {
      setSqlError('SQLite is not ready yet.')
      pushLog('error', 'SQL query failed: SQLite not ready.')
      return
    }

    const trimmed = querySql.trim()
    if (!trimmed) {
      setSqlError('Please enter a SQL query.')
      pushLog('error', 'SQL query failed: query is empty.')
      return
    }

    const startsWithSelect = /^select\b/i.test(trimmed)
    const startsWithWith = /^with\b/i.test(trimmed)
    if (!startsWithSelect && !startsWithWith) {
      setSqlError('Only read-only SELECT/CTE queries are allowed.')
      pushLog('error', 'SQL query rejected: only SELECT/CTE allowed.')
      return
    }

    try {
      const result = sqliteRef.current.exec(trimmed)
      if (result.length === 0) {
        setQueryColumns([])
        setQueryRows([])
        setQueryNotice('Query executed successfully but returned no rows.')
        setSqlError('')
        pushLog('info', 'SQL query executed with zero rows returned.')
        return
      }

      const first = result[0] as QueryExecResult
      const mapped = first.values.map((row) => {
        const next: Record<string, string | number> = {}
        first.columns.forEach((column, index) => {
          const value = row[index]
          next[column] = typeof value === 'number' ? value : value == null ? '' : String(value)
        })
        return next
      })

      setQueryColumns(first.columns)
      setQueryRows(mapped)
      const hierarchyDefaults = first.columns
        .filter((column) => column !== pivotValueColumn)
        .slice(0, 2)
      if (hierarchyDefaults.length > 0) {
        setSunburstHierarchyColumns(hierarchyDefaults)
      }
      setQueryNotice(`Query returned ${mapped.length.toLocaleString()} rows.`)
      setSqlError('')
      setDataSourceMode('query')
      setRenderChart(true)
      pushLog('info', `SQL query executed successfully (${mapped.length.toLocaleString()} rows).`)
    } catch (queryError) {
      if (queryError instanceof Error) {
        setSqlError(queryError.message)
        pushLog('error', `SQL query failed: ${queryError.message}`)
      } else {
        setSqlError('Query failed to execute.')
        pushLog('error', 'SQL query failed: unknown error.')
      }
    }
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
          Upload data file (.xlsx, .xls, .csv, .json)
        </label>
        <input
          id="excel-file"
          type="file"
          accept=".xlsx,.xls,.csv,.json"
          onChange={handleUpload}
          className="file-input"
        />

        {fileName && <p className="meta">Loaded file: {fileName}</p>}
        {sheetData.sheetNames.length > 0 && (
          <label className="sheet-select-label">
            Select sheet
            <select value={sheetData.selectedSheet} onChange={handleSheetChange}>
              {sheetData.sheetNames.map((sheetName) => (
                <option key={sheetName} value={sheetName}>
                  {sheetName}
                </option>
              ))}
            </select>
          </label>
        )}
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
              <div className="compact-field">
                <label htmlFor="chart-type">Chart Type</label>
                <select
                  id="chart-type"
                  value={chartType}
                  onChange={(event) => {
                    const nextChartType = event.target.value as ChartType
                    setChartType(nextChartType)
                    if (nextChartType === 'pie' || nextChartType === 'scatter') {
                      setPivotSeriesColumn('')
                    }
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
              </div>

              <div className="compact-field">
                <label htmlFor="data-source-mode">Data Source</label>
                <select
                  id="data-source-mode"
                  value={dataSourceMode}
                  onChange={(event) => {
                    setDataSourceMode(event.target.value as DataSourceMode)
                    setRenderChart(false)
                    setSqlError('')
                  }}
                >
                  <option value="pivot">Pivot Builder</option>
                  <option value="query">SQL Query</option>
                  <option value="wizard">Guided Builder</option>
                </select>
              </div>

              {dataSourceMode === 'wizard' ? (
                <div className="wizard-panel">
                  <h3>Guided Builder</h3>
                  <p className="subtle">
                    Choose what you want to understand. The app configures chart fields for you.
                  </p>

                  {wizardRecommendations.length > 0 ? (
                    <div className="wizard-recommendations">
                      {wizardRecommendations.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          className="wizard-chip"
                          onClick={item.apply}
                        >
                          <strong>{item.label}</strong>
                          <span>{item.message}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="wizard-template-grid">
                    {WIZARD_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="wizard-template"
                        onClick={() => applyWizardTemplate(template)}
                      >
                        <strong>{template.label}</strong>
                        <span>{template.description}</span>
                      </button>
                    ))}
                  </div>

                  <div className="compact-field">
                    <label htmlFor="wizard-goal">Goal</label>
                    <select
                      id="wizard-goal"
                      value={wizardGoal}
                      onChange={(event) => setWizardGoal(event.target.value as WizardGoal)}
                    >
                      <option value="compare">Compare categories</option>
                      <option value="trend">Trend over time</option>
                      <option value="composition">Part-to-whole</option>
                      <option value="relationship">Relationship (scatter)</option>
                      <option value="hierarchy">Hierarchy (sunburst)</option>
                    </select>
                  </div>

                  <div className="compact-field">
                    <label htmlFor="wizard-dimension">Category/Time</label>
                    <select
                      id="wizard-dimension"
                      value={wizardDimension}
                      onChange={(event) => setWizardDimension(event.target.value)}
                    >
                      {selectedColumns.map((column) => (
                        <option key={`wiz-dim-${column}`} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="compact-field">
                    <label htmlFor="wizard-metric">Metric</label>
                    <select
                      id="wizard-metric"
                      value={wizardMetric}
                      onChange={(event) => setWizardMetric(event.target.value)}
                    >
                      {selectedColumns.map((column) => (
                        <option key={`wiz-metric-${column}`} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="compact-field">
                    <label htmlFor="wizard-series">Optional Split</label>
                    <select
                      id="wizard-series"
                      value={wizardSeries}
                      onChange={(event) => setWizardSeries(event.target.value)}
                    >
                      <option value="">(None)</option>
                      {selectedColumns.map((column) => (
                        <option key={`wiz-series-${column}`} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="wizard-actions">
                    <button type="button" className="submit-btn" onClick={renderFromWizard}>
                      Build Chart From Wizard
                    </button>
                  </div>
                </div>
              ) : null}

              {dataSourceMode === 'query' ? (
                <div className="query-panel">
                  <label htmlFor="query-sql">SQL (table: uploaded_data)</label>
                  <textarea
                    id="query-sql"
                    value={querySql}
                    onChange={(event) => setQuerySql(event.target.value)}
                    rows={8}
                    spellCheck={false}
                  />
                  <div className="query-panel-actions">
                    <button type="button" className="submit-btn" onClick={runSqlQuery}>
                      Run Query and Visualize
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setQuerySql(
                          `SELECT ${quoteSqlIdentifier('Country')} AS category, SUM(${quoteSqlIdentifier('Sales')}) AS value\nFROM ${SQL_TABLE_SOURCE}\nGROUP BY ${quoteSqlIdentifier('Country')}\nORDER BY value DESC\nLIMIT 20`,
                        )
                      }}
                    >
                      Load Example Query
                    </button>
                  </div>
                  {queryNotice ? <p className="notice">{queryNotice}</p> : null}
                  {sqlError ? <p className="error">{sqlError}</p> : null}
                  {!sqliteReady ? (
                    <p className="subtle">SQLite is still loading. Query mode will activate soon.</p>
                  ) : null}
                </div>
              ) : null}

              {isSunburstChart ? (
                <div className="sunburst-field-panel">
                  <div className="compact-field">
                    <label htmlFor="sunburst-value-field">Value Field</label>
                    <select
                      id="sunburst-value-field"
                      value={pivotValueColumn}
                      onChange={(event) => {
                        setPivotValueColumn(event.target.value)
                        setRenderChart(false)
                      }}
                    >
                      {(dataSourceMode === 'query' ? queryColumns : selectedColumns).map((column) => (
                        <option key={`sunburst-value-${column}`} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  <fieldset className="sunburst-levels">
                    <legend>Hierarchy Fields (max 4)</legend>
                    <div className="sunburst-level-grid">
                      {sunburstSelectableColumns.map((column) => (
                        <label key={`sunburst-level-${column}`} className="checkbox-item">
                          <input
                            type="checkbox"
                            checked={sunburstHierarchyColumns.includes(column)}
                            onChange={() => toggleSunburstHierarchyColumn(column)}
                          />
                          {column}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              ) : null}

              {dataSourceMode === 'pivot' && !isSunburstChart ? (
                <>
                  <div className="compact-field">
                    <label htmlFor="pivot-rows">Rows</label>
                    <select
                      id="pivot-rows"
                      value={pivotRowColumn}
                      onChange={(event) => {
                        setPivotRowColumn(event.target.value)
                        setRenderChart(false)
                      }}
                    >
                      {selectedColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isSeriesChart ? (
                    <div className="compact-field">
                      <label htmlFor="pivot-series">Series</label>
                      <select
                        id="pivot-series"
                        value={pivotSeriesColumn}
                        onChange={(event) => {
                          setPivotSeriesColumn(event.target.value)
                          setRenderChart(false)
                        }}
                      >
                        <option value="">(None)</option>
                        {selectedColumns.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="compact-field">
                    <label htmlFor="pivot-values">Values</label>
                    <select
                      id="pivot-values"
                      value={pivotValueColumn}
                      onChange={(event) => {
                        setPivotValueColumn(event.target.value)
                        setRenderChart(false)
                      }}
                    >
                      {selectedColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="compact-field">
                    <label htmlFor="pivot-aggregation">Aggregation</label>
                    <select
                      id="pivot-aggregation"
                      value={pivotAggregation}
                      onChange={(event) => {
                        setPivotAggregation(event.target.value as PivotAggregation)
                        setRenderChart(false)
                      }}
                    >
                      <option value="sum">Sum</option>
                      <option value="count">Count</option>
                      <option value="countDistinct">Count Distinct</option>
                      <option value="avg">Average</option>
                      <option value="min">Minimum</option>
                      <option value="max">Maximum</option>
                    </select>
                  </div>

                  <div className="compact-field">
                    <label htmlFor="filter-field">Filter Field</label>
                    <select
                      id="filter-field"
                      value={filterColumn}
                      onChange={(event) => {
                        setFilterColumn(event.target.value)
                        setRenderChart(false)
                      }}
                    >
                      {selectedColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="compact-field">
                    <label htmlFor="filter-query">Filter Contains</label>
                    <input
                      id="filter-query"
                      type="text"
                      value={filterQuery}
                      placeholder="e.g. india"
                      onChange={(event) => {
                        setFilterQuery(event.target.value)
                        setRenderChart(false)
                      }}
                    />
                  </div>

                  <div className="compact-field">
                    <label htmlFor="sort-order">Sort by Total</label>
                    <select
                      id="sort-order"
                      value={pivotSortOrder}
                      onChange={(event) => {
                        setPivotSortOrder(event.target.value as PivotSortOrder)
                        setRenderChart(false)
                      }}
                    >
                      <option value="desc">High to Low</option>
                      <option value="asc">Low to High</option>
                      <option value="none">Original</option>
                    </select>
                  </div>

                  <div className="compact-field">
                    <label htmlFor="top-n">Top N (0 = all)</label>
                    <input
                      id="top-n"
                      type="number"
                      min={0}
                      value={pivotTopN}
                      onChange={(event) => {
                        const parsed = Number(event.target.value)
                        setPivotTopN(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0)
                        setRenderChart(false)
                      }}
                    />
                  </div>
                </>
              ) : null}

              {dataSourceMode === 'pivot' ? (
                <button type="button" className="submit-btn" onClick={submitConfiguration}>
                  Render Interactive Chart
                </button>
              ) : null}
              {dataSourceMode === 'pivot' && chartType !== 'sunburst' && (
                <button type="button" className="secondary-btn" onClick={resetPivotControls}>
                  Reset Pivot Controls
                </button>
              )}
              {dataSourceMode === 'pivot' && !isSunburstChart && (
                <div className="view-manager">
                  <h3>Saved Views</h3>
                  <div className="view-row">
                    <input
                      type="text"
                      placeholder="View name"
                      value={viewNameInput}
                      onChange={(event) => setViewNameInput(event.target.value)}
                    />
                    <button type="button" className="secondary-btn" onClick={saveCurrentView}>
                      Save View
                    </button>
                  </div>
                  <div className="view-actions">
                    <button type="button" className="toolbar-btn" onClick={exportCurrentConfig}>
                      Export Config
                    </button>
                    <button
                      type="button"
                      className="toolbar-btn"
                      onClick={() => importConfigInputRef.current?.click()}
                    >
                      Import Config
                    </button>
                    <input
                      ref={importConfigInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden-file-input"
                      onChange={handleImportConfig}
                    />
                  </div>
                  {savedViews.length > 0 ? (
                    <ul className="saved-view-list">
                      {savedViews.map((view) => (
                        <li key={view.id}>
                          <span>{view.name}</span>
                          <div className="saved-view-buttons">
                            <button
                              type="button"
                              className="toolbar-btn"
                              onClick={() => loadSavedView(view.id)}
                            >
                              Load
                            </button>
                            <button
                              type="button"
                              className="toolbar-btn"
                              onClick={() => deleteSavedView(view.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="subtle">No saved views yet.</p>
                  )}
                </div>
              )}
              {isSunburstChart && (
                <p className="subtle">
                  Sunburst focuses on hierarchy + measure and does not use pivot filter/sort fields.
                </p>
              )}
              {dataSourceMode === 'wizard' && (
                <p className="subtle">
                  Guided Builder is designed for non-technical users and maps your choices to chart
                  setup automatically.
                </p>
              )}
              {dataSourceMode === 'pivot' && !isSunburstChart && (
                <p className="subtle">
                  {isPieOrScatter
                    ? 'This chart uses compact pivot setup: Rows + Values + Aggregation, with filter/sort applied.'
                    : 'This chart uses full pivot setup: Rows + Series + Values + Aggregation, with filter/sort applied.'}
                </p>
              )}
              {dataSourceMode === 'pivot' && !isSunburstChart && (
                <p className="subtle">
                  Filtered records: {pivotModel.filteredRowCount.toLocaleString()} /{' '}
                  {rows.length.toLocaleString()}
                </p>
              )}
            </div>
          </article>
        </section>
      )}

      {renderChart && (
        <section className="card chart-card">
          <h2>Interactive Chart</h2>
          {chartType !== 'sunburst' && (
            <div className="pivot-actions">
              <button type="button" className="toolbar-btn" onClick={downloadPivotCsv}>
                Export Pivot CSV
              </button>
            </div>
          )}
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
                {currentSunburstPath.join(' / ')}
              </p>
            </div>
          )}
          <div className="chart-wrap" onMouseMove={handleChartMouseMove}>
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
                  <strong>Path:</strong>{' '}
                  {[...currentSunburstPath, String(sunburstHoverNode.name)].join(' / ')}
                </p>
              </div>
            ) : null}
            {chartType !== 'sunburst' && activeChartModel.chartData.length === 0 ? (
              <div className="empty-state">
                <p>No chart data available for current filters/settings.</p>
                <p>Try clearing filters, changing aggregation, or increasing Top N.</p>
              </div>
            ) : null}
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'bar' ? (
                <BarChart
                  data={activeChartModel.chartData}
                  margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {activeChartModel.seriesKeys.map((col, index) => (
                    <Bar key={col} dataKey={col} fill={COLORS[index % COLORS.length]} />
                  ))}
                </BarChart>
              ) : null}

              {chartType === 'line' ? (
                <LineChart
                  data={activeChartModel.chartData}
                  margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {activeChartModel.seriesKeys.map((col, index) => (
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
                <AreaChart
                  data={activeChartModel.chartData}
                  margin={{ top: 16, right: 20, bottom: 24, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="xLabel" angle={-18} textAnchor="end" interval={0} height={70} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {activeChartModel.seriesKeys.map((col, index) => (
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
                  <XAxis dataKey="xLabel" name={pivotRowColumn} type="category" />
                  <YAxis
                    dataKey={activeChartModel.seriesKeys[0]}
                    name={activeChartModel.seriesKeys[0] ?? 'Value'}
                  />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  <Scatter
                    data={activeChartModel.chartData}
                    fill={COLORS[0]}
                    name={activeChartModel.seriesKeys[0] ?? 'Value'}
                  />
                </ScatterChart>
              ) : null}

              {chartType === 'pie' ? (
                <PieChart>
                  <Tooltip />
                  <Legend />
                  <Pie
                    data={activeChartModel.pieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={140}
                    innerRadius={50}
                    label
                  >
                    {activeChartModel.pieData.map((entry, index) => (
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
                  onMouseEnter={(node) => setSunburstHoverNode(node)}
                  onMouseLeave={() => setSunburstHoverNode(null)}
                />
              ) : null}
            </ResponsiveContainer>
          </div>
          {chartType !== 'sunburst' && activeChartModel.chartData.length > 0 && (
            <div className="pivot-preview">
              <h3>Pivot Data Preview</h3>
              <div className="pivot-preview-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      {activeChartModel.seriesKeys.map((series) => (
                        <th key={`head-${series}`}>{series}</th>
                      ))}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeChartModel.chartData.slice(0, 30).map((entry) => (
                      <tr key={`row-${String(entry.xLabel)}`}>
                        <td>{String(entry.xLabel)}</td>
                        {activeChartModel.seriesKeys.map((series) => (
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
              {activeChartModel.chartData.length > 30 && (
                <p className="subtle">
                  Showing first 30 rows out of {activeChartModel.chartData.length.toLocaleString()}.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card logs-card">
        <div className="logs-header">
          <h2>Activity Logs</h2>
          <div className="logs-actions">
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => setShowLogs((previous) => !previous)}
            >
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
            <button type="button" className="toolbar-btn" onClick={() => setAppLogs([])}>
              Clear Logs
            </button>
          </div>
        </div>
        {showLogs ? (
          appLogs.length > 0 ? (
            <div className="logs-console" role="log" aria-live="polite">
              {appLogs.map((entry) => (
                <p key={entry.id} className={`log-line ${entry.level === 'error' ? 'error' : 'info'}`}>
                  [{entry.timestamp}] [{entry.level.toUpperCase()}] {entry.message}
                </p>
              ))}
            </div>
          ) : (
            <p className="subtle">No log entries yet.</p>
          )
        ) : (
          <p className="subtle">Logs are hidden. Click Show Logs to view app activity.</p>
        )}
      </section>
    </main>
  )
}

export default App
