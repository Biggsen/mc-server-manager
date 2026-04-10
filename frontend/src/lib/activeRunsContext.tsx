import { createContext, useContext, type ReactNode } from 'react'
import { useActiveRuns } from './useActiveRuns'

type ActiveRunsContextValue = ReturnType<typeof useActiveRuns>

const ActiveRunsContext = createContext<ActiveRunsContextValue | null>(null)

export function ActiveRunsProvider({ children }: { children: ReactNode }) {
  const value = useActiveRuns()
  return <ActiveRunsContext.Provider value={value}>{children}</ActiveRunsContext.Provider>
}

export function useActiveRunsContext(): ActiveRunsContextValue {
  const context = useContext(ActiveRunsContext)
  if (!context) {
    throw new Error('useActiveRunsContext must be used within an ActiveRunsProvider')
  }
  return context
}
