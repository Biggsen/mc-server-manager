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
  const [requestActions, setRequestActions] = useState<ActiveAsyncAction[]>([])
  const [backendJobs, setBackendJobs] = useState<Record<string, { label: string; startedAt: number }>>({})

  const register = useCallback((label: string) => {
    const id = nextActionId++
    setRequestActions((prev) => [...prev, { id, label, startedAt: Date.now() }])
    return id
  }, [])

  const complete = useCallback((id: number) => {
    setRequestActions((prev) => prev.filter((action) => action.id !== id))
  }, [])

  const registerBackendJob = useCallback((key: string, label: string) => {
    setBackendJobs((prev) => {
      const next = { ...prev, [key]: { label, startedAt: prev[key]?.startedAt ?? Date.now() } }
      return next
    })
  }, [])

  const completeBackendJob = useCallback((key: string) => {
    setBackendJobs((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const actions = useMemo<ActiveAsyncAction[]>(() => {
    const backendList: ActiveAsyncAction[] = Object.entries(backendJobs).map(([id, { label, startedAt }]) => ({
      id,
      label,
      startedAt,
    }))
    const merged = [...requestActions, ...backendList].sort((a, b) => a.startedAt - b.startedAt)
    return merged
  }, [requestActions, backendJobs])

  const value = useMemo<AsyncActionsContextValue>(
    () => ({
      actions,
      register,
      complete,
      registerBackendJob,
      completeBackendJob,
    }),
    [actions, complete, register, registerBackendJob, completeBackendJob],
  )

  return <AsyncActionsContext.Provider value={value}>{children}</AsyncActionsContext.Provider>
}
