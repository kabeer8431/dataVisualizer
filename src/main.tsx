import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppLazy, DetailedChartWindowLazy } from './lazyRoutes'

function isDetailedChartPath(pathname: string): boolean {
  return pathname.endsWith('/detail-chart') || pathname === '/detail-chart'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main className="app-shell"><section className="card"><p className="subtle">Loading...</p></section></main>}>
      {isDetailedChartPath(window.location.pathname) ? <DetailedChartWindowLazy /> : <AppLazy />}
    </Suspense>
  </StrictMode>,
)
