import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink as RouterNavLink, Route, Routes, useLocation } from 'react-router-dom'
import {
  Package,
  PencilSimpleLine,
  Plug,
  SquaresFour,
  Toolbox,
  RocketLaunch,
  Buildings,
  GithubLogo,
  PaintBrush,
} from '@phosphor-icons/react'
import {
  Badge,
  Box,
  Divider,
  Group,
  NavLink as MantineNavLink,
  Stack,
  Text,
  Title,
  Avatar,
} from '@mantine/core'
import { fetchAuthStatus, logout, startGitHubLogin, type AuthStatus } from './lib/api'
import { logger } from './lib/logger'
import Dashboard from './pages/Dashboard'
import ImportProject from './pages/ImportProject'
import NewProject from './pages/NewProject'
import NotFound from './pages/NotFound'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Deployments from './pages/Deployments'
import TestTools from './pages/TestTools'
import PluginLibrary from './pages/PluginLibrary'
import LiveEditor from './pages/LiveEditor'
import AddPlugin from './pages/AddPlugin'
import GenerateProfile from './pages/GenerateProfile'
import Styleguide from './pages/Styleguide'
import { ActiveActionIndicator, Button, ToastProvider, ToastViewport } from './components/ui'
import { AppShell, MainCanvas } from './components/layout'
import { ActiveBackendJobsProvider } from './components/ActiveBackendJobsProvider'
import { AsyncActionsProvider } from './lib/asyncActions'

type NavItem = {
  to: string
  label: string
  icon: ReactNode
  exact?: boolean
  devOnly?: boolean
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
        to: '/live-editor',
        label: 'Live Editor',
        icon: <PencilSimpleLine size={18} weight="fill" aria-hidden="true" />,
      },
      {
        to: '/deployments',
        label: 'Deployments',
        icon: <RocketLaunch size={18} weight="fill" aria-hidden="true" />,
      },
      {
        to: '/dev/tools',
        label: 'Dev Tools',
        icon: <Toolbox size={18} weight="fill" aria-hidden="true" />,
        devOnly: true,
      },
      {
        to: '/styleguide',
        label: 'Style Guide',
        icon: <PaintBrush size={18} weight="fill" aria-hidden="true" />,
        devOnly: true,
      },
    ],
  },
]

function App() {
  const location = useLocation()
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [isDev, setIsDev] = useState<boolean | null>(null)

  // Check app mode (dev vs production) on mount
  useEffect(() => {
    const checkAppMode = async () => {
      const isElectron = window.electronAPI?.isElectron || window.location.protocol === 'file:';
      
      if (isElectron && window.electronAPI?.getAppMode) {
        try {
          const mode = await window.electronAPI.getAppMode();
          setIsDev(mode.isDev);
        } catch (error) {
          logger.error('app-mode-check-failed', {
            reason: 'Failed to check app mode',
          }, error instanceof Error ? error.message : String(error));
          setIsDev(false);
        }
      } else {
        setIsDev(import.meta.env.DEV);
      }
    };
    
    checkAppMode();
  }, []);

  // Check auth status on mount and route changes
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

  // Periodic session validation (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      logger.debug('session-validation-periodic', {
        interval: '30s',
      });

      fetchAuthStatus()
        .then((status) => {
          logger.debug('session-validation-result', {
            authenticated: status.authenticated,
            login: status.login,
          });

          if (!status.authenticated && authStatus?.authenticated) {
            // Session was valid but now invalid - session expired
            logger.warn('session-expired', {
              previousLogin: authStatus.login,
            }, 'Session expired - user needs to re-authenticate');
            setAuthStatus(status);
            setAuthError('Your session has expired. Please sign in again.');
          } else {
            // Update status (might have changed)
            setAuthStatus(status);
            if (status.authenticated) {
              setAuthError(null);
            }
          }
        })
        .catch((error: Error) => {
          logger.error('session-validation-failed', {
            reason: 'Failed to validate session',
          }, error.message);
          // Don't clear auth status on network errors - might be temporary
          // Only clear if we get a 401 or similar
          if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            setAuthStatus((prev) => prev ? { ...prev, authenticated: false, login: null } : null);
            setAuthError('Session validation failed. Please sign in again.');
          }
        });
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [authStatus])

  // Listen for OAuth completion and errors in Electron
  useEffect(() => {
    const isElectron = window.electronAPI?.isElectron || window.location.protocol === 'file:';
    
    if (isElectron && window.electronAPI?.onAuthComplete) {
      logger.info('oauth-listener-registered', {
        isElectron: true,
      });

      // Set up IPC listener for auth completion
      window.electronAPI.onAuthComplete((status) => {
        logger.info('oauth-complete-received', {
          source: 'IPC',
          login: status?.login,
        });

        // Check auth status after OAuth completes
        fetchAuthStatus()
          .then((authStatus) => {
            logger.info('auth-status-after-oauth', {
              authenticated: authStatus.authenticated,
              login: authStatus.login,
            });
            setAuthStatus(authStatus);
            setAuthError(null);
          })
          .catch((error: Error) => {
            logger.error('auth-status-check-failed', {
              reason: 'Failed to check auth status after OAuth',
            }, error.message);
            setAuthStatus(null);
            setAuthError(error.message);
          });
      });

      // Set up IPC listener for OAuth errors
      if (window.electronAPI.onAuthError) {
        window.electronAPI.onAuthError((error: { error: string }) => {
          logger.error('oauth-error-received', {
            source: 'IPC',
            error: error.error,
          }, error.error);
          setAuthError(error.error);
          // Don't clear auth status - might still be valid
        });
      }
    }
  }, [])

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
    if (location.pathname.startsWith('/plugins/add')) {
      return 'Add Plugin'
    }
    if (location.pathname.startsWith('/plugins')) {
      return 'Plugin Library'
    }
    if (location.pathname.startsWith('/live-editor')) {
      return 'Live Editor'
    }
    if (location.pathname.startsWith('/deployments')) {
      return 'Deployments'
    }
    if (location.pathname.startsWith('/dev/tools')) {
      return 'Developer Tools'
    }
    if (location.pathname.startsWith('/styleguide')) {
      return 'Style Guide'
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

  const isActivePath = (item: NavItem): boolean => {
    if (item.exact) {
      return location.pathname === item.to
    }
    return location.pathname.startsWith(item.to)
  }

  const environmentLabel = useMemo(() => {
    if (isDev === null) {
      return import.meta.env.VITE_ENV_LABEL ?? 'Local'
    }
    return isDev ? 'Development' : 'Production'
  }, [isDev])

  const filteredNavSections = useMemo(() => {
    if (isDev === null) {
      return NAV_SECTIONS
    }
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.devOnly || isDev),
    }))
  }, [isDev])

  const sidebar = (
    <Stack gap="xl" miw={0}>
      <Stack gap={2}>
        <Title order={4}>{currentTitle}</Title>
        <Text size="xs" c="dimmed">
          Define • Build • Deploy
        </Text>
      </Stack>

      {filteredNavSections.map((section) => (
        <Box key={section.label}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb="xs">
            {section.label}
          </Text>
          <Stack gap={4}>
            {section.items.map((item) => (
              <MantineNavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                label={item.label}
                leftSection={item.icon}
                variant="light"
                active={isActivePath(item)}
              />
            ))}
          </Stack>
        </Box>
      ))}

      <Divider />

      <Box>
        <Badge color={isDev ? "yellow" : "green"} variant="light">
          {environmentLabel}
        </Badge>
        <Text size="xs" c="dimmed" mt={4}>
          Environment
        </Text>
      </Box>
    </Stack>
  )

  const topbar = (
    <Group justify="space-between" align="center" gap="xl" wrap="nowrap" w="100%">
      <Group gap="md" align="center">
        <Package size={28} weight="duotone" />
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            {environmentLabel} mode
          </Text>
          <Title order={2}>MC Server Manager</Title>
        </Stack>
      </Group>

      <Group gap="md" wrap="nowrap">
        <ActiveActionIndicator />
        {authStatus?.authenticated ? (
          <Group gap="sm" wrap="nowrap">
            <Avatar radius="xl" color="blue">
              {initials}
            </Avatar>
            <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </Group>
        ) : (
          <Button
            variant="primary"
            icon={<GithubLogo size={18} weight="fill" aria-hidden="true" />}
            onClick={() => startGitHubLogin(`${window.location.origin}${location.pathname}`)}
          >
            Sign in with GitHub
          </Button>
        )}
      </Group>
    </Group>
  )

  return (
    <AsyncActionsProvider>
      <ActiveBackendJobsProvider isAuthenticated={authStatus?.authenticated ?? false}>
        <ToastProvider>
          <AppShell sidebar={sidebar} topbar={topbar} isDev={isDev}>
            <MainCanvas data-route={location.pathname}>
              {authError && <p className="error-text">{authError}</p>}
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/new" element={<NewProject />} />
                <Route path="/projects/import" element={<ImportProject />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/projects/:id/profile" element={<GenerateProfile />} />
                <Route path="/plugins" element={<PluginLibrary />} />
                <Route path="/live-editor" element={<LiveEditor />} />
                <Route path="/plugins/add" element={<AddPlugin />} />
                {isDev && <Route path="/dev/tools" element={<TestTools />} />}
                <Route path="/deployments" element={<Deployments />} />
                {isDev && <Route path="/styleguide" element={<Styleguide />} />}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </MainCanvas>
          </AppShell>
          <ToastViewport />
        </ToastProvider>
      </ActiveBackendJobsProvider>
    </AsyncActionsProvider>
  )
}

export default App
