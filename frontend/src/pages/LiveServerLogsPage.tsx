import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowsClockwise,
  CheckCircle,
  CloudArrowDown,
  Eye,
  Stack as StackIcon,
  Trash,
  Warning,
} from '@phosphor-icons/react'
import {
  Alert,
  Badge,
  Group,
  Loader,
  Progress,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { Button, useToast } from '../components/ui'
import { ContentSection } from '../components/layout'
import {
  deleteServerLogImport,
  fetchIngestJob,
  fetchLiveServerFilesConfig,
  fetchServerLogFiles,
  getIngestJobStreamUrl,
  ingestAllServerLogs,
  ingestServerLog,
  type IngestJob,
  type ServerLogFileEntry,
  type ServerLogLatestEntry,
} from '../lib/api'
import { useAsyncAction } from '../lib/useAsyncAction'
import OverviewTab from './logs/OverviewTab'
import PlayerTab from './logs/PlayerTab'
import LiveTab from './logs/LiveTab'

export type LiveServerLogsPageProps = {
  serverId: string
  displayName: string
  serverPath: string
}

const ALL_TABS = ['files', 'overview', 'player', 'live'] as const
type TabValue = (typeof ALL_TABS)[number]

function isTabValue(value: string | null): value is TabValue {
  return value !== null && (ALL_TABS as readonly string[]).includes(value)
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export default function LiveServerLogsPage({
  serverId,
  displayName,
  serverPath,
}: LiveServerLogsPageProps) {
  const navigate = useNavigate()
  const { toast: showToast } = useToast()
  const envPrefix = serverId.toUpperCase()
  const profileIconPath = `server_icons/${serverId}-profile.png`

  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabValue>(
    isTabValue(initialTab) ? initialTab : 'files',
  )

  const [sshOk, setSshOk] = useState(true)
  const [filesConfigured, setFilesConfigured] = useState(false)
  const [filesHint, setFilesHint] = useState<string | undefined>()
  const [configLoading, setConfigLoading] = useState(true)

  const [files, setFiles] = useState<ServerLogFileEntry[]>([])
  const [latest, setLatest] = useState<ServerLogLatestEntry | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [job, setJob] = useState<IngestJob | null>(null)
  const jobEsRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false
    setConfigLoading(true)
    fetchLiveServerFilesConfig(serverId)
      .then((c) => {
        if (cancelled) return
        setSshOk(true)
        setFilesConfigured(c.filesConfigured)
        setFilesHint(c.hint)
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        if (/503|not configured/i.test(msg)) {
          setSshOk(false)
        } else {
          showToast({
            title: 'Failed to load file settings',
            description: msg,
            variant: 'danger',
          })
        }
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serverId, showToast])

  const loadFiles = useCallback(async () => {
    if (!sshOk || !filesConfigured) return
    setFilesLoading(true)
    setFilesError(null)
    try {
      const { files: list, latest: l } = await fetchServerLogFiles(serverId)
      setFiles(list)
      setLatest(l)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setFilesError(msg)
      showToast({
        title: 'Failed to list logs',
        description: msg,
        variant: 'danger',
      })
    } finally {
      setFilesLoading(false)
    }
  }, [sshOk, filesConfigured, serverId, showToast])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const handleTabChange = useCallback(
    (next: string | null) => {
      const value = isTabValue(next) ? next : 'files'
      setActiveTab(value)
      const sp = new URLSearchParams(searchParams)
      if (value === 'files') {
        sp.delete('tab')
      } else {
        sp.set('tab', value)
      }
      setSearchParams(sp, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const handlePickPlayer = useCallback(
    (player: string) => {
      const sp = new URLSearchParams(searchParams)
      sp.set('tab', 'player')
      sp.set('player', player)
      setActiveTab('player')
      setSearchParams(sp, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const { run: runIngest } = useAsyncAction(
    async (file: string) => {
      setBusyFile(file)
      try {
        return await ingestServerLog(serverId, file)
      } finally {
        setBusyFile(null)
      }
    },
    {
      label: (file) => `Ingesting ${file}…`,
      successToast: (result) => ({
        title: 'Imported',
        description: `${result.fileName}: ${result.eventCount} EXPMETRIC events parsed in ${(result.durationMs / 1000).toFixed(1)}s.`,
        variant: 'success',
      }),
      errorToast: (err, args) => ({
        title: `Failed to ingest ${args[0]}`,
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      }),
      onSuccess: () => {
        void loadFiles()
      },
    },
  )

  const subscribeJob = useCallback(
    (jobId: string) => {
      if (jobEsRef.current) {
        jobEsRef.current.close()
        jobEsRef.current = null
      }
      const url = getIngestJobStreamUrl(serverId, jobId)
      const es = new EventSource(url)
      jobEsRef.current = es

      const handleProgress = (data: IngestJob) => {
        setJob(data)
        if (data.status === 'completed' || data.status === 'failed') {
          es.close()
          jobEsRef.current = null
          void loadFiles()
          if (data.status === 'completed') {
            const events = data.files.reduce((sum, f) => sum + (f.eventCount ?? 0), 0)
            showToast({
              title: 'Bulk ingest finished',
              description: `${data.files.length} file${data.files.length === 1 ? '' : 's'} imported · ${events.toLocaleString()} events.`,
              variant: 'success',
            })
          } else {
            const failed = data.files.filter((f) => f.status === 'failed').length
            showToast({
              title: 'Bulk ingest finished with errors',
              description: `${failed} file${failed === 1 ? '' : 's'} failed; check the Files table for details.`,
              variant: 'danger',
            })
          }
        }
      }

      es.addEventListener('progress', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as IngestJob
          handleProgress(data)
        } catch {
          /* ignore malformed payload */
        }
      })

      es.onerror = () => {
        es.close()
        jobEsRef.current = null
        void fetchIngestJob(serverId, jobId)
          .then((j) => setJob(j))
          .catch(() => {
            /* ignore — job may have been retired from registry */
          })
      }
    },
    [serverId, loadFiles, showToast],
  )

  useEffect(() => {
    return () => {
      if (jobEsRef.current) {
        jobEsRef.current.close()
        jobEsRef.current = null
      }
    }
  }, [])

  const { run: runIngestAll } = useAsyncAction(
    async () => {
      const r = await ingestAllServerLogs(serverId)
      if (r.jobId) {
        setJob({
          id: r.jobId,
          serverId,
          status: 'pending',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          files: r.files.map((file) => ({
            file,
            status: 'pending',
            eventCount: null,
            durationMs: null,
            error: null,
            startedAt: null,
            finishedAt: null,
          })),
        })
        subscribeJob(r.jobId)
      }
      return r
    },
    {
      label: 'Starting bulk ingest…',
      successToast: (r) =>
        r.jobId
          ? {
              title: 'Bulk ingest started',
              description: `${r.files.length} file${r.files.length === 1 ? '' : 's'} queued.`,
              variant: 'default',
            }
          : {
              title: 'Nothing to do',
              description: 'All files are already imported.',
              variant: 'success',
            },
      errorToast: (err) => ({
        title: 'Bulk ingest failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      }),
    },
  )

  const { run: runDelete } = useAsyncAction(
    async (file: string) => {
      setBusyFile(file)
      try {
        return await deleteServerLogImport(serverId, file)
      } finally {
        setBusyFile(null)
      }
    },
    {
      label: (file) => `Removing import ${file}…`,
      successToast: (_, args) => ({
        title: 'Removed',
        description: `${args[0]} import deleted.`,
        variant: 'success',
      }),
      onSuccess: () => {
        void loadFiles()
      },
    },
  )

  const summary = useMemo(() => {
    if (files.length === 0) {
      return { imported: 0, pending: 0, totalEvents: 0 }
    }
    let imported = 0
    let pending = 0
    let totalEvents = 0
    for (const f of files) {
      if (f.imported) {
        imported += 1
        totalEvents += f.eventCount ?? 0
      } else {
        pending += 1
      }
    }
    return { imported, pending, totalEvents }
  }, [files])

  const jobByFile = useMemo(() => {
    if (!job) return new Map<string, IngestJob['files'][number]>()
    return new Map(job.files.map((f) => [f.file, f]))
  }, [job])

  const jobActive = job?.status === 'running' || job?.status === 'pending'
  const jobProgress = useMemo(() => {
    if (!job) return null
    const total = job.files.length
    if (total === 0) return null
    const done = job.files.filter(
      (f) => f.status === 'completed' || f.status === 'failed' || f.status === 'skipped',
    ).length
    return { total, done, percent: Math.round((done / total) * 100) }
  }, [job])

  if (configLoading) {
    return (
      <ContentSection>
        <Loader size="lg" />
      </ContentSection>
    )
  }

  return (
    <ContentSection>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="sm">
            <img
              src={profileIconPath}
              alt=""
              aria-hidden="true"
              width={64}
              height={64}
              style={{ borderRadius: 8, objectFit: 'cover', display: 'block' }}
            />
            <Title order={2}>{displayName}</Title>
          </Group>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(serverPath)}
            styles={{ root: { alignSelf: 'flex-start', width: 'fit-content' } }}
          >
            Server
          </Button>
        </Group>

        {!sshOk && (
          <Alert color="yellow" title="SSH not configured">
            Set {envPrefix}_SSH_HOST, {envPrefix}_SSH_USER, and {envPrefix}_SSH_PASSWORD or a private
            key on the backend.
          </Alert>
        )}

        {sshOk && !filesConfigured && (
          <Alert color="blue" title="Remote file root not set">
            {filesHint ??
              `Set ${envPrefix}_SFTP_REMOTE_ROOT to an absolute path on the VPS, then restart the backend.`}
          </Alert>
        )}

        {sshOk && filesConfigured && (
          <Tabs value={activeTab} onChange={handleTabChange} keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="files">Files</Tabs.Tab>
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              <Tabs.Tab value="player">Player</Tabs.Tab>
              <Tabs.Tab value="live">Live</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="files" pt="md">
              <Stack gap="md">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Group gap="md">
                    <Badge variant="light" color="gray">
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </Badge>
                    <Badge variant="light" color="green">
                      {summary.imported} imported
                    </Badge>
                    {summary.pending > 0 && (
                      <Badge variant="light" color="yellow">
                        {summary.pending} pending
                      </Badge>
                    )}
                    {summary.totalEvents > 0 && (
                      <Badge variant="light" color="blue">
                        {summary.totalEvents.toLocaleString()} events
                      </Badge>
                    )}
                  </Group>
                  <Group gap="xs">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<StackIcon size={16} weight="duotone" />}
                      onClick={() => void runIngestAll()}
                      disabled={jobActive || summary.pending === 0}
                      loading={jobActive}
                    >
                      Ingest all pending
                      {summary.pending > 0 ? ` (${summary.pending})` : ''}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ArrowsClockwise size={16} />}
                      onClick={() => void loadFiles()}
                      disabled={filesLoading}
                    >
                      {filesLoading ? 'Refreshing…' : 'Refresh'}
                    </Button>
                  </Group>
                </Group>

                {jobProgress && (
                  <Stack gap={4}>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">
                        {jobActive ? 'Ingesting…' : `Job ${job?.status ?? ''}`} · {jobProgress.done}/
                        {jobProgress.total}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {jobProgress.percent}%
                      </Text>
                    </Group>
                    <Progress
                      value={jobProgress.percent}
                      color={
                        job?.status === 'failed'
                          ? 'red'
                          : job?.status === 'completed'
                            ? 'green'
                            : 'blue'
                      }
                      size="sm"
                      animated={jobActive}
                    />
                  </Stack>
                )}

                {filesError && (
                  <Alert color="red" title="Failed to list logs" icon={<Warning size={18} />}>
                    {filesError}
                  </Alert>
                )}

                {filesLoading && files.length === 0 ? (
                  <Group gap="xs">
                    <Loader size="sm" />
                    <Text size="sm">Loading remote logs…</Text>
                  </Group>
                ) : files.length === 0 && !filesError ? (
                  <Text size="sm" c="dimmed">
                    No `.log.gz` files found in <code>logs/</code>.
                  </Text>
                ) : (
                  <Table withTableBorder striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>File</Table.Th>
                        <Table.Th>Size</Table.Th>
                        <Table.Th>Modified</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Events</Table.Th>
                        <Table.Th>Imported</Table.Th>
                        <Table.Th style={{ width: 220 }}>Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {files.map((f) => {
                        const busy = busyFile === f.name
                        const jobState = jobByFile.get(f.name)
                        const jobBadge = jobState
                          ? jobState.status === 'running'
                            ? { color: 'blue', label: 'Running…' }
                            : jobState.status === 'failed'
                              ? { color: 'red', label: 'Failed' }
                              : jobState.status === 'completed'
                                ? null
                                : { color: 'gray', label: 'Queued' }
                          : null
                        return (
                          <Table.Tr key={f.name}>
                            <Table.Td>
                              <Text size="sm" ff="monospace">
                                {f.name}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{formatBytes(f.size)}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="xs" c="dimmed">
                                {formatRelative(f.mtime)}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              {jobBadge ? (
                                <Badge color={jobBadge.color} variant="light">
                                  {jobBadge.label}
                                </Badge>
                              ) : f.imported ? (
                                <Badge
                                  color="green"
                                  variant="light"
                                  leftSection={<CheckCircle size={12} weight="fill" />}
                                >
                                  Imported
                                </Badge>
                              ) : (
                                <Badge color="yellow" variant="light">
                                  Pending
                                </Badge>
                              )}
                              {jobState?.error && (
                                <Tooltip label={jobState.error} withArrow multiline w={320}>
                                  <Text size="xs" c="red" mt={2} truncate>
                                    {jobState.error}
                                  </Text>
                                </Tooltip>
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">
                                {f.eventCount === null ? '—' : f.eventCount.toLocaleString()}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="xs" c="dimmed">
                                {formatRelative(f.importedAt)}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Group gap="xs" wrap="nowrap">
                                <Button
                                  variant={f.imported ? 'secondary' : 'primary'}
                                  size="sm"
                                  icon={
                                    f.imported ? (
                                      <ArrowsClockwise size={14} />
                                    ) : (
                                      <CloudArrowDown size={14} />
                                    )
                                  }
                                  onClick={() => {
                                    void runIngest(f.name)
                                  }}
                                  disabled={busy}
                                  loading={busy}
                                >
                                  {f.imported ? 'Re-ingest' : 'Ingest'}
                                </Button>
                                {f.imported && (
                                  <Tooltip label="Remove from local DB" withArrow>
                                    <span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<Trash size={14} />}
                                        onClick={() => {
                                          void runDelete(f.name)
                                        }}
                                        disabled={busy}
                                      />
                                    </span>
                                  </Tooltip>
                                )}
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        )
                      })}
                    </Table.Tbody>
                  </Table>
                )}

                {latest && (
                  <Alert color="gray" variant="light" icon={<Eye size={18} />}>
                    <Group justify="space-between" wrap="wrap" gap="xs">
                      <Text size="sm">
                        <Text span ff="monospace">
                          latest.log
                        </Text>
                        {' — in progress, '}
                        {formatBytes(latest.size)}
                        {latest.mtime ? `, modified ${formatRelative(latest.mtime)}` : ''}.
                        {' '}Preview will live in the Live tab (coming soon).
                      </Text>
                    </Group>
                  </Alert>
                )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="overview" pt="md">
              <OverviewTab serverId={serverId} onPickPlayer={handlePickPlayer} />
            </Tabs.Panel>
            <Tabs.Panel value="player" pt="md">
              <PlayerTab serverId={serverId} initialPlayer={searchParams.get('player')} />
            </Tabs.Panel>
            <Tabs.Panel value="live" pt="md">
              <LiveTab serverId={serverId} />
            </Tabs.Panel>
          </Tabs>
        )}
      </Stack>
    </ContentSection>
  )
}
