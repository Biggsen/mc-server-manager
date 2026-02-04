import { useEffect, useRef } from 'react'
import { useAsyncActionsRegistry } from '../lib/asyncActionsContext'
import { getApiBase } from '../lib/api'
import { fetchBuilds } from '../lib/api'
import type { RunJob, RunStatus, BuildJob } from '../lib/api'

const BUILD_POLL_MS = 5000
const ACTIVE_RUN_STATUSES: RunStatus[] = ['pending', 'running', 'stopping']

function runLabel(run: RunJob): string {
  switch (run.status) {
    case 'running':
      return `Server running (${run.projectId})`
    case 'pending':
      return 'Starting server…'
    case 'stopping':
      return 'Stopping server…'
    default:
      return `Run (${run.projectId})`
  }
}

function buildLabel(build: BuildJob): string {
  switch (build.status) {
    case 'running':
      return `Building (${build.projectId})`
    case 'pending':
      return 'Build queued…'
    default:
      return `Build (${build.projectId})`
  }
}

export interface ActiveBackendJobsProviderProps {
  children: React.ReactNode
  isAuthenticated: boolean
}

export function ActiveBackendJobsProvider({ children, isAuthenticated }: ActiveBackendJobsProviderProps) {
  const { registerBackendJob, completeBackendJob } = useAsyncActionsRegistry()
  const seenBuildIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return

    const base = getApiBase()
    const urlBase = base.endsWith('/') ? base.slice(0, -1) : base
    const source = new EventSource(`${urlBase}/runs/stream`, { withCredentials: true })

    const handleInit = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { runs: RunJob[] }
        if (!Array.isArray(payload.runs)) return
        payload.runs.forEach((run) => {
          const key = `run:${run.id}`
          if (ACTIVE_RUN_STATUSES.includes(run.status)) {
            registerBackendJob(key, runLabel(run))
          } else {
            completeBackendJob(key)
          }
        })
      } catch {
        // ignore parse errors
      }
    }

    const handleRunUpdate = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { run: RunJob }
        if (!payload.run) return
        const key = `run:${payload.run.id}`
        if (ACTIVE_RUN_STATUSES.includes(payload.run.status)) {
          registerBackendJob(key, runLabel(payload.run))
        } else {
          completeBackendJob(key)
        }
      } catch {
        // ignore parse errors
      }
    }

    source.addEventListener('init', handleInit as EventListener)
    source.addEventListener('run-update', handleRunUpdate as EventListener)
    source.onerror = () => {}

    return () => {
      source.removeEventListener('init', handleInit as EventListener)
      source.removeEventListener('run-update', handleRunUpdate as EventListener)
      source.close()
    }
  }, [isAuthenticated, registerBackendJob, completeBackendJob])

  useEffect(() => {
    if (!isAuthenticated) return

    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      try {
        const builds = await fetchBuilds()
        if (cancelled) return
        const activeIds = new Set<string>()
        builds.forEach((build) => {
          if (build.status === 'running' || build.status === 'pending') {
            const key = `build:${build.id}`
            activeIds.add(build.id)
            registerBackendJob(key, buildLabel(build))
          }
        })
        seenBuildIdsRef.current.forEach((id) => {
          if (!activeIds.has(id)) {
            completeBackendJob(`build:${id}`)
          }
        })
        seenBuildIdsRef.current = activeIds
      } catch {
        // ignore; next poll will retry
      }
    }

    tick()
    const interval = setInterval(tick, BUILD_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isAuthenticated, registerBackendJob, completeBackendJob])

  return <>{children}</>
}
