import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DetailedChartWindow from './components/DetailedChartWindow'

function isDetailedChartPath(pathname: string): boolean {
  return pathname.endsWith('/detail-chart') || pathname === '/detail-chart'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDetailedChartPath(window.location.pathname) ? <DetailedChartWindow /> : <App />}
  </StrictMode>,
)
