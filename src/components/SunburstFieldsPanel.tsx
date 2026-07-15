type DataSourceMode = 'pivot' | 'query' | 'wizard'

type Props = {
  dataSourceMode: DataSourceMode
  queryColumns: string[]
  selectedColumns: string[]
  pivotValueColumn: string
  onPivotValueColumnChange: (value: string) => void
  sunburstSelectableColumns: string[]
  sunburstHierarchyColumns: string[]
  onToggleSunburstHierarchyColumn: (column: string) => void
}

function SunburstFieldsPanel({
  dataSourceMode,
  queryColumns,
  selectedColumns,
  pivotValueColumn,
  onPivotValueColumnChange,
  sunburstSelectableColumns,
  sunburstHierarchyColumns,
  onToggleSunburstHierarchyColumn,
}: Props) {
  return (
    <div className="sunburst-field-panel">
      <div className="compact-field">
        <label htmlFor="sunburst-value-field">Value Field</label>
        <select
          id="sunburst-value-field"
          value={pivotValueColumn}
          onChange={(event) => {
            onPivotValueColumnChange(event.target.value)
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
        <legend>Hierarchy Fields</legend>
        <div className="sunburst-level-grid">
          {sunburstSelectableColumns.map((column) => (
            <label key={`sunburst-level-${column}`} className="checkbox-item">
              <input
                type="checkbox"
                checked={sunburstHierarchyColumns.includes(column)}
                onChange={() => onToggleSunburstHierarchyColumn(column)}
              />
              {column}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

export default SunburstFieldsPanel
