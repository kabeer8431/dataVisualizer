type Props = {
  querySql: string
  onQuerySqlChange: (value: string) => void
  onRunQuery: () => void
  onLoadExampleQuery: () => void
  queryNotice: string
  sqlError: string
  sqliteReady: boolean
}

function QueryPanel({
  querySql,
  onQuerySqlChange,
  onRunQuery,
  onLoadExampleQuery,
  queryNotice,
  sqlError,
  sqliteReady,
}: Props) {
  return (
    <div className="query-panel">
      <label htmlFor="query-sql">SQL (table: uploaded_data)</label>
      <textarea
        id="query-sql"
        value={querySql}
        onChange={(event) => onQuerySqlChange(event.target.value)}
        rows={8}
        spellCheck={false}
      />
      <div className="query-panel-actions">
        <button type="button" className="submit-btn" onClick={onRunQuery}>
          Run Query and Visualize
        </button>
        <button type="button" className="secondary-btn" onClick={onLoadExampleQuery}>
          Load Example Query
        </button>
      </div>
      {queryNotice ? <p className="notice">{queryNotice}</p> : null}
      {sqlError ? <p className="error">{sqlError}</p> : null}
      {!sqliteReady ? (
        <p className="subtle">SQLite is still loading. Query mode will activate soon.</p>
      ) : null}
    </div>
  )
}

export default QueryPanel
