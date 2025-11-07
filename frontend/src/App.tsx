import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
        </nav>
      </header>

      <main className="app-content" data-route={location.pathname}>
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
