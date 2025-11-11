import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  MagnifyingGlass,
  Package,
  Plug,
  SquaresFour,
  Toolbox,
  RocketLaunch,
  Buildings,
  Building,
  GithubLogo,
} from '@phosphor-icons/react'
import { fetchAuthStatus, logout, startGitHubLogin, type AuthStatus } from './lib/api'
import Dashboard from './pages/Dashboard'
import ImportProject from './pages/ImportProject'
import NewProject from './pages/NewProject'
import NotFound from './pages/NotFound'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Deployments from './pages/Deployments'
import TestTools from './pages/TestTools'
import PluginLibrary from './pages/PluginLibrary'
import GenerateProfile from './pages/GenerateProfile'
import './App.css'
import './components/ui/styles.css'
import { Button, ToastProvider, ToastViewport } from './components/ui'

const ENVIRONMENT_LABEL = import.meta.env.VITE_ENV_LABEL ?? 'Local'

type NavItem = {
  to: string
  label: string
  icon: JSX.Element
  exact?: boolean
}

type NavSection = {
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      {
        to: '/',
        label: 'Dashboard',
        exact: true,
        icon: <SquaresFour size={18} weight="fill" aria-hidden="true" />,
      },
      {
        to: '/projects',
        label: 'Projects',
        icon: <Buildings size={18} weight="fill" aria-hidden="true" />,
      },
      {
        to: '/plugins',
        label: 'Plugins',
        icon: <Plug size={18} weight="fill" aria-hidden="true" />,
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        to: '/deployments',
        label: 'Deployments',
        icon: <RocketLaunch size={18} weight="fill" aria-hidden="true" />,
      },
      {
        to: '/dev/tools',
        label: 'Dev Tools',
        icon: <Toolbox size={18} weight="fill" aria-hidden="true" />,
      },
    ],
  },
]

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

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

  const currentTitle = useMemo(() => {
    if (location.pathname === '/') {
      return 'Dashboard'
    }
    if (location.pathname.startsWith('/projects/new')) {
      return 'New Project'
    }
    if (location.pathname.startsWith('/projects/import')) {
      return 'Import Project'
    }
    if (location.pathname.startsWith('/projects/')) {
      return 'Project Detail'
    }
    if (location.pathname.startsWith('/plugins')) {
      return 'Plugin Library'
    }
    if (location.pathname.startsWith('/deployments')) {
      return 'Deployments'
    }
    if (location.pathname.startsWith('/dev/tools')) {
      return 'Developer Tools'
    }
    return 'Server Manager'
  }, [location.pathname])

  const initials = useMemo(() => {
    if (!authStatus?.login) return 'MC'
    const [first, second] = authStatus.login.split(/[._-]/)
    if (second) return `${first.at(0) ?? ''}${second.at(0) ?? ''}`.toUpperCase()
    return authStatus.login.slice(0, 2).toUpperCase()
  }, [authStatus?.login])

  const handleSignOut = async () => {
    try {
      setSigningOut(true)
      await logout()
      setAuthStatus((prev) =>
        prev ? { ...prev, authenticated: false, login: null } : prev,
      )
    } catch (error) {
      console.error('Failed to logout', error)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <ToastProvider>
      <div className="app-frame">
        <aside className="app-sidebar">
        <button
          type="button"
          className="brand-button"
          onClick={() => navigate('/')}
          aria-label="Return to dashboard"
        >
          <span className="brand-badge" aria-hidden="true">
            <Package size={28} weight="duotone" />
          </span>
          <div className="brand">
            <h1>MC Server Manager</h1>
            <p className="brand-subtitle">Define • Build • Deploy</p>
          </div>
        </button>

        {NAV_SECTIONS.map((section) => (
          <section key={section.label} className="sidebar-section">
            <p className="sidebar-heading">{section.label}</p>
            <nav className="sidebar-nav" aria-label={section.label}>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.exact}
                  className="sidebar-link"
                >
                  <span className="sidebar-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </section>
        ))}

        <footer className="sidebar-foot">
          <div className="sidebar-env" aria-live="polite">
            <span role="status">●</span>
            {ENVIRONMENT_LABEL} environment
          </div>
        </footer>
      </aside>

        <div className="app-main">
          <header className="app-topbar">
            <div className="topbar-context">
              <small>{ENVIRONMENT_LABEL} mode</small>
              <h2>{currentTitle}</h2>
            </div>

            <label className="topbar-search">
              <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search projects, builds, plugins"
                aria-label="Global search"
              />
            </label>

            <div className="topbar-actions">
              <Button
                variant="ghost"
                icon={<Building size={16} weight="fill" aria-hidden="true" />}
                onClick={() => navigate('/projects/new')}
              >
                New Project
              </Button>
              {authStatus?.authenticated ? (
                <>
                  <span className="avatar" aria-hidden="true">
                    {initials}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="utility-button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                  >
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  className="primary-with-icon"
                  icon={<GithubLogo size={18} weight="fill" aria-hidden="true" />}
                  onClick={() =>
                    startGitHubLogin(`${window.location.origin}${location.pathname}`)
                  }
                >
                  Sign in with GitHub
                </Button>
              )}
            </div>
          </header>

          <main className="app-content" data-route={location.pathname}>
            {authError && <p className="error-text">{authError}</p>}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/new" element={<NewProject />} />
              <Route path="/projects/import" element={<ImportProject />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/projects/:id/profile" element={<GenerateProfile />} />
              <Route path="/plugins" element={<PluginLibrary />} />
              <Route path="/dev/tools" element={<TestTools />} />
              <Route path="/deployments" element={<Deployments />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
        </div>
      </div>
      <ToastViewport />
    </ToastProvider>
  )
}

export default App
