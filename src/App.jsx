import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { css, mobileCss } from './lib/styles'
import { AuthProvider, RequireAuth } from './lib/auth'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'

// Ліниве завантаження з одноразовим перезавантаженням при застарілому чанку після деплою
// (стара index.html посилається на видалені хеші → "Failed to fetch dynamically imported module")
const lazyPage = (factory) => lazy(() =>
  factory()
    .then(m => { sessionStorage.removeItem('chunkReload'); return m })
    .catch(err => {
      if (!sessionStorage.getItem('chunkReload')) {
        sessionStorage.setItem('chunkReload', String(Date.now()))
        window.location.reload()
        return new Promise(() => {}) // не рендерити під час перезавантаження
      }
      throw err
    })
)

// Code-split: кожна сторінка — окремий чанк (важкий pdfmake лишається в чанку Документів)
const Orders = lazyPage(() => import('./pages/Orders'))
const OrderCard = lazyPage(() => import('./pages/OrderCard'))
const Contractors = lazyPage(() => import('./pages/Contractors'))
const ContractorCard = lazyPage(() => import('./pages/ContractorCard'))
const BankCash = lazyPage(() => import('./pages/BankCash'))
const Warehouse = lazyPage(() => import('./pages/Warehouse'))
const PriceLists = lazyPage(() => import('./pages/PriceLists'))
const Documents = lazyPage(() => import('./pages/Documents'))
const Mail = lazyPage(() => import('./pages/Mail'))
const Analytics = lazyPage(() => import('./pages/Analytics'))
const Budget = lazyPage(() => import('./pages/Budget'))
const Settings = lazyPage(() => import('./pages/Settings'))
const PeriodClose = lazyPage(() => import('./pages/PeriodClose'))
const Tasks = lazyPage(() => import('./pages/Tasks'))

const Loading = () => <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Завантаження…</div>

export default function App() {
  return (
    <AuthProvider>
      <style>{css}{mobileCss}</style>
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<Navigate to="/orders" replace />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderCard />} />
              <Route path="/contractors" element={<Contractors />} />
              <Route path="/contractors/:id" element={<ContractorCard />} />
              <Route path="/bank" element={<BankCash />} />
              <Route path="/inventory" element={<Warehouse />} />
              <Route path="/prices" element={<PriceLists />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/mail" element={<Mail />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/period-close" element={<PeriodClose />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/orders" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AuthProvider>
  )
}
