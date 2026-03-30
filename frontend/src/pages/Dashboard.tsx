import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building, Plug, SquaresFour, Play, Package as PackageIcon, PencilSimple } from '@phosphor-icons/react'
import {
  ActionIcon,
  Anchor,
  Badge,
  Card,
  Checkbox,
  Code,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { Button, type ButtonProps, Modal } from '../components/ui'
import {
  fetchProjects,
  triggerBuild,
  fetchPluginLibrary,
  runProjectLocally,
  type BuildOptions,
  type ProjectSummary,
  type BuildJob,
  type RunJob,
  type StoredPluginRecord,
} from '../lib/api'
import { useActiveRuns } from '../lib/useActiveRuns'

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
import { RenameProjectModal } from '../components/RenameProjectModal'
import { RunLogsAndConsole } from '../components/RunLogsAndConsole'
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
  const [startingRun, setStartingRun] = useState<Record<string, boolean>>({})
  const [showRunOptions, setShowRunOptions] = useState(false)
  const [selectedProjectForRun, setSelectedProjectForRun] = useState<ProjectSummary | null>(null)
  const [runOptions, setRunOptions] = useState({ resetWorld: false, resetPlugins: false, useSnapshot: false })
  const [showBuildOptions, setShowBuildOptions] = useState(false)
  const [selectedProjectForBuild, setSelectedProjectForBuild] = useState<ProjectSummary | null>(null)
  const [buildOptions, setBuildOptions] = useState<BuildOptions>({ skipPush: true })
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null)

  const {
    activeRuns,
    runsLoading,
    runsError,
    setRunsError,
    projectLookup,
    requestStopRun,
    sendRunCommandAction,
    commandInputs,
    handleCommandInputChange,
    commandBusy,
    runBusy,
    registerLogRef,
    prependRun,
  } = useActiveRuns(projects)

  const { run: queueProjectBuild } = useAsyncAction<
    [ProjectSummary, BuildOptions?],
    BuildJob
  >(
    async (project, options) => triggerBuild(project.id, undefined, options),
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

  const { run: queueRunLocally } = useAsyncAction(
    async ({
      project,
      options,
    }: {
      project: ProjectSummary
      options?: { resetWorld?: boolean; resetPlugins?: boolean; useSnapshot?: boolean }
    }) => {
      const opts = options && (options.resetWorld || options.resetPlugins || options.useSnapshot) ? options : undefined
      return runProjectLocally(project.id, opts)
    },
    {
      label: ({ project }) => `Starting local run • ${project.name}`,
      onStart: ({ project }) => {
        setStartingRun((prev) => ({ ...prev, [project.id]: true }))
      },
      onSuccess: (run) => {
        prependRun(run)
        setShowRunOptions(false)
        setSelectedProjectForRun(null)
        setRunOptions({ resetWorld: false, resetPlugins: false, useSnapshot: false })
      },
      onError: (error) => {
        console.error('Failed to queue local run', error)
        setRunsError(error instanceof Error ? error.message : 'Failed to start local run')
      },
      onFinally: ({ project }) => {
        setStartingRun((prev) => {
          const next = { ...prev }
          delete next[project.id]
          return next
        })
      },
      successToast: (_run, [{ project }]) => ({
        title: 'Run queued',
        description: `${project.name} is starting locally.`,
        variant: 'success',
      }),
      errorToast: (error, [{ project }]) => ({
        title: 'Run failed',
        description:
          error instanceof Error ? error.message : `Failed to start ${project.name} locally`,
        variant: 'danger',
      }),
    },
  )

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

  const recent = projects.slice(0, 3)

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
                const hasActiveRun = activeRuns.some((run) => run.projectId === project.id)
                return (
                  <Paper key={project.id} withBorder radius="md" p="lg">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={4}>
                        <Group gap="xs" align="center" wrap="nowrap">
                          <Title order={4}>
                            <Anchor component={Link} to={`/projects/${project.id}`}>
                              {project.name}
                            </Anchor>
                          </Title>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label={`Rename ${project.name}`}
                            onClick={() => setRenameTarget(project)}
                          >
                            <PencilSimple size={18} weight="bold" aria-hidden="true" />
                          </ActionIcon>
                        </Group>
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
                            setSelectedProjectForBuild(project)
                            setShowBuildOptions(true)
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
                            setSelectedProjectForRun(project)
                            setShowRunOptions(true)
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

                      <RunLogsAndConsole
                        run={run}
                        registerLogRef={registerLogRef}
                        commandValue={commandInputs[run.id] ?? ''}
                        onCommandChange={(value) => handleCommandInputChange(run.id, value)}
                        onSubmit={() => {
                          const command = commandInputs[run.id]?.trim() ?? ''
                          if (command) void sendRunCommandAction(run, command).catch(() => null)
                        }}
                        onSendCommand={(command) => {
                          void sendRunCommandAction(run, command).catch(() => null)
                        }}
                        commandBusy={Boolean(commandBusy[run.id])}
                      />
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

      <RenameProjectModal
        project={renameTarget}
        opened={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
      />

      <Modal
        opened={showRunOptions}
        onClose={() => {
          setShowRunOptions(false)
          setSelectedProjectForRun(null)
          setRunOptions({ resetWorld: false, resetPlugins: false, useSnapshot: false })
        }}
        title="Run Options"
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Select what to reset when starting the run:
          </Text>
          <Checkbox
            label="Reset world data"
            checked={runOptions.resetWorld}
            disabled={runOptions.useSnapshot}
            onChange={(event) => {
              if (event.target.checked) {
                setRunOptions((prev) => ({ ...prev, resetWorld: true, useSnapshot: false }))
              } else {
                setRunOptions((prev) => ({ ...prev, resetWorld: false }))
              }
            }}
            description="Deletes the world directory to start fresh"
          />
          {selectedProjectForRun?.snapshotSourceProjectId && (
            <Checkbox
              label="Use snapshot"
              checked={runOptions.useSnapshot}
              disabled={runOptions.resetWorld}
              onChange={(event) => {
                if (event.target.checked) {
                  setRunOptions((prev) => ({ ...prev, useSnapshot: true, resetWorld: false }))
                } else {
                  setRunOptions((prev) => ({ ...prev, useSnapshot: false }))
                }
              }}
              description={`Copy world from ${projects.find((p) => p.id === selectedProjectForRun.snapshotSourceProjectId)?.name || 'snapshot source'}`}
            />
          )}
          <Checkbox
            label="Reset plugin data"
            checked={runOptions.resetPlugins}
            onChange={(event) =>
              setRunOptions((prev) => ({ ...prev, resetPlugins: event.target.checked }))
            }
            description="Removes plugin data directories (keeps plugin JARs)"
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="ghost"
              onClick={() => {
                setShowRunOptions(false)
                setSelectedProjectForRun(null)
                setRunOptions({ resetWorld: false, resetPlugins: false, useSnapshot: false })
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (selectedProjectForRun) {
                  void queueRunLocally({ project: selectedProjectForRun, options: runOptions }).catch(() => null)
                }
              }}
              disabled={!selectedProjectForRun || startingRun[selectedProjectForRun?.id ?? ''] === true}
            >
              {selectedProjectForRun && startingRun[selectedProjectForRun.id] === true
                ? 'Starting...'
                : 'Start Run'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={showBuildOptions}
        onClose={() => {
          setShowBuildOptions(false)
          setSelectedProjectForBuild(null)
          setBuildOptions({ skipPush: true })
        }}
        title="Build Options"
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Choose how to run the build:
          </Text>
          {selectedProjectForBuild?.repo && (
            <Checkbox
              label="Sync to repository"
              checked={buildOptions.skipPush === false}
              onChange={(event) =>
                setBuildOptions((prev) => ({ ...prev, skipPush: !event.target.checked }))
              }
              description="Push build artifact and manifest to GitHub after a successful build. Leave unchecked for local-only builds (e.g. rate limits or offline)."
            />
          )}
          <Group justify="flex-end" gap="sm">
            <Button
              variant="ghost"
              onClick={() => {
                setShowBuildOptions(false)
                setSelectedProjectForBuild(null)
                setBuildOptions({ skipPush: true })
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (selectedProjectForBuild) {
                  setShowBuildOptions(false)
                  setSelectedProjectForBuild(null)
                  setBuildOptions({ skipPush: true })
                  void queueProjectBuild(selectedProjectForBuild, buildOptions).catch(() => null)
                }
              }}
              disabled={
                !selectedProjectForBuild ||
                building[selectedProjectForBuild?.id ?? ''] === 'running'
              }
            >
              {selectedProjectForBuild &&
              building[selectedProjectForBuild.id] === 'running'
                ? 'Starting...'
                : 'Start build'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

export default Dashboard

