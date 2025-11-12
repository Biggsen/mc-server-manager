import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  AsyncActionsContext,
  type ActiveAsyncAction,
  type AsyncActionsContextValue,
} from './asyncActionsContext'

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
