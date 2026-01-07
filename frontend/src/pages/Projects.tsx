import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Buildings, Play, FileText, MagnifyingGlass, Package as PackageIcon } from '@phosphor-icons/react'
import {
  fetchProjects,
  triggerBuild,
  triggerManifest,
  scanProjectAssets,
  fetchBuilds,
  runProjectLocally,
  fetchRuns,
  type ProjectSummary,
  type BuildJob,
  type RunJob,
} from '../lib/api'
import { subscribeProjectsUpdated } from '../lib/events'
import { ContentSection } from '../components/layout'
import { useAsyncAction } from '../lib/useAsyncAction'
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

function countPluginConfigs(configs: NonNullable<ProjectSummary['configs']>): number {
  return configs.filter(
    (config) =>
      config.pluginId !== undefined ||
      config.definitionId !== undefined ||
      config.path.startsWith('plugins/'),
  ).length
}

function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState<Record<string, BuildJob['status']>>({})
  const [builds, setBuilds] = useState<Record<string, BuildJob | undefined>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Record<string, ProjectMessage | undefined>>({})

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

  const setProjectBusy = (projectId: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [projectId]: value }))
  }

  const { run: queueProjectBuild } = useAsyncAction(
    async (project: ProjectSummary) => triggerBuild(project.id),
    {
      label: (project) => `Triggering build • ${project.name}`,
      onStart: (project) => {
        setProjectBusy(project.id, true)
        setBuilding((prev) => ({ ...prev, [project.id]: 'running' }))
      },
      onSuccess: (build, [project]) => {
        setBuilding((prev) => ({ ...prev, [project.id]: build.status }))
        setProjectMessage(project.id, {
          type: 'success',
          text: `Triggered build ${build.id}`,
        })
      },
      onError: (error, [project]) => {
        console.error('Failed to queue build', error)
        setBuilding((prev) => ({ ...prev, [project.id]: 'failed' }))
        setProjectMessage(project.id, {
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to queue build',
        })
      },
      onFinally: (project) => {
        setProjectBusy(project.id, false)
      },
      successToast: (build, [project]) => ({
        title: 'Build queued',
        description: `Build ${build.id} queued for ${project.name}`,
        variant: 'success',
      }),
      errorToast: (error, [project]) => ({
        title: 'Build failed',
        description: error instanceof Error ? error.message : `Build failed for ${project.name}`,
        variant: 'danger',
      }),
    },
  )

  const { run: generateProjectManifest } = useAsyncAction(
    async (project: ProjectSummary) => triggerManifest(project.id),
    {
      label: (project) => `Generating manifest • ${project.name}`,
      onStart: (project) => {
        setProjectBusy(project.id, true)
      },
      onSuccess: (manifest, [project]) => {
        setProjectMessage(project.id, {
          type: 'success',
          text: `Manifest ${manifest.manifest?.lastBuildId ?? 'generated'}`,
        })
      },
      onError: (error, [project]) => {
        console.error('Failed to generate manifest', error)
        setProjectMessage(project.id, {
          type: 'error',
          text: error instanceof Error ? error.message : 'Manifest generation failed',
        })
      },
      onFinally: (project) => {
        setProjectBusy(project.id, false)
      },
      successToast: (_manifest, [project]) => ({
        title: 'Manifest generated',
        description: `Latest manifest ready for ${project.name}`,
        variant: 'success',
      }),
      errorToast: (error, [project]) => ({
        title: 'Manifest generation failed',
        description:
          error instanceof Error ? error.message : `Could not generate manifest for ${project.name}`,
        variant: 'danger',
      }),
    },
  )

  const { run: scanProjectAssetsAction } = useAsyncAction(
    async (project: ProjectSummary) => scanProjectAssets(project.id),
    {
      label: (project) => `Scanning assets • ${project.name}`,
      onStart: (project) => {
        setProjectBusy(project.id, true)
      },
      onSuccess: (assets, [project]) => {
        setProjectMessage(project.id, {
          type: 'success',
          text: `Scanned ${assets.plugins.length} plugins, ${countPluginConfigs(assets.configs)} plugin configs`,
        })
      },
      onError: (error, [project]) => {
        console.error('Failed to scan assets', error)
        setProjectMessage(project.id, {
          type: 'error',
          text: error instanceof Error ? error.message : 'Asset scan failed',
        })
      },
      onFinally: (project) => {
        setProjectBusy(project.id, false)
      },
      successToast: (assets, [project]) => ({
        title: 'Assets scanned',
        description: `${project.name}: ${assets.plugins.length} plugins, ${countPluginConfigs(assets.configs)} plugin configs`,
        variant: 'success',
      }),
      errorToast: (error, [project]) => ({
        title: 'Asset scan failed',
        description:
          error instanceof Error ? error.message : `Failed to scan assets for ${project.name}`,
        variant: 'danger',
      }),
    },
  )

  const { run: runProjectLocallyAction } = useAsyncAction(
    async (project: ProjectSummary) => runProjectLocally(project.id),
    {
      label: (project) => `Starting local run • ${project.name}`,
      onStart: (project) => {
        setProjectBusy(project.id, true)
      },
      onSuccess: (run, [project]) => {
        setProjectMessage(project.id, projectMessageForRun(run))
      },
      onError: (error, [project]) => {
        console.error('Failed to queue local run', error)
        setProjectMessage(project.id, {
          type: 'error',
          text: error instanceof Error ? error.message : 'Run locally failed',
        })
      },
      onFinally: (project) => {
        setProjectBusy(project.id, false)
      },
      successToast: (run, [project]) => ({
        title: 'Run queued',
        description: `${project.name}: ${describeRunStatus(run)}`,
        variant: 'success',
      }),
      errorToast: (error, [project]) => ({
        title: 'Run failed',
        description: error instanceof Error ? error.message : `Failed to run ${project.name} locally`,
        variant: 'danger',
      }),
    },
  )

  useEffect(() => {
    let cancelled = false
    fetchRuns()
      .then((runs) => {
        if (cancelled) return
        const latestByProject = runs.reduce<Record<string, RunJob>>((acc, run) => {
          acc[run.projectId] = preferRun(acc[run.projectId], run)
          return acc
        }, {})
        setMessages((prev) => {
          const next = { ...prev }
          Object.entries(latestByProject).forEach(([projectId, run]) => {
            next[projectId] = projectMessageForRun(run)
          })
          return next
        })
      })
      .catch((err: Error) => {
        console.error('Failed to load run status', err)
      })
    return () => {
      cancelled = true
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
          const nextMessages: Record<string, ProjectMessage> = {}
          latestRunsRef.forEach((storedRun, projectId) => {
            if (isActiveRun(storedRun) || storedRun.status === 'failed') {
              nextMessages[projectId] = projectMessageForRun(storedRun)
            }
          })
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
              const repoUrl = project.repo?.htmlUrl
              const repoLabel = project.repo?.fullName ?? project.repo?.name
              const commitSha = project.manifest?.commitSha
              const buildStatus = latestBuild?.status ?? building[project.id] ?? 'idle'
              const message = messages[project.id]

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
                        {repoUrl && repoLabel && (
                          <Text size="sm" c="dimmed">
                            Repo:{' '}
                            <Anchor href={repoUrl} target="_blank" rel="noreferrer">
                              {repoLabel}
                            </Anchor>
                          </Text>
                        )}
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
                        {project.manifest && (
                          <Text size="sm" c="dimmed">
                            Manifest: {project.manifest.lastBuildId}{' '}
                            {commitSha && repoUrl ? (
                              <Anchor
                                href={`${repoUrl.replace(/\.git$/, '')}/commit/${commitSha}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                ({commitSha.slice(0, 7)})
                              </Anchor>
                            ) : null}
                          </Text>
                        )}
                      </Stack>

                      <Group gap="sm" wrap="wrap">
                        <Button
                          variant="ghost"
                          icon={<MagnifyingGlass size={18} weight="bold" aria-hidden="true" />}
                          disabled={busy[project.id]}
                          onClick={() => {
                            void scanProjectAssetsAction(project).catch(() => null)
                          }}
                        >
                          Scan assets
                        </Button>
                        <Button
                          variant="ghost"
                          icon={<FileText size={18} weight="fill" aria-hidden="true" />}
                          disabled={busy[project.id]}
                          onClick={() => {
                            void generateProjectManifest(project).catch(() => null)
                          }}
                        >
                          Generate manifest
                        </Button>
                        <Button
                          variant="primary"
                          icon={<PackageIcon size={18} weight="fill" aria-hidden="true" />}
                          disabled={busy[project.id] || buildStatus === 'running'}
                          onClick={() => {
                            void queueProjectBuild(project).catch(() => null)
                          }}
                        >
                          {buildStatus === 'running' ? 'Building…' : 'Build'}
                        </Button>
                        <Button
                          variant="pill"
                          icon={<Play size={18} weight="fill" aria-hidden="true" />}
                          disabled={busy[project.id]}
                          onClick={() => {
                            void runProjectLocallyAction(project).catch(() => null)
                          }}
                        >
                          Run locally
                        </Button>
                      </Group>

                      {message && (
                        <Text size="sm" c={message.type === 'error' ? 'red.4' : 'green.5'}>
                          {message.text}
                        </Text>
                      )}
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
