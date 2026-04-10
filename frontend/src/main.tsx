import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import App from './App'
import { AsyncActionsProvider } from './lib/asyncActions'
import { ToastProvider } from './components/ui'
import { ActiveRunsProvider } from './lib/activeRunsContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <MantineProvider defaultColorScheme="dark">
        <Notifications position="top-right" />
        <ToastProvider>
          <AsyncActionsProvider>
            <ActiveRunsProvider>
              <App />
            </ActiveRunsProvider>
          </AsyncActionsProvider>
        </ToastProvider>
      </MantineProvider>
    </HashRouter>
  </StrictMode>,
)
