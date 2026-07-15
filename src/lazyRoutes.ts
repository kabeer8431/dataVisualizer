import { lazy } from 'react'

export const AppLazy = lazy(() => import('./App.tsx'))
export const DetailedChartWindowLazy = lazy(() => import('./components/DetailedChartWindow'))
