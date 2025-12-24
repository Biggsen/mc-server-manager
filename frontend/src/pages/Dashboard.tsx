import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building, Plug, SquaresFour, Play, Package as PackageIcon } from '@phosphor-icons/react'
import {
  Accordion,
  Anchor,
  Badge,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { Button, type ButtonProps } from '../components/ui'
import {
  fetchProjects,
  triggerBuild,
  fetchPluginLibrary,
  fetchRuns,
  stopRunJob,
  runProjectLocally,
  sendRunCommand,
  type ProjectSummary,
  type BuildJob,
  type RunJob,
  type StoredPluginRecord,
} from '../lib/api'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

const sourceLabel: Record<'download' | 'upload', string> = {
  download: 'Download URL',
  upload: 'Uploaded jar',
}

const runStatusLabel: Record<
  RunJob['status'],
  'Pending' | 'Running' | 'Stopping' | 'Stopped' | 'Completed' | 'Failed'
> = {
  pending: 'Pending',
  running: 'Running',
  stopping: 'Stopping',
  stopped: 'Stopped',
  succeeded: 'Completed',
  failed: 'Failed',
}

function getPluginSourceKind(plugin: StoredPluginRecord): 'download' | 'upload' {
  return plugin.source?.uploadPath ? 'upload' : 'download'
}
import { subscribeProjectsUpdated } from '../lib/events'
import { ContentSection } from '../components/layout'
import { useAsyncAction } from '../lib/useAsyncAction'

function Dashboard() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState<Record<string, BuildJob['status']>>({})
  const [library, setLibrary] = useState<StoredPluginRecord[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunJob[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState<Record<string, boolean>>({})
  const [startingRun, setStartingRun] = useState<Record<string, boolean>>({})
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({})
  const [commandBusy, setCommandBusy] = useState<Record<string, boolean>>({})
  const logRefs = useRef<Record<string, HTMLPreElement | null>>({})

  const { run: queueProjectBuild } = useAsyncAction(
    async (project: ProjectSummary) => triggerBuild(project.id),
    {
      label: (project) => `Triggering build • ${project.name}`,
      onStart: (project) => {
        setBuilding((prev) => ({ ...prev, [project.id]: 'running' }))
      },
      onSuccess: (build, [project]) => {
        setBuilding((prev) => ({ ...prev, [project.id]: build.status }))
      },
      onError: (error, [project]) => {
        console.error('Failed to queue build', error)
        setBuilding((prev) => ({ ...prev, [project.id]: 'failed' }))
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

  const { run: requestRunProject } = useAsyncAction(
    async (project: ProjectSummary) => runProjectLocally(project.id),
    {
      label: (project) => `Starting local run • ${project.name}`,
      onStart: (project) => {
        setStartingRun((prev) => ({ ...prev, [project.id]: true }))
      },
      onSuccess: (run) => {
        setRuns((prev) => {
          const remaining = prev.filter((existing) => existing.id !== run.id)
          return [run, ...remaining]
        })
        setRunsError(null)
      },
      onError: (error) => {
        console.error('Failed to queue local run', error)
        setRunsError(error instanceof Error ? error.message : 'Failed to start local run')
      },
      onFinally: (project) => {
        setStartingRun((prev) => {
          const next = { ...prev }
          delete next[project.id]
          return next
        })
      },
      successToast: (_run, [project]) => ({
        title: 'Run queued',
        description: `${project.name} is starting locally.`,
        variant: 'success',
      }),
      errorToast: (error, [project]) => ({
        title: 'Run failed',
        description:
          error instanceof Error ? error.message : `Failed to start ${project.name} locally`,
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
        element.scrollTop = element.scrollHeight
      }
    })
  }, [runs])

  useEffect(() => {
    let active = true

    const load = () => {
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

    load()
    const unsubscribe = subscribeProjectsUpdated(load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadLibrary = () => {
      setLibraryLoading(true)
      fetchPluginLibrary()
        .then((items) => {
          if (!active) return
          setLibrary(items)
          setLibraryError(null)
        })
        .catch((err: Error) => {
          if (!active) return
          setLibraryError(err.message)
        })
        .finally(() => {
          if (!active) return
          setLibraryLoading(false)
        })
    }

    loadLibrary()
    return () => {
      active = false
    }
  }, [])

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

  const recent = projects.slice(0, 3)
  const projectLookup = useMemo(
    () =>
      projects.reduce<Record<string, ProjectSummary>>((acc, project) => {
        acc[project.id] = project
        return acc
      }, {}),
    [projects],
  )
  const activeRuns = runs.filter((run) =>
    ['pending', 'running', 'stopping'].includes(run.status),
  )

  type QuickAction = {
    label: string
    action: () => void
    icon: ReactNode
    variant?: ButtonProps['variant']
  }

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        label: 'New Project',
        action: () => navigate('/projects/new'),
        variant: 'primary',
        icon: <Building size={18} weight="fill" aria-hidden="true" />,
      },
      {
        label: 'Open Plugin Library',
        action: () => navigate('/plugins'),
        icon: <Plug size={18} weight="fill" aria-hidden="true" />,
        variant: 'pill',
      },
    ],
    [navigate],
  )

  const latestManifest = useMemo(() => {
    const timestamps = projects
      .map((project) => project.manifest?.generatedAt)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => !Number.isNaN(value))
    if (timestamps.length === 0) return null
    const latest = Math.max(...timestamps)
    return new Date(latest)
  }, [projects])

  const latestManifestLabel = useMemo(() => {
    if (!latestManifest) return 'No manifests generated yet'
    return `Updated ${latestManifest.toLocaleString()}`
  }, [latestManifest])

  return (
    <Stack gap="xl" pb="xl">
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
        <ContentSection as="section" padding="xl">
          <Stack gap="lg">
            <Stack gap="xs">
              <Title order={2}>Mission control</Title>
              <Text c="dimmed">
                Track your Paper servers, watch active runs, and keep plugins aligned across every
                environment.
              </Text>
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
              <Card withBorder radius="md" padding="xl">
                <Stack gap={6}>
                  <Text fw={700} fz={32}>
                    {projects.length}
                  </Text>
                  <Text c="dimmed" fz="sm">
                    Projects
                  </Text>
                </Stack>
              </Card>
              <Card withBorder radius="md" padding="xl">
                <Stack gap={6}>
                  <Text fw={700} fz={32}>
                    {activeRuns.length}
                  </Text>
                  <Text c="dimmed" fz="sm">
                    Active runs
                  </Text>
                </Stack>
              </Card>
              <Card withBorder radius="md" padding="xl">
                <Stack gap={6}>
                  <Text fw={700} fz={32}>
                    {library.length}
                  </Text>
                  <Text c="dimmed" fz="sm">
                    Saved plugins
                  </Text>
                </Stack>
              </Card>
              <Card withBorder radius="md" padding="xl">
                <Stack gap={6}>
                  <Text fw={700} fz={32}>
                    {latestManifest ? latestManifest.toLocaleTimeString() : '—'}
                  </Text>
                  <Text c="dimmed" fz="sm">
                    {latestManifestLabel}
                  </Text>
                </Stack>
              </Card>
            </SimpleGrid>

            <Group gap="sm">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant={action.variant}
                  icon={action.icon}
                  onClick={action.action}
                >
                  {action.label}
                </Button>
              ))}
            </Group>
          </Stack>
        </ContentSection>

        <ContentSection as="article" padding="xl">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Title order={3}>Recent Projects</Title>
              <Text c="dimmed" size="sm">
                Latest activity across your managed Paper servers
              </Text>
            </Stack>
            <Button
              variant="ghost"
              size="sm"
              icon={<SquaresFour size={16} weight="fill" aria-hidden="true" />}
              onClick={() => navigate('/projects')}
            >
              View all projects
            </Button>
          </Group>

          <Divider my="lg" />

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
          {!loading && !error && recent.length === 0 && (
            <Text c="dimmed" size="sm">
              No projects yet. Create your first Paper server to get started.
            </Text>
          )}
          {!loading && !error && recent.length > 0 && (
            <Stack gap="lg">
              {recent.map((project) => {
                const hasActiveRun = runs.some(
                  (run) =>
                    run.projectId === project.id &&
                    ['pending', 'running', 'stopping'].includes(run.status),
                )
                return (
                  <Paper key={project.id} withBorder radius="md" p="lg">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={4}>
                        <Title order={4}>
                          <Anchor component={Link} to={`/projects/${project.id}`}>
                            {project.name}
                          </Anchor>
                        </Title>
                        <Text c="dimmed" size="sm">
                          {[
                            project.minecraftVersion,
                            project.loader.toUpperCase(),
                            project.repo?.fullName ?? null,
                            project.source === 'imported' ? 'Imported' : null,
                            project.manifest
                              ? `Built ${new Date(project.manifest.generatedAt).toLocaleTimeString()}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </Stack>

                      <Group gap="sm">
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<PackageIcon size={18} weight="fill" aria-hidden="true" />}
                          disabled={building[project.id] === 'running'}
                          onClick={() => {
                            void queueProjectBuild(project).catch(() => null)
                          }}
                        >
                          {building[project.id] === 'running' ? 'Building…' : 'Build'}
                        </Button>
                        <Button
                          variant="pill"
                          size="sm"
                          icon={<Play size={18} weight="fill" aria-hidden="true" />}
                          disabled={startingRun[project.id] === true || hasActiveRun}
                          onClick={() => {
                            void requestRunProject(project).catch(() => null)
                          }}
                        >
                          {startingRun[project.id] === true ? 'Starting…' : 'Run locally'}
                        </Button>
                      </Group>
                    </Group>
                  </Paper>
                )
              })}
            </Stack>
          )}
        </ContentSection>
      </SimpleGrid>

      <ContentSection as="article" padding="xl">
          <Stack gap="sm">
            <Title order={3}>Active Local Servers</Title>
            <Text c="dimmed" size="sm">
              Monitor in-progress runs and interact with their consoles.
            </Text>
          </Stack>

          <Divider my="lg" />

          {runsLoading && (
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Checking active runs…
              </Text>
            </Group>
          )}
          {runsError && (
            <Text c="red.4" size="sm">
              {runsError}
            </Text>
          )}
          {!runsLoading && !runsError && activeRuns.length === 0 && (
            <Text c="dimmed" size="sm">
              No local servers are running right now.
            </Text>
          )}
          {!runsLoading && !runsError && activeRuns.length > 0 && (
            <Stack gap="lg">
              {activeRuns.map((run) => {
                const project = projectLookup[run.projectId]
                const runLabel = project ? project.name : run.projectId
                const status = runStatusLabel[run.status]
                return (
                  <Paper key={run.id} withBorder radius="md" p="lg">
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={4}>
                          <Group gap="xs">
                            <Title order={4}>{runLabel}</Title>
                            <Badge variant="light">{status}</Badge>
                          </Group>
                          <Text c="dimmed" size="sm">
                            Started {new Date(run.createdAt).toLocaleString()}
                            {run.port && ` • Port ${run.port}`}
                            {project?.minecraftVersion && ` • ${project.minecraftVersion}`}
                          </Text>
                          {run.containerName && (
                            <Text c="dimmed" size="sm">
                              Container: {run.containerName}
                            </Text>
                          )}
                          {project?.repo?.fullName && (
                            <Text c="dimmed" size="sm">
                              Repo: {project.repo.fullName}
                            </Text>
                          )}
                        </Stack>

                        <Group gap="sm">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Building size={16} weight="fill" aria-hidden="true" />}
                            onClick={() => navigate(`/projects/${run.projectId}`)}
                          >
                            View project
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={run.status === 'stopping' || runBusy[run.id]}
                            onClick={() => {
                              void requestStopRun(run).catch(() => null)
                            }}
                          >
                            {run.status === 'stopping' || runBusy[run.id] ? 'Stopping…' : 'Stop'}
                          </Button>
                        </Group>
                      </Group>

                      <Accordion defaultValue={run.logs.length > 0 ? run.id : undefined}>
                        <Accordion.Item value={run.id}>
                          <Accordion.Control>View logs</Accordion.Control>
                          <Accordion.Panel>
                            <ScrollArea h={200} type="auto">
                              <Code
                                block
                                component="pre"
                                ref={(element: HTMLPreElement | null) => {
                                  logRefs.current[run.id] = element
                                }}
                              >
                                {run.logs.length > 0
                                  ? run.logs
                                      .map(
                                        (entry) =>
                                          `[${new Date(entry.timestamp).toLocaleTimeString()}][${
                                            entry.stream
                                          }] ${entry.message}`,
                                      )
                                      .join('\n')
                                  : 'No log entries yet.'}
                              </Code>
                            </ScrollArea>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>

                      {run.status === 'running' ? (
                        run.consoleAvailable ? (
                          <Group
                            component="form"
                            align="flex-end"
                            onSubmit={(event) => {
                              event.preventDefault()
                              const command = commandInputs[run.id]?.trim() ?? ''
                              if (!command) return
                              void sendRunCommandAction(run, command).catch(() => null)
                            }}
                          >
                            <TextInput
                              label="Console command"
                              placeholder="/say Hello"
                              value={commandInputs[run.id] ?? ''}
                              onChange={(event) =>
                                handleCommandInputChange(run.id, event.currentTarget.value)
                              }
                              disabled={Boolean(commandBusy[run.id])}
                              flex={1}
                            />
                            <Button
                              type="submit"
                              disabled={
                                Boolean(commandBusy[run.id]) ||
                                !commandInputs[run.id] ||
                                commandInputs[run.id]?.trim().length === 0
                              }
                            >
                              {commandBusy[run.id] ? 'Sending…' : 'Send'}
                            </Button>
                          </Group>
                        ) : (
                          <Text c="dimmed" size="sm">
                            Console not available yet.
                          </Text>
                        )
                      ) : null}
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          )}
        </ContentSection>
      <Stack gap="xl">
        <ContentSection as="article" padding="xl">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Title order={3}>Saved Plugins</Title>
              <Text c="dimmed" size="sm">
                Plugins captured from builds and uploads.
              </Text>
            </Stack>
            <Button
              variant="ghost"
              size="sm"
              icon={<Plug size={16} weight="fill" aria-hidden="true" />}
              onClick={() => navigate('/plugins')}
            >
              Browse library
            </Button>
          </Group>

          <Divider my="lg" />

          {libraryLoading && (
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Loading plugins…
              </Text>
            </Group>
          )}
          {libraryError && (
            <Text c="red.4" size="sm">
              {libraryError}
            </Text>
          )}
          {!libraryLoading && !libraryError && library.length === 0 && (
            <Text c="dimmed" size="sm">
              No saved plugins yet. Add one from a project to populate the library.
            </Text>
          )}
          {!libraryLoading && !libraryError && library.length > 0 && (
            <Stack gap="sm">
              {library.slice(0, 5).map((plugin) => (
                <Paper key={`${plugin.id}:${plugin.version}`} withBorder radius="md" p="md">
                  <Stack gap={4}>
                    <Group gap="sm">
                      <Text fw={600}>{plugin.id}</Text>
                      <Badge variant="light">{sourceLabel[getPluginSourceKind(plugin)]}</Badge>
                      <Badge variant="outline">v{plugin.version}</Badge>
                    </Group>
                    {plugin.cachePath && (
                      <Text c="dimmed" size="sm">
                        Cache path: <Code>{plugin.cachePath}</Code>
                      </Text>
                    )}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </ContentSection>

        <ContentSection as="article" padding="xl">
          <Stack gap="sm">
            <Title order={3}>Resources</Title>
            <Divider />
            <Stack gap="xs">
              <Text size="sm">Plugin registry overview</Text>
              <Text size="sm">Overlay configuration guide</Text>
              <Text size="sm">Deterministic build checklist</Text>
            </Stack>
          </Stack>
        </ContentSection>
      </Stack>
    </Stack>
  )
}

export default Dashboard

