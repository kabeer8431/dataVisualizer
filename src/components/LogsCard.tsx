type AppLogEntry = {
  id: string
  level: 'info' | 'error'
  message: string
  timestamp: string
}

type LogsCardProps = {
  showLogs: boolean
  appLogs: AppLogEntry[]
  onToggleLogs: () => void
  onClearLogs: () => void
}

function LogsCard({ showLogs, appLogs, onToggleLogs, onClearLogs }: LogsCardProps) {
  return (
    <section className="card logs-card">
      <div className="logs-header">
        <h2>Activity Logs</h2>
        <div className="logs-actions">
          <button type="button" className="toolbar-btn" onClick={onToggleLogs}>
            {showLogs ? 'Hide Logs' : 'Show Logs'}
          </button>
          <button type="button" className="toolbar-btn" onClick={onClearLogs}>
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
  )
}

export default LogsCard
