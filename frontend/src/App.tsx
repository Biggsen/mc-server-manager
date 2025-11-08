import { useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { fetchAuthStatus, logout, startGitHubLogin, type AuthStatus } from './lib/api'
import Dashboard from './pages/Dashboard'
import ImportProject from './pages/ImportProject'
import NewProject from './pages/NewProject'
import NotFound from './pages/NotFound'
import Projects from './pages/Projects'
import TestTools from './pages/TestTools'
import './App.css'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    fetchAuthStatus()
      .then((status) => {
        setAuthStatus(status)
        setAuthError(null)
      })
      .catch((error: Error) => {
        setAuthStatus(null)
        setAuthError(error.message)
      })
  }, [location.pathname])

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="brand brand-button"
          onClick={() => navigate('/')}
        >
          <span className="brand-badge">MC</span>
          <div>
            <h1>Server Manager</h1>
            <p className="muted">Define. Build. Deploy.</p>
          </div>
        </button>
        <nav className="header-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => navigate('/')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => navigate('/projects/new')}
          >
            New Project
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => navigate('/projects/import')}
          >
            Import Repo
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => navigate('/dev/tools')}
          >
            Dev Tools
          </button>
          {authStatus?.authenticated ? (
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                try {
                  await logout()
                  setAuthStatus((prev) =>
                    prev ? { ...prev, authenticated: false, login: null } : prev,
                  )
                } catch (error) {
                  console.error('Failed to logout', error)
                }
              }}
            >
              Sign out {authStatus.login ? `(${authStatus.login})` : ''}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() =>
                startGitHubLogin(`${window.location.origin}${location.pathname}`)
              }
            >
              Sign in with GitHub
            </button>
          )}
        </nav>
      </header>

      <main className="app-content" data-route={location.pathname}>
        {authError && <p className="error-text">{authError}</p>}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/projects/import" element={<ImportProject />} />
          <Route path="/dev/tools" element={<TestTools />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      </div>
  )
}

export default App
