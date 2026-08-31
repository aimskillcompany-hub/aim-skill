import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { css, mobileCss } from './lib/styles'
import { AuthProvider, RequireAuth, useUser } from './lib/auth'
import { CompanyProvider } from './lib/company'
import { canAccess, firstSection } from './lib/permissions'
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
const Settings = lazyPage(() => import('./pages/Settings'))
const PeriodClose = lazyPage(() => import('./pages/PeriodClose'))
const Tasks = lazyPage(() => import('./pages/Tasks'))

const Loading = () => <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Завантаження…</div>

// Захист розділу за роллю (пряме введення URL). Немає доступу → на перший доступний розділ.
function Gate({ section, children }) {
  const { user } = useUser()
  if (!canAccess(user?.role, section)) return <Navigate to={`/${firstSection(user?.role)}`} replace />
  return children
}
// Стартовий розділ за роллю
function Home() {
  const { user } = useUser()
  return <Navigate to={`/${firstSection(user?.role)}`} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <CompanyProvider>
      <style>{css}{mobileCss}</style>
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="/orders" element={<Gate section="orders"><Orders /></Gate>} />
              <Route path="/orders/:id" element={<Gate section="orders"><OrderCard /></Gate>} />
              <Route path="/contractors" element={<Gate section="contractors"><Contractors /></Gate>} />
              <Route path="/contractors/:id" element={<Gate section="contractors"><ContractorCard /></Gate>} />
              <Route path="/bank" element={<Gate section="bank"><BankCash /></Gate>} />
              <Route path="/inventory" element={<Gate section="inventory"><Warehouse /></Gate>} />
              <Route path="/prices" element={<Gate section="prices"><PriceLists /></Gate>} />
              <Route path="/documents" element={<Gate section="documents"><Documents /></Gate>} />
              <Route path="/mail" element={<Gate section="mail"><Mail /></Gate>} />
              <Route path="/analytics" element={<Gate section="analytics"><Analytics /></Gate>} />
              <Route path="/period-close" element={<Gate section="period-close"><PeriodClose /></Gate>} />
              <Route path="/tasks" element={<Gate section="tasks"><Tasks /></Gate>} />
              <Route path="/settings" element={<Gate section="settings"><Settings /></Gate>} />
              <Route path="*" element={<Home />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
      </CompanyProvider>
    </AuthProvider>
  )
}
