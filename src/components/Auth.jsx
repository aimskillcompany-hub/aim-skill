import { useState } from 'react'
import { supabase } from '../lib/supabase'


export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 24px' }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          padding: '40px 32px',
        }}>
          {/* Logo */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ display:'flex', flexDirection:'column' }}>
              <div style={{ fontFamily:"'Arial Black',sans-serif", fontWeight:900, fontSize:22, lineHeight:1.1, letterSpacing:'-0.5px' }}>
                <span style={{ color:'#000' }}>A</span><span style={{ color:'#16A34A' }}>i</span><span style={{ color:'#000' }}>m</span><br/>
                <span style={{ color:'#000' }}>Sk</span><span style={{ color:'#16A34A' }}>i</span><span style={{ color:'#000' }}>ll.</span>
              </div>
              <div style={{ fontSize:7, color:'var(--text2)', letterSpacing:'0.15em', marginTop:3 }}>ITSOLUTION</div>
            </div>
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#000', marginBottom: 6, letterSpacing: '-.3px' }}>
            Вхід до системи
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text2)', marginBottom: 32 }}>
            Управлінський облік AiM Skills
          </p>

          {error && (
            <div style={{
              background: 'var(--red-bg)',
              border: '1px solid var(--border)',
              color: 'var(--red)',
              padding: '12px 16px',
              borderRadius: 12,
              fontSize: 14,
              marginBottom: 16,
            }}>{error}</div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>EMAIL</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="office@company.com" required style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>ПАРОЛЬ</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="мінімум 6 символів" required minLength={6} style={inputStyle} />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                padding: '14px',
                height: 48,
                background: loading ? '#333' : '#000000',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 15,
                cursor: loading ? 'default' : 'pointer',
                fontFamily: "'Inter', sans-serif",
                opacity: loading ? .6 : 1,
              }}
            >
              {loading ? 'Завантаження...' : 'Увійти'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'var(--text3)' }}>
            Немає акаунту? Зверніться до адміністратора — він створить доступ.
          </p>
        </div>
      </div>
    </div>
  )
}

const labelStyle = {
  fontSize: 12, fontWeight: 600, color: 'var(--text2)', letterSpacing: '.5px',
}

const inputStyle = {
  padding: '12px 14px',
  height: 48,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: '#000',
  fontSize: 16,
  outline: 'none',
  width: '100%',
  fontFamily: "'Inter', sans-serif",
}
