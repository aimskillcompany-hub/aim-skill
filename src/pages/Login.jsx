import { Navigate } from 'react-router-dom'
import Auth from '../components/Auth'
import { useUser, FullScreen } from '../lib/auth'

// Сторінка входу. Якщо вже авторизований — на головну (Замовлення).
export default function Login() {
  const { session, loading } = useUser()
  if (loading) return <FullScreen>Завантаження…</FullScreen>
  if (session) return <Navigate to="/orders" replace />
  return <Auth />
}
