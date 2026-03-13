import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building } from '@phosphor-icons/react'
import {
  Badge,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { Button } from '../components/ui'
import { ContentSection } from '../components/layout'
import { RunLogsAndConsole } from '../components/RunLogsAndConsole'
import { fetchProjects, type ProjectSummary, type RunJob } from '../lib/api'
import { useActiveRuns } from '../lib/useActiveRuns'

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

const CONSOLE_LOG_HEIGHT = 560

function Console() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setProjectsLoading(true)
    fetchProjects()
      .then((items) => {
        if (!active) return
        setProjects(items)
      })
      .catch(() => {
        if (!active) return
      })
      .finally(() => {
        if (!active) return
        setProjectsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const {
    activeRuns,
    runsLoading,
    runsError,
    projectLookup,
    requestStopRun,
    sendRunCommandAction,
    commandInputs,
    handleCommandInputChange,
    commandBusy,
    runBusy,
    registerLogRef,
  } = useActiveRuns(projects)

  const loading = projectsLoading || runsLoading

  return (
    <Stack gap="xl" pb="xl">
      <ContentSection as="article" padding="xl">
        <Stack gap="sm">
          <Title order={2}>Console</Title>
          <Text c="dimmed" size="sm">
            Monitor in-progress runs and interact with their consoles.
          </Text>
        </Stack>

        {loading && (
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
        {!loading && !runsError && activeRuns.length === 0 && (
          <Text c="dimmed" size="sm">
            No local servers are running right now. Start a run from the Dashboard or a project
            page.
          </Text>
        )}
        {!loading && !runsError && activeRuns.length > 0 && (
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
                      logHeight={CONSOLE_LOG_HEIGHT}
                    />
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        )}
      </ContentSection>
    </Stack>
  )
}

export default Console
