import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface ActiveAsyncAction {
  id: number
  label: string
  startedAt: number
}

interface AsyncActionsContextValue {
  actions: ActiveAsyncAction[]
  register: (label: string) => number
  complete: (id: number) => void
}

const AsyncActionsContext = createContext<AsyncActionsContextValue | null>(null)

let nextActionId = 1

export interface AsyncActionsProviderProps {
  children: ReactNode
}

export function AsyncActionsProvider({ children }: AsyncActionsProviderProps) {
  const [actions, setActions] = useState<ActiveAsyncAction[]>([])

  const register = useCallback((label: string) => {
    const id = nextActionId++
    setActions((prev) => [...prev, { id, label, startedAt: Date.now() }])
    return id
  }, [])

  const complete = useCallback((id: number) => {
    setActions((prev) => prev.filter((action) => action.id !== id))
  }, [])

  const value = useMemo<AsyncActionsContextValue>(
    () => ({
      actions,
      register,
      complete,
    }),
    [actions, complete, register],
  )

  return <AsyncActionsContext.Provider value={value}>{children}</AsyncActionsContext.Provider>
}

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


