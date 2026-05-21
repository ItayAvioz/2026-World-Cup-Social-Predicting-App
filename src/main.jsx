import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../css/style.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { DataCacheProvider } from './context/DataCacheContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <DataCacheProvider>
          <App />
        </DataCacheProvider>
      </ToastProvider>
    </AuthProvider>
  </StrictMode>
)
