import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, RequireAuth, useUser } from './lib/auth'
import { CompanyProvider } from './lib/company'
import { canAccess, firstSection } from './lib/permissions'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import AppShell, { MorePage } from './components/AppShell'
import Login from './pages/Login'
import { useNewUi } from './lib/uiPrefs'

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
const Portals = lazyPage(() => import('./pages/Portals'))
const BankCash = lazyPage(() => import('./pages/BankCash'))
const Warehouse = lazyPage(() => import('./pages/Warehouse'))
const ProductPage = lazyPage(() => import('./pages/Warehouse').then(m => ({ default: m.ProductPage })))
const ShipmentRecon = lazyPage(() => import('./pages/ShipmentRecon'))
const PriceLists = lazyPage(() => import('./pages/PriceLists'))
const Documents = lazyPage(() => import('./pages/Documents'))
const DocGenRecon = lazyPage(() => import('./pages/DocGenRecon'))
const Analytics = lazyPage(() => import('./pages/Analytics'))
const Investor = lazyPage(() => import('./pages/Investor'))
const FinanceProjects = lazyPage(() => import('./pages/FinanceProjects'))
const Loans = lazyPage(() => import('./pages/Loans'))
const Forecast = lazyPage(() => import('./pages/Forecast'))
const Receivables = lazyPage(() => import('./pages/Receivables'))
const Cashflow = lazyPage(() => import('./pages/Cashflow'))
const AccountantReport = lazyPage(() => import('./pages/AccountantReport'))
const Profitability = lazyPage(() => import('./pages/Profitability'))
const Settings = lazyPage(() => import('./pages/Settings'))
const PeriodClose = lazyPage(() => import('./pages/PeriodClose'))
const Tasks = lazyPage(() => import('./pages/Tasks'))
const UiKit = lazyPage(() => import('./pages/UiKit'))
const Reports = lazyPage(() => import('./pages/Reports'))

const Loading = () => <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Завантаження…</div>

// Захист розділу за роллю (пряме введення URL). Немає доступу → на перший доступний розділ.
function Gate({ section, children }) {
  const { user } = useUser()
  if (!canAccess(user?.role, section)) return <Navigate to={`/${firstSection(user?.role)}`} replace />
  return children
}
// Еталон дизайн-системи: лише адміністратор (у режимі розробки сторінка доступна й без входу — див. маршрути)
function AdminOnly({ children }) {
  const { user } = useUser()
  if (user?.role !== 'admin') return <Navigate to={`/${firstSection(user?.role)}`} replace />
  return children
}
// Прапорець «Новий інтерфейс» → html[data-ui="new"] (див. lib/uiPrefs)
function UiFlag() { useNewUi(); return null }
// Каркас: новий (AppShell) — з прапорцем, інакше старий Layout
function Shell() { return useNewUi() ? <AppShell /> : <Layout /> }

// Старі адреси звітів: у новому інтерфейсі — переадресація на вкладку («закладки не ламаються», ТЗ розділ 3),
// у старому — сторінка як була
function Legacy({ to, children }) {
  return useNewUi() ? <Navigate to={to} replace /> : children
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
      <UiFlag />
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {import.meta.env.DEV && <Route path="/ui-dev" element={<div style={{ padding: "24px 16px 120px", background: "var(--bg)", minHeight: "100vh" }}><UiKit /></div>} />}
            <Route element={<RequireAuth><Shell /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="/orders" element={<Gate section="orders"><Orders /></Gate>} />
              <Route path="/orders/:id" element={<Gate section="orders"><OrderCard /></Gate>} />
              <Route path="/contractors" element={<Gate section="contractors"><Contractors /></Gate>} />
              <Route path="/contractors/:id" element={<Gate section="contractors"><ContractorCard /></Gate>} />
              <Route path="/portals" element={<Gate section="contractors"><Portals /></Gate>} />
              <Route path="/bank" element={<Gate section="bank"><BankCash /></Gate>} />
              <Route path="/inventory" element={<Gate section="inventory"><Warehouse /></Gate>} />
              <Route path="/inventory/product/:id" element={<Gate section="inventory"><ProductPage /></Gate>} />
              <Route path="/inventory/recon" element={<Gate section="inventory"><ShipmentRecon /></Gate>} />
              <Route path="/prices" element={<Gate section="prices"><PriceLists /></Gate>} />
              <Route path="/documents" element={<Gate section="documents"><Documents /></Gate>} />
              <Route path="/documents/gen-recon" element={<Gate section="documents"><DocGenRecon /></Gate>} />
              <Route path="/analytics" element={<Gate section="analytics"><Analytics /></Gate>} />
              <Route path="/investor" element={<Gate section="investor"><Investor /></Gate>} />
              <Route path="/finance" element={<Gate section="finance"><FinanceProjects /></Gate>} />
              <Route path="/loans" element={<Gate section="loans"><Loans /></Gate>} />
              <Route path="/forecast" element={<Gate section="forecast"><Forecast /></Gate>} />
              <Route path="/receivables" element={<Legacy to="/reports?tab=receivables"><Gate section="receivables"><Receivables /></Gate></Legacy>} />
              <Route path="/cashflow" element={<Legacy to="/analytics?tab=cashflow-report"><Gate section="cashflow"><Cashflow /></Gate></Legacy>} />
              <Route path="/accountant" element={<Legacy to="/reports?tab=accountant"><Gate section="accountant"><AccountantReport /></Gate></Legacy>} />
              <Route path="/profitability" element={<Legacy to="/reports?tab=profit"><Gate section="profitability"><Profitability /></Gate></Legacy>} />
              <Route path="/period-close" element={<Gate section="period-close"><PeriodClose /></Gate>} />
              <Route path="/tasks" element={<Gate section="tasks"><Tasks /></Gate>} />
              <Route path="/settings" element={<Gate section="settings"><Settings /></Gate>} />
              <Route path="/ui" element={<AdminOnly><UiKit /></AdminOnly>} />
              <Route path="/more" element={<MorePage />} />
              <Route path="/reports" element={<Gate section="reports"><Reports /></Gate>} />
              <Route path="*" element={<Home />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
      </CompanyProvider>
    </AuthProvider>
  )
}
