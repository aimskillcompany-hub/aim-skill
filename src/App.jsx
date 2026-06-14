import { useState, useEffect } from 'react'
import BatchUpload from './components/BatchUpload'
import { supabase } from './lib/supabase'
import { css, mobileCss } from './lib/styles'
import Auth from './components/Auth'
import Layout from './components/Layout'
import AddDocument from './components/AddDocument'
import Registry from './components/Registry'
import Projects from './components/Projects'
import Reports from './components/Reports'
import Bank from './components/Bank'
import Cash from './components/Cash'
import TransactionModal from './components/TransactionModal'
import ArticlesSettings from './components/ArticlesSettings'

const CASH_DIR = {
  income: +1, expense: -1, advance: -1,
  advance_return: +1, bank_to_cash: +1, cash_to_bank: -1
}

function Dashboard({ user }) {
  const [stats, setStats] = useState({
    revenue: 0, expenses: 0, net: 0,
    cashBalance: 0, bankFlow: 0,
    projects: 0, docs: 0,
  })
  const [recentTxs, setRecentTxs] = useState([])
  const [selectedTx, setSelectedTx] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('transactions').select('amount, direction'),
      supabase.from('projects').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('documents').select('id', { count: 'exact' }),
      supabase.from('transactions').select('*, projects(name)').order('date', { ascending: false }).limit(8),
      supabase.from('cash_transactions').select('amount, type'),
      supabase.from('bank_transactions').select('amount').eq('is_ignored', false),
    ]).then(([
      { data: txs },
      { count: projCount },
      { count: docCount },
      { data: recent },
      { data: cashTxs },
      { data: bankTxs },
    ]) => {
      const revenue  = (txs || []).filter(t => t.direction === 'Доходи').reduce((s, t) => s + (t.amount || 0), 0)
      const expenses = (txs || []).filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)

      // Залишок каси
      const cashBalance = (cashTxs || []).reduce((s, t) => {
        const dir = CASH_DIR[t.type] || 0
        return s + dir * (t.amount || 0)
      }, 0)

      // Net flow по банківській виписці (сума всіх імпортованих транзакцій)
      const bankFlow = (bankTxs || []).reduce((s, t) => s + (t.amount || 0), 0)

      setStats({
        revenue, expenses, net: revenue - expenses,
        cashBalance, bankFlow,
        projects: projCount || 0,
        docs: docCount || 0,
      })
      setRecentTxs(recent || [])
    })
  }, [])

  const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n)))
  const fmtS = (n, prefix = '') => (n >= 0 ? prefix : '−') + fmt(n) + ' грн'

  return (
    <div>
      <div className="page-header">
        <h1>Дашборд</h1>
        <p>Ласкаво просимо, {user?.email?.split('@')[0]}</p>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">Загальна виручка</div>
          <div className="kpi-value">{fmt(stats.revenue)} <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text3)' }}>грн</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Загальні витрати</div>
          <div className="kpi-value red">{fmt(stats.expenses)} <span style={{ fontSize: 16, fontWeight: 500 }}>грн</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Чистий результат</div>
          <div className={`kpi-value ${stats.net >= 0 ? 'green' : 'red'}`}>
            {stats.net >= 0 ? '+' : '−'}{fmt(stats.net)} <span style={{ fontSize: 16, fontWeight: 500 }}>грн</span>
          </div>
        </div>
      </div>

      {/* Balance cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16, marginBottom: 24 }}>
        <div className="kpi">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: '#F0F0EC',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <i className="ti ti-building-bank" style={{ fontSize: 20, color: 'var(--text2)' }} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>Банківський рахунок</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>за імпортованими виписками</div>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: stats.bankFlow >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {stats.bankFlow >= 0 ? '+' : '−'}{fmt(stats.bankFlow)} <span style={{ fontSize: 14, fontWeight: 500 }}>грн</span>
          </div>
        </div>

        <div className="kpi">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: '#F0F0EC',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <i className="ti ti-cash" style={{ fontSize: 20, color: 'var(--text2)' }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>Залишок каси</div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: stats.cashBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {stats.cashBalance >= 0 ? '+' : '−'}{fmt(stats.cashBalance)} <span style={{ fontSize: 14, fontWeight: 500 }}>грн</span>
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Останні операції</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{stats.projects} активних проєктів · {stats.docs} документів</div>
        </div>
        {recentTxs.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Ще немає операцій.</p>}
        <div className="tbl-wrap" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Контрагент</th>
                <th style={{ textAlign: 'right' }}>Сума</th>
                <th>Напрям</th>
                <th>Проєкт</th>
              </tr>
            </thead>
            <tbody>
              {recentTxs.map(tx => (
                <tr key={tx.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedTx(tx)}>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{tx.date}</td>
                  <td>
                    <div className="trunc">{tx.contractor}</div>
                    {tx.description && (
                      <div style={{ fontSize: 11, color: 'var(--text3)' }} className="trunc">{tx.description}</div>
                    )}
                  </td>
                  <td className={tx.amount >= 0 ? 'amt-pos' : 'amt-neg'} style={{ textAlign: 'right' }}>
                    {tx.amount >= 0 ? '+' : ''}{fmt(Math.abs(tx.amount))}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 12, padding: '4px 10px', borderRadius: 6, fontWeight: 600,
                      background: tx.direction === 'Доходи' ? '#DCFCE7' : tx.direction === 'Витрати' ? '#FFE4E4' : '#F0F0EC',
                      color: tx.direction === 'Доходи' ? '#16A34A' : tx.direction === 'Витрати' ? '#DC2626' : '#6B6B6B',
                    }}>{tx.direction}</span>
                  </td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{tx.projects?.name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selectedTx && <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  )
}

function Settings({ user }) {
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])

  useEffect(() => {
    supabase.from('profiles').select('*').then(({ data }) => setUsers(data || []))
  }, [])

  const updateRole = async (id, role) => {
    await supabase.from('profiles').update({ role }).eq('id', id)
    setUsers(u => u.map(x => x.id === id ? { ...x, role } : x))
  }

  return (
    <div>
      <div className="page-header"><h1>Налаштування</h1></div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {[
          { id: 'users', label: 'Користувачі', icon: 'ti-users' },
          { id: 'articles', label: 'Статті доходів/витрат', icon: 'ti-tags' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="card">
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Email</th><th>Імʼя</th><th>Роль</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.full_name || '—'}</td>
                    <td>
                      <select
                        className="form-input"
                        value={u.role || 'viewer'}
                        onChange={e => updateRole(u.id, e.target.value)}
                        disabled={u.id === user.id}
                        style={{ padding: '4px 8px', fontSize: 12 }}
                      >
                        {['admin', 'accountant', 'manager', 'viewer'].map(r => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'articles' && (
        <div className="card">
          <ArticlesSettings />
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(() => {
    const saved = sessionStorage.getItem('aim-page')
    return saved || 'dashboard'
  })
  const [toast, setToast] = useState(null)

  useEffect(() => { sessionStorage.setItem('aim-page', page) }, [page])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadProfile = async (id) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single()
    setProfile(data)
    setLoading(false)
  }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const user = session ? { ...session.user, ...profile } : null

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>
      Завантаження...
    </div>
  )

  if (!session) return (
    <>
      <style>{css}{mobileCss}</style>
      <Auth />
    </>
  )

  const pages = {
    dashboard: <Dashboard user={user} />,
    add: <AddDocument user={user} onSaved={showToast} />,
    registry: <Registry user={user} />,
    bank: <Bank user={user} />,
    cash: <Cash user={user} />,
    projects: <Projects key={`projects-${page}`} user={user} />,
    reports: <Reports />,
    settings: <Settings user={user} />,
    batch: <BatchUpload user={user} onSaved={showToast} />,
  }

  return (
    <>
      <style>{css}{mobileCss}</style>
      <Layout page={page} onPage={setPage} user={user}>
        {pages[page] || pages.dashboard}
      </Layout>
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </>
  )
}
