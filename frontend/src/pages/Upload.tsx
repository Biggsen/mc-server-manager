import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchProjects,
  fetchProjectConfigs,
  listUploadLocal,
  listUploadRemote,
  uploadFileToRemote,
  downloadUploadRemoteFile,
  deleteUploadRemoteFile,
  deleteUploadLocalFile,
  type ProjectSummary,
  type UploadListEntry,
} from '../lib/api'
import { Alert, Anchor, Box, Grid, Group, Loader as MantineLoader, Paper, ScrollArea, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { Button, Card, CardContent } from '../components/ui'
import { useToast } from '../components/ui/toast'
import { ContentSection } from '../components/layout'
import { Folder, File, ArrowRight, ArrowDown, ArrowsClockwise, FolderOpen, Trash } from '@phosphor-icons/react'

function formatBytes(bytes?: number): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatMtime(mtime?: string): string {
  if (!mtime) return '—'
  try {
    const d = new Date(mtime)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

function pathToBreadcrumbs(path: string, leadingSlash = false): string[] {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return leadingSlash && segments.length > 0 ? ['', ...segments] : segments
}

export default function Upload() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [password, setPassword] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [remoteEntries, setRemoteEntries] = useState<UploadListEntry[]>([])
  const [localEntries, setLocalEntries] = useState<UploadListEntry[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [localLoading, setLocalLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null)
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    entry: UploadListEntry
    panel: 'remote' | 'local'
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [projectConfigPaths, setProjectConfigPaths] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  useEffect(() => {
    if (!projectId) {
      setProjectConfigPaths(new Set())
      return
    }
    fetchProjectConfigs(projectId)
      .then((configs) => setProjectConfigPaths(new Set(configs.map((c) => c.path))))
      .catch(() => setProjectConfigPaths(new Set()))
  }, [projectId])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-upload-context-menu]')) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  const projectsWithSftp = projects.filter((p) => p.sftp?.host)

  useEffect(() => {
    let cancelled = false
    fetchProjects()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [])

  const loadRemote = useCallback(async (pathOverride?: string) => {
    if (!projectId || !password) return
    const path = pathOverride ?? remotePath
    setRemoteLoading(true)
    setError(null)
    try {
      const entries = await listUploadRemote(projectId, password, path || undefined)
      setRemoteEntries(entries)
      if (pathOverride != null) setRemotePath(pathOverride)
    } catch (err) {
      setRemoteEntries([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoteLoading(false)
    }
  }, [projectId, password, remotePath])

  const loadLocal = useCallback(async () => {
    if (!projectId) return
    setLocalLoading(true)
    setError(null)
    try {
      const entries = await listUploadLocal(projectId, localPath || undefined)
      setLocalEntries(entries)
    } catch (err) {
      setLocalEntries([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLocalLoading(false)
    }
  }, [projectId, localPath])

  useEffect(() => {
    if (!projectId) return
    loadLocal()
  }, [projectId, localPath, loadLocal])

  const handleRemoteEntryClick = (entry: UploadListEntry) => {
    if (entry.type === 'directory') {
      loadRemote(entry.path)
      setSelectedRemote(null)
    } else {
      setSelectedRemote(entry.path)
    }
  }

  const handleLocalEntryClick = (entry: UploadListEntry) => {
    if (entry.type === 'directory') {
      setLocalPath(entry.path)
    } else {
      setSelectedLocal(entry.path)
    }
  }

  const handleUpload = async () => {
    if (!projectId || !password || !selectedLocal) return
    setUploading(true)
    setError(null)
    try {
      const baseRemote = remotePath || projects.find((p) => p.id === projectId)?.sftp?.remotePath || ''
      const name = selectedLocal.split(/[/\\]/).filter(Boolean).pop() ?? selectedLocal
      const destPath = baseRemote ? `${baseRemote.replace(/\/+$/, '')}/${name}` : name
      await uploadFileToRemote(projectId, password, selectedLocal, destPath)
      toast({ variant: 'success', description: `Uploaded ${name}` })
      setSelectedLocal(null)
      loadRemote(remotePath)
    } catch (err) {
      toast({
        variant: 'danger',
        description: err instanceof Error ? err.message : 'Upload failed',
      })
    } finally {
      setUploading(false)
    }
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: UploadListEntry, panel: 'remote' | 'local') => {
    if (entry.type !== 'file') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry, panel })
  }, [])

  const handleDownload = useCallback(async () => {
    if (!projectId || !password || !selectedRemote) return
    const name = selectedRemote.split(/[/\\]/).filter(Boolean).pop() ?? selectedRemote
    const destRelative = localPath ? `${localPath}/${name}` : name
    setDownloading(true)
    setError(null)
    try {
      await downloadUploadRemoteFile(projectId, password, selectedRemote, destRelative)
      toast({ variant: 'success', description: `Downloaded ${name}` })
      setSelectedRemote(null)
      loadLocal()
    } catch (err) {
      toast({
        variant: 'danger',
        description: err instanceof Error ? err.message : 'Download failed',
      })
    } finally {
      setDownloading(false)
    }
  }, [projectId, password, selectedRemote, localPath, toast, loadLocal])

  const handleDeleteFromContextMenu = useCallback(async () => {
    if (!contextMenu || !projectId) return
    const { entry, panel } = contextMenu
    if (entry.type !== 'file') return
    if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) {
      setContextMenu(null)
      return
    }
    setDeleting(true)
    setContextMenu(null)
    try {
      if (panel === 'remote') {
        if (!password) {
          toast({ variant: 'danger', description: 'Password required to delete on server' })
          return
        }
        await deleteUploadRemoteFile(projectId, password, entry.path)
        toast({ variant: 'success', description: `Deleted ${entry.name} on server` })
        loadRemote(remotePath)
      } else {
        await deleteUploadLocalFile(projectId, entry.path)
        toast({ variant: 'success', description: `Deleted ${entry.name} locally` })
        if (selectedLocal === entry.path) setSelectedLocal(null)
        loadLocal()
      }
    } catch (err) {
      toast({
        variant: 'danger',
        description: err instanceof Error ? err.message : 'Delete failed',
      })
    } finally {
      setDeleting(false)
    }
  }, [contextMenu, projectId, password, remotePath, selectedLocal, loadRemote, loadLocal, toast])

  const selectedProject = projects.find((p) => p.id === projectId)

  const remoteDisplayPath = remotePath || selectedProject?.sftp?.remotePath || ''
  const remoteBreadcrumbs = useMemo(() => pathToBreadcrumbs(remoteDisplayPath, false), [remoteDisplayPath])
  const localBreadcrumbs = useMemo(() => pathToBreadcrumbs(localPath, false), [localPath])

  const handleRemoteBreadcrumbClick = useCallback(
    (index: number) => {
      if (index < 0) {
        setRemotePath('')
        loadRemote(selectedProject?.sftp?.remotePath || undefined)
        return
      }
      const segments = remoteBreadcrumbs.filter(Boolean)
      const path = '/' + segments.slice(0, index + 1).join('/')
      loadRemote(path)
    },
    [remoteBreadcrumbs, loadRemote, selectedProject?.sftp?.remotePath],
  )

  const handleLocalBreadcrumbClick = useCallback((index: number) => {
    const segments = localBreadcrumbs
    setLocalPath(index < 0 ? '' : segments.slice(0, index + 1).join('/'))
  }, [localBreadcrumbs])

  return (
    <ContentSection>
      <Stack gap="lg">
        <Box>
          <Title order={2}>Upload</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Sync files from this app&apos;s project workspace to your server via SFTP. Choose a project, enter its
            SFTP password, then pick a local file and click Upload.
          </Text>
        </Box>

        {error && (
          <Alert color="red" title="Error" onClose={() => setError(null)} withCloseButton>
            {error}
          </Alert>
        )}

        {contextMenu && (
          <Box
            component="div"
            data-upload-context-menu
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 1000,
            }}
          >
            <Paper shadow="md" p="xs" withBorder>
              <Stack gap={4}>
                {contextMenu.panel === 'remote' && contextMenu.entry.type === 'file' && (
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: downloading ? 'not-allowed' : 'pointer' }}
                    onClick={async () => {
                      setContextMenu(null)
                      if (!projectId || !password) return
                      const name = contextMenu.entry.name
                      const destRelative = localPath ? `${localPath}/${name}` : name
                      setDownloading(true)
                      try {
                        await downloadUploadRemoteFile(projectId, password, contextMenu.entry.path, destRelative)
                        toast({ variant: 'success', description: `Downloaded ${name}` })
                        setSelectedRemote(null)
                        loadLocal()
                      } catch (err) {
                        toast({ variant: 'danger', description: err instanceof Error ? err.message : 'Download failed' })
                      } finally {
                        setDownloading(false)
                      }
                    }}
                    disabled={downloading}
                  >
                    <ArrowDown size={16} />
                    Download
                  </Anchor>
                )}
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  c="red"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: deleting ? 'not-allowed' : 'pointer' }}
                  onClick={handleDeleteFromContextMenu}
                  disabled={deleting}
                >
                  <Trash size={16} />
                  Delete
                </Anchor>
              </Stack>
            </Paper>
          </Box>
        )}

        <Card>
          <CardContent>
            <Stack gap="md">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Select
                    label="Project"
                    placeholder="Select project"
                    description="Only projects with SFTP configured (in Settings) are listed"
                    value={projectId || null}
                    onChange={(v) => {
                      setProjectId(v || '')
                      setSelectedLocal(null)
                      setRemotePath('')
                      setLocalPath('')
                    }}
                    data={projectsWithSftp.map((p) => ({ value: p.id, label: p.name || p.id }))}
                    clearable
                  />
                </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group align="flex-end" gap="sm">
                  <TextInput
                    type="password"
                    label="SFTP password"
                    placeholder="Control panel / SFTP password"
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    description="Not stored; used only for this session"
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="primary"
                    disabled={!projectId || !password || !selectedProject?.sftp}
                    loading={remoteLoading}
                    onClick={() => loadRemote()}
                  >
                    Connect
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={remoteEntries.length === 0}
                    onClick={() => {
                      setRemoteEntries([])
                      setRemotePath('')
                      setPassword('')
                      setSelectedRemote(null)
                      setError(null)
                    }}
                  >
                    Disconnect
                  </Button>
                </Group>
              </Grid.Col>
            </Grid>
            {projectsWithSftp.length === 0 && (
              <Text size="sm" c="dimmed">
                No projects have SFTP details set. Add host, username, and remote path in a project&apos;s
                Settings tab.
              </Text>
            )}
          </Stack>
        </CardContent>
      </Card>

      {!projectId ? null : (
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Paper
              component={Stack}
              gap="xs"
              p="md"
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-md)',
                minHeight: 360,
              }}
            >
              <Group gap="xs" justify="space-between" wrap="nowrap" mb="xs">
                <Group gap="xs">
                  <FolderOpen size={18} />
                  <Text size="sm" fw={600}>
                    Server (remote)
                  </Text>
                  {remoteLoading && <MantineLoader size="sm" />}
                </Group>
                {remoteEntries.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ArrowsClockwise size={16} />}
                    iconPosition="left"
                    onClick={() => loadRemote(remotePath || undefined)}
                    disabled={remoteLoading}
                    title="Refresh directory"
                  >
                    Refresh
                  </Button>
                )}
              </Group>
              {remoteBreadcrumbs.length > 0 && (
                <Group gap={4} mb="xs" wrap="wrap">
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={() => handleRemoteBreadcrumbClick(-1)}
                  >
                    /
                  </Anchor>
                  {remoteBreadcrumbs.map((segment, i) => (
                    <Fragment key={i}>
                      <Text size="xs" c="dimmed">/</Text>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={() => handleRemoteBreadcrumbClick(i)}
                      >
                        {segment}
                      </Anchor>
                    </Fragment>
                  ))}
                </Group>
              )}
              {remoteEntries.length === 0 && !remoteLoading ? (
                <Text size="sm" c="dimmed">
                  Enter password and click Connect to list remote files.
                </Text>
              ) : (
                <ScrollArea h={320} type="scroll">
                  <Stack gap={2}>
                    {remoteEntries.map((entry) => (
                      <Group
                        key={entry.path}
                        gap="xs"
                        align="center"
                        style={{
                          cursor: 'pointer',
                          padding: '4px 6px',
                          margin: '0 -6px',
                          borderRadius: 'var(--mantine-radius-sm)',
                          background: selectedRemote === entry.path ? 'var(--mantine-color-blue-light)' : 'transparent',
                        }}
                        onClick={() => handleRemoteEntryClick(entry)}
                        onContextMenu={(e) => handleContextMenu(e, entry, 'remote')}
                      >
                        {entry.type === 'directory' ? (
                          <Folder size={16} weight="fill" />
                        ) : (
                          <File size={16} />
                        )}
                        <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                          {entry.name}
                        </Text>
                        {entry.type === 'file' && (
                          <>
                            {(entry.size != null || entry.mtime) && (
                              <Group gap="xs" style={{ paddingRight: 14 }}>
                                {entry.size != null && (
                                  <Text size="xs" c="dimmed">
                                    {formatBytes(entry.size)}
                                  </Text>
                                )}
                                {entry.mtime && (
                                  <Text size="xs" c="dimmed">
                                    {formatMtime(entry.mtime)}
                                  </Text>
                                )}
                              </Group>
                            )}
                          </>
                        )}
                      </Group>
                    ))}
                  </Stack>
                </ScrollArea>
              )}
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Paper
              component={Stack}
              gap="xs"
              p="md"
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-md)',
                minHeight: 360,
              }}
            >
              <Group gap="xs" justify="space-between" wrap="nowrap" mb="xs">
                <Group gap="xs">
                  <FolderOpen size={18} />
                  <Text size="sm" fw={600}>
                    Local (project workspace)
                  </Text>
                  {localLoading && <MantineLoader size="sm" />}
                </Group>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowsClockwise size={16} />}
                  iconPosition="left"
                  onClick={() => loadLocal()}
                  disabled={localLoading}
                  title="Refresh directory"
                >
                  Refresh
                </Button>
              </Group>
              {(localBreadcrumbs.length > 0 || localPath) && (
                <Group gap={4} mb="xs" wrap="wrap">
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={() => handleLocalBreadcrumbClick(-1)}
                  >
                    /
                  </Anchor>
                  {localBreadcrumbs.map((segment, i) => (
                    <Fragment key={i}>
                      <Text size="xs" c="dimmed">/</Text>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={() => handleLocalBreadcrumbClick(i)}
                      >
                        {segment}
                      </Anchor>
                    </Fragment>
                  ))}
                </Group>
              )}
              <ScrollArea h={320} type="scroll">
                <Stack gap={2}>
                  {localEntries.map((entry) => (
                    <Group
                      key={entry.path}
                      gap="xs"
                      align="center"
                      style={{
                        cursor: 'pointer',
                        padding: '4px 6px',
                        margin: '0 -6px',
                        borderRadius: 'var(--mantine-radius-sm)',
                        background: selectedLocal === entry.path ? 'var(--mantine-color-blue-light)' : 'transparent',
                      }}
                      onClick={() => handleLocalEntryClick(entry)}
                      onContextMenu={(e) => handleContextMenu(e, entry, 'local')}
                    >
                      {entry.type === 'directory' ? (
                        <Folder size={16} weight="fill" />
                      ) : (
                        <Box
                          component="span"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            ...(projectConfigPaths.has(entry.path)
                              ? { color: 'var(--mantine-color-green-6)' }
                              : {}),
                          }}
                          title={projectConfigPaths.has(entry.path) ? 'In project config' : undefined}
                        >
                          <File size={16} />
                        </Box>
                      )}
                      <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                        {entry.name}
                      </Text>
                      {entry.type === 'file' && (
                        <>
                          {(entry.size != null || entry.mtime) && (
                            <Group gap="xs" style={{ paddingRight: 14 }}>
                              {entry.size != null && (
                                <Text size="xs" c="dimmed">
                                  {formatBytes(entry.size)}
                                </Text>
                              )}
                              {entry.mtime && (
                                <Text size="xs" c="dimmed">
                                  {formatMtime(entry.mtime)}
                                </Text>
                              )}
                            </Group>
                          )}
                        </>
                      )}
                    </Group>
                  ))}
                </Stack>
              </ScrollArea>
            </Paper>
          </Grid.Col>
        </Grid>
      )}

      {projectId && selectedLocal && (
        <Card>
          <CardContent>
            <Group justify="space-between">
              <Text size="sm">
                Upload <strong>{selectedLocal.split(/[/\\]/).pop()}</strong> to server
              </Text>
              <Button
                variant="primary"
                icon={<ArrowRight size={18} />}
                iconPosition="left"
                loading={uploading}
                disabled={!password}
                onClick={handleUpload}
              >
                Upload
              </Button>
            </Group>
          </CardContent>
        </Card>
      )}

      {projectId && selectedRemote && (
        <Card>
          <CardContent>
            <Group justify="space-between">
              <Text size="sm">
                Download <strong>{selectedRemote.split(/[/\\]/).pop()}</strong> to local workspace
              </Text>
              <Button
                variant="primary"
                icon={<ArrowDown size={18} />}
                iconPosition="left"
                loading={downloading}
                disabled={!password}
                onClick={handleDownload}
              >
                Download
              </Button>
            </Group>
          </CardContent>
        </Card>
      )}
      </Stack>
    </ContentSection>
  )
}
