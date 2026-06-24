import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { css, mobileCss } from './lib/styles'
import { AuthProvider, RequireAuth } from './lib/auth'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'

// Code-split: кожна сторінка — окремий чанк (важкий pdfmake лишається в чанку Документів)
const Orders = lazy(() => import('./pages/Orders'))
const OrderCard = lazy(() => import('./pages/OrderCard'))
const Contractors = lazy(() => import('./pages/Contractors'))
const ContractorCard = lazy(() => import('./pages/ContractorCard'))
const BankCash = lazy(() => import('./pages/BankCash'))
const Warehouse = lazy(() => import('./pages/Warehouse'))
const Documents = lazy(() => import('./pages/Documents'))
const Mail = lazy(() => import('./pages/Mail'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Budget = lazy(() => import('./pages/Budget'))
const Settings = lazy(() => import('./pages/Settings'))

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
              <Route path="/documents" element={<Documents />} />
              <Route path="/mail" element={<Mail />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/orders" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AuthProvider>
  )
}
