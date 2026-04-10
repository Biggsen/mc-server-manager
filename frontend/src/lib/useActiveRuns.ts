import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchRuns,
  getApiBase,
  stopRunJob,
  sendRunCommand,
  type RunJob,
} from './api'
import { useAsyncAction } from './useAsyncAction'

export function useActiveRuns() {
  const [runs, setRuns] = useState<RunJob[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState<Record<string, boolean>>({})
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({})
  const [commandBusy, setCommandBusy] = useState<Record<string, boolean>>({})
  const logRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const { run: requestStopRun } = useAsyncAction(
    async (run: RunJob) => stopRunJob(run.id),
    {
      label: (run) => `Stopping run • ${run.id}`,
      onStart: (run) => {
        setRunBusy((prev) => ({ ...prev, [run.id]: true }))
      },
      onSuccess: (updated) => {
        setRuns((prev) =>
          prev.map((run) => (run.id === updated.id ? { ...run, ...updated } : run)),
        )
        setRunsError(null)
      },
      onError: (error) => {
        console.error('Failed to stop run', error)
        setRunsError(error instanceof Error ? error.message : 'Failed to stop run')
      },
      onFinally: (run) => {
        setRunBusy((prev) => {
          const next = { ...prev }
          delete next[run.id]
          return next
        })
      },
      successToast: (_result, [run]) => ({
        title: 'Stopping run',
        description: `Stop requested for ${run.id}.`,
        variant: 'warning',
      }),
      errorToast: (error, [run]) => ({
        title: 'Failed to stop run',
        description: error instanceof Error ? error.message : `Failed to stop ${run.id}`,
        variant: 'danger',
      }),
    },
  )

  const { run: sendRunCommandAction } = useAsyncAction(
    async (run: RunJob, command: string) => sendRunCommand(run.id, command),
    {
      label: (run) => `Sending command • ${run.id}`,
      onStart: (run) => {
        setCommandBusy((prev) => ({ ...prev, [run.id]: true }))
      },
      onSuccess: (_result, [run]) => {
        setCommandInputs((prev) => ({ ...prev, [run.id]: '' }))
      },
      onError: (error) => {
        console.error('Failed to send run command', error)
        setRunsError(error instanceof Error ? error.message : 'Failed to send command')
      },
      onFinally: (run) => {
        setCommandBusy((prev) => {
          const next = { ...prev }
          delete next[run.id]
          return next
        })
      },
      successToast: (_result, [run]) => ({
        title: 'Command sent',
        description: `Command dispatched to ${run.projectId}.`,
        variant: 'success',
      }),
      errorToast: (error, [run]) => ({
        title: 'Command failed',
        description: error instanceof Error ? error.message : `Failed to send command to ${run.id}`,
        variant: 'danger',
      }),
    },
  )

  const handleCommandInputChange = useCallback((runId: string, value: string) => {
    setCommandInputs((prev) => ({ ...prev, [runId]: value }))
  }, [])

  useEffect(() => {
    runs.forEach((run) => {
      const element = logRefs.current[run.id]
      if (element) {
        let scrollableParent: HTMLElement | null = element.parentElement
        while (scrollableParent) {
          const style = window.getComputedStyle(scrollableParent)
          if (
            scrollableParent.scrollHeight > scrollableParent.clientHeight &&
            (style.overflow === 'auto' ||
              style.overflow === 'scroll' ||
              style.overflowY === 'auto' ||
              style.overflowY === 'scroll')
          ) {
            scrollableParent.scrollTop = scrollableParent.scrollHeight
            break
          }
          scrollableParent = scrollableParent.parentElement
        }
      }
    })
  }, [runs])

  useEffect(() => {
    let active = true
    setRunsLoading(true)
    fetchRuns()
      .then((items) => {
        if (!active) return
        setRuns(items)
        setRunsError(null)
      })
      .catch((err: Error) => {
        if (!active) return
        setRunsError(err.message)
      })
      .finally(() => {
        if (!active) return
        setRunsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const API_BASE = getApiBase()
    const base =
      API_BASE.startsWith('http://') || API_BASE.startsWith('https://')
        ? API_BASE
        : `${window.location.origin}${API_BASE}`
    const urlBase = base.endsWith('/') ? base.slice(0, -1) : base
    const source = new EventSource(`${urlBase}/runs/stream`, { withCredentials: true })

    const handleInit = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { runs: RunJob[] }
        if (Array.isArray(payload.runs)) {
          setRuns(
            payload.runs.map((run) => ({
              ...run,
              logs: Array.isArray(run.logs) ? run.logs : [],
            })),
          )
          setRunsLoading(false)
          setRunsError(null)
        }
      } catch (err) {
        console.error('Failed to parse run stream init payload', err)
      }
    }

    const handleRunUpdate = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { run: RunJob }
        if (!payload.run) {
          return
        }
        setRuns((prev) => {
          const normalized: RunJob = {
            ...payload.run,
            logs: Array.isArray(payload.run.logs) ? payload.run.logs : [],
          }
          const index = prev.findIndex((item) => item.id === normalized.id)
          if (index === -1) {
            return [normalized, ...prev]
          }
          const existing = prev[index]
          const existingLogs = Array.isArray(existing.logs) ? existing.logs : []
          const normalizedLogs = Array.isArray(normalized.logs) ? normalized.logs : []
          const logs =
            normalizedLogs.length >= existingLogs.length ? normalizedLogs : existingLogs
          const merged: RunJob = {
            ...existing,
            ...normalized,
            logs,
          }
          const next = prev.slice()
          next[index] = merged
          return next
        })
      } catch (err) {
        console.error('Failed to parse run update payload', err)
      }
    }

    const handleRunLog = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          runId: string
          projectId: string
          entry: RunJob['logs'][number]
        }
        if (!payload.runId || !payload.entry) {
          return
        }
        setRuns((prev) =>
          prev.map((run) => {
            if (run.id !== payload.runId) {
              return run
            }
            const logs = Array.isArray(run.logs) ? run.logs.slice() : []
            logs.push(payload.entry)
            return {
              ...run,
              logs,
            }
          }),
        )
      } catch (err) {
        console.error('Failed to parse run log payload', err)
      }
    }

    source.addEventListener('init', handleInit as EventListener)
    source.addEventListener('run-update', handleRunUpdate as EventListener)
    source.addEventListener('run-log', handleRunLog as EventListener)
    source.onerror = (event) => {
      console.error('Run stream error', event)
    }

    return () => {
      source.removeEventListener('init', handleInit as EventListener)
      source.removeEventListener('run-update', handleRunUpdate as EventListener)
      source.removeEventListener('run-log', handleRunLog as EventListener)
      source.close()
    }
  }, [])

  const activeRuns = useMemo(
    () => runs.filter((run) => ['pending', 'running', 'stopping'].includes(run.status)),
    [runs],
  )

  const registerLogRef = useCallback((id: string, el: HTMLDivElement | null) => {
    logRefs.current[id] = el
  }, [])

  const prependRun = useCallback((run: RunJob) => {
    setRuns((prev) => {
      const remaining = prev.filter((existing) => existing.id !== run.id)
      return [{ ...run, logs: Array.isArray(run.logs) ? run.logs : [] }, ...remaining]
    })
    setRunsError(null)
  }, [])

  return {
    runs,
    activeRuns,
    runsLoading,
    runsError,
    setRunsError,
    requestStopRun,
    sendRunCommandAction,
    commandInputs,
    handleCommandInputChange,
    commandBusy,
    runBusy,
    registerLogRef,
    prependRun,
  }
}
