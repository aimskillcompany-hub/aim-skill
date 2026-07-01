import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'

// Застарілі чанки після нового деплою → перезавантажити один раз
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('chunkReload')) {
    sessionStorage.setItem('chunkReload', String(Date.now()))
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
