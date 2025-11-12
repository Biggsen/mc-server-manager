import { createContext, useContext } from 'react'

export interface ActiveAsyncAction {
  id: number
  label: string
  startedAt: number
}

export interface AsyncActionsContextValue {
  actions: ActiveAsyncAction[]
  register: (label: string) => number
  complete: (id: number) => void
}

export const AsyncActionsContext = createContext<AsyncActionsContextValue | null>(null)

export function useAsyncActionsRegistry(): AsyncActionsContextValue {
  const context = useContext(AsyncActionsContext)
  if (!context) {
    throw new Error('useAsyncActionsRegistry must be used within an AsyncActionsProvider')
  }
  return context
}

export function useActiveAsyncActions(): ActiveAsyncAction[] {
  return useAsyncActionsRegistry().actions
}

