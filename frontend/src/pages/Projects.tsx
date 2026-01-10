import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Buildings, Stop } from '@phosphor-icons/react'
import {
  fetchProjects,
  fetchBuilds,
  fetchRuns,
  stopRunJob,
  type ProjectSummary,
  type BuildJob,
  type RunJob,
} from '../lib/api'
import { subscribeProjectsUpdated } from '../lib/events'
import { ContentSection } from '../components/layout'
import { Anchor, Group, Loader, Stack, Text, Title } from '@mantine/core'
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui'

type ProjectMessage = { type: 'success' | 'error'; text: string }

import { getApiBase } from '../lib/api'
const API_BASE = getApiBase()

const ACTIVE_STATUSES = new Set<RunJob['status']>(['pending', 'running', 'stopping'])

function isActiveRun(run: RunJob | undefined): boolean {
  return !!run && ACTIVE_STATUSES.has(run.status)
}

function preferRun(current: RunJob | undefined, candidate: RunJob): RunJob {
  if (!current) {
    return candidate
  }
  if (isActiveRun(candidate)) {
    return candidate
  }
  if (isActiveRun(current)) {
    return current
  }
  return candidate.createdAt > current.createdAt ? candidate : current
}

function describeRunStatus(run: RunJob): string {
  const portInfo = run.port ? ` on port ${run.port}` : ''
  switch (run.status) {
    case 'pending':
      return 'Local server starting…'
    case 'running':
      return `Local server started${portInfo}`
    case 'stopping':
      return 'Stopping local server…'
    case 'stopped':
      return 'Local server stopped'
    case 'succeeded':
      return 'Local server exited normally'
    case 'failed':
      return `Local server failed${run.error ? ` — ${run.error}` : ''}`
    default:
      return `Local server ${run.status}`
  }
}

function projectMessageForRun(run: RunJob): ProjectMessage {
  return {
    type: run.status === 'failed' ? 'error' : 'success',
    text: describeRunStatus(run),
  }
}

function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState<Record<string, BuildJob['status']>>({})
  const [builds, setBuilds] = useState<Record<string, BuildJob | undefined>>({})
  const [messages, setMessages] = useState<Record<string, ProjectMessage | undefined>>({})
  const [runs, setRuns] = useState<Record<string, RunJob | undefined>>({})
  const [stopping, setStopping] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let active = true

    const loadProjects = () => {
      setLoading(true)
      fetchProjects()
        .then((items) => {
          if (!active) return
          setProjects(items)
          setError(null)
        })
        .catch((err: Error) => {
          if (!active) return
          setError(err.message)
        })
        .finally(() => {
          if (!active) return
          setLoading(false)
        })
    }

    loadProjects()
    const unsubscribe = subscribeProjectsUpdated(loadProjects)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadBuilds = () => {
      fetchBuilds()
        .then((items) => {
          if (cancelled) return
          const latest: Record<string, BuildJob> = {}
          for (const build of items) {
            const existing = latest[build.projectId]
            if (!existing || existing.createdAt < build.createdAt) {
              latest[build.projectId] = build
            }
          }
          setBuilds(latest)
        })
        .catch((err: Error) => {
          console.error('Failed to load build history', err)
        })
    }

    loadBuilds()
    const interval = window.setInterval(loadBuilds, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    setBuilding((prev) => {
      const next = { ...prev }
      Object.entries(builds).forEach(([projectId, build]) => {
        if (build && build.status !== 'running') {
          next[projectId] = build.status
        }
      })
      return next
    })
  }, [builds])

  const setProjectMessage = (projectId: string, message?: ProjectMessage) => {
    setMessages((prev) => ({ ...prev, [projectId]: message }))
  }

  useEffect(() => {
    let cancelled = false
    const loadRuns = () => {
      fetchRuns()
        .then((runsList) => {
          if (cancelled) return
          const latestByProject = runsList.reduce<Record<string, RunJob>>((acc, run) => {
            acc[run.projectId] = preferRun(acc[run.projectId], run)
            return acc
          }, {})
          setRuns(latestByProject)
          setMessages((prev) => {
            const next = { ...prev }
            Object.entries(latestByProject).forEach(([projectId, run]) => {
              if (isActiveRun(run) || run.status === 'failed') {
                next[projectId] = projectMessageForRun(run)
              }
            })
            return next
          })
        })
        .catch((err: Error) => {
          console.error('Failed to load run status', err)
        })
    }
    loadRuns()
    const interval = window.setInterval(loadRuns, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const base =
      API_BASE.startsWith('http://') || API_BASE.startsWith('https://')
        ? API_BASE
        : `${window.location.origin}${API_BASE}`
    const urlBase = base.endsWith('/') ? base.slice(0, -1) : base
    const source = new EventSource(`${urlBase}/runs/stream`, { withCredentials: true })

    const latestRunsRef = new Map<string, RunJob>()

    const updateMessage = (run: RunJob) => {
      const preferred = preferRun(latestRunsRef.get(run.projectId), run)
      latestRunsRef.set(run.projectId, preferred)

      if (isActiveRun(preferred) || preferred.status === 'failed') {
        setMessages((prev) => ({
          ...prev,
          [run.projectId]: projectMessageForRun(preferred),
        }))
      } else if (preferred.status === 'stopped' || preferred.status === 'succeeded') {
        setMessages((prev) => {
          const next = { ...prev }
          delete next[run.projectId]
          return next
        })
      } else {
        setMessages((prev) => ({
          ...prev,
          [run.projectId]: projectMessageForRun(preferred),
        }))
      }
    }

    const handleInit = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { runs: RunJob[] }
        if (Array.isArray(payload.runs)) {
          payload.runs.forEach((run) => {
            const preferred = preferRun(latestRunsRef.get(run.projectId), run)
            latestRunsRef.set(run.projectId, preferred)
          })
          const nextRuns: Record<string, RunJob> = {}
          const nextMessages: Record<string, ProjectMessage> = {}
          latestRunsRef.forEach((storedRun, projectId) => {
            nextRuns[projectId] = storedRun
            if (isActiveRun(storedRun) || storedRun.status === 'failed') {
              nextMessages[projectId] = projectMessageForRun(storedRun)
            }
          })
          setRuns((prev) => ({ ...prev, ...nextRuns }))
          setMessages((prev) => ({ ...prev, ...nextMessages }))
        }
      } catch (err) {
        console.error('Failed to parse run stream init payload', err)
      }
    }

    const handleRunUpdate = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { run: RunJob }
        if (payload.run) {
          updateMessage(payload.run)
          setRuns((prev) => {
            const current = prev[payload.run.projectId]
            const preferred = preferRun(current, payload.run)
            return { ...prev, [payload.run.projectId]: preferred }
          })
        }
      } catch (err) {
        console.error('Failed to parse run update payload', err)
      }
    }

    source.addEventListener('init', handleInit as EventListener)
    source.addEventListener('run-update', handleRunUpdate as EventListener)
    source.onerror = (event) => {
      console.error('Run stream error', event)
    }

    return () => {
      source.removeEventListener('init', handleInit as EventListener)
      source.removeEventListener('run-update', handleRunUpdate as EventListener)
      source.close()
    }
  }, [])

  return (
    <ContentSection as="section" padding="xl">
      <Stack gap="lg">
        <Group gap="sm">
          <Buildings size={24} weight="fill" aria-hidden="true" />
          <Stack gap={2}>
            <Title order={2}>All Projects</Title>
            <Text c="dimmed" size="sm">
              Projects synced with your GitHub account will appear here.
            </Text>
          </Stack>
        </Group>

        {loading && (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading projects…
            </Text>
          </Group>
        )}
        {error && (
          <Text c="red.4" size="sm">
            {error}
          </Text>
        )}
        {!loading && !error && projects.length === 0 && (
          <Card>
            <CardContent>
              <Text c="dimmed" size="sm">
                Nothing to show yet. Trigger your first build and we’ll track it here.
              </Text>
            </CardContent>
          </Card>
        )}
        {!loading && !error && projects.length > 0 && (
          <Stack gap="lg">
            {projects.map((project) => {
              const latestBuild = builds[project.id]
              const pluginCount = project.plugins?.length ?? 0
              const pluginList = project.plugins
                ?.map(p => p.id)
                .sort((a, b) => a.localeCompare(b))
                .join(', ') ?? ''
              const currentRun = runs[project.id]
              const hasActiveRun = currentRun && isActiveRun(currentRun)
              const isStopping = stopping[project.id] ?? false

              const handleStop = async () => {
                if (!currentRun || isStopping) return
                setStopping((prev) => ({ ...prev, [project.id]: true }))
                try {
                  const stoppedRun = await stopRunJob(currentRun.id)
                  setRuns((prev) => ({ ...prev, [project.id]: stoppedRun }))
                } catch (error) {
                  console.error('Failed to stop run', error)
                } finally {
                  setStopping((prev) => ({ ...prev, [project.id]: false }))
                }
              }

              return (
                <Card key={project.id}>
                  <CardHeader>
                    <CardTitle>
                      <Anchor component={Link} to={`/projects/${project.id}`}>
                        {project.name}
                      </Anchor>
                    </CardTitle>
                    <CardDescription>
                      {[
                        project.minecraftVersion,
                        project.loader.toUpperCase(),
                        project.source === 'imported' ? 'Imported' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Stack gap="md">
                      <Stack gap={4}>
                        <Text size="sm" c="dimmed">
                          {latestBuild
                            ? `Build status: ${latestBuild.status.toUpperCase()}${
                                latestBuild.finishedAt
                                  ? ` · ${new Date(
                                      latestBuild.finishedAt ?? latestBuild.createdAt,
                                    ).toLocaleTimeString()}`
                                  : ''
                              }${latestBuild.error ? ` — ${latestBuild.error}` : ''}`
                            : 'Build status: IDLE'}
                        </Text>
                        {pluginCount > 0 ? (
                          <Text size="sm" c="dimmed" style={{ wordBreak: 'break-word' }}>
                            Plugins ({pluginCount}):{' '}
                            <span style={{ color: 'white' }}>
                              {pluginList}
                            </span>
                          </Text>
                        ) : (
                          <Text size="sm" c="dimmed">
                            Plugins (0)
                          </Text>
                        )}
                        {currentRun && (
                          <Group gap="sm" align="center">
                            <Text size="sm" c={currentRun.status === 'running' ? 'green.5' : currentRun.status === 'failed' ? 'red.4' : 'dimmed'}>
                              {describeRunStatus(currentRun)}
                            </Text>
                            {hasActiveRun && (
                              <Button
                                variant="danger"
                                size="xs"
                                icon={<Stop size={16} weight="fill" aria-hidden="true" />}
                                onClick={handleStop}
                                disabled={isStopping}
                              >
                                {isStopping ? 'Stopping...' : 'Stop'}
                              </Button>
                            )}
                          </Group>
                        )}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              )
            })}
          </Stack>
        )}
      </Stack>
    </ContentSection>
  )
}

export default Projects
