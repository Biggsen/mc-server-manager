import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { File, FloppyDisk, Folder, FolderOpen } from '@phosphor-icons/react'
import {
  Alert,
  Anchor,
  Box,
  Group,
  Loader as MantineLoader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { ContentSection } from '../components/layout'
import { Button, Button as UIButton } from '../components/ui'
import { useToast } from '../components/ui'
import {
  fetchLiveServerFileRead,
  fetchLiveServerFilesConfig,
  fetchLiveServerFilesList,
  writeLiveServerRemoteFile,
  type LiveServerFileListEntry,
} from '../lib/api'
import { useAsyncAction } from '../lib/useAsyncAction'

function isYamlPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.yml') || lower.endsWith('.yaml')
}

export type LiveServerFilesPageProps = {
  serverId: string
  displayName: string
  serverPath: string
}

export default function LiveServerFilesPage({ serverId, displayName, serverPath }: LiveServerFilesPageProps) {
  const navigate = useNavigate()
  const { toast: showToast } = useToast()
  const envPrefix = serverId.toUpperCase()
  const profileIconPath = `server_icons/${serverId}-profile.png`
  const [sshOk, setSshOk] = useState(true)
  const [filesConfigured, setFilesConfigured] = useState(false)
  const [remoteRoot, setRemoteRoot] = useState<string | undefined>()
  const [maxBytes, setMaxBytes] = useState(8 * 1024 * 1024)
  const [filesHint, setFilesHint] = useState<string | undefined>()
  const [configLoading, setConfigLoading] = useState(true)

  const [breadcrumb, setBreadcrumb] = useState<string[]>([])
  const [entries, setEntries] = useState<LiveServerFileListEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileIsBinary, setFileIsBinary] = useState(false)
  const [fileLoadError, setFileLoadError] = useState<string | null>(null)
  const [contentDirty, setContentDirty] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [panelWidth, setPanelWidth] = useState(320)
  const [resizing, setResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentDirPath = useMemo(() => breadcrumb.join('/'), [breadcrumb])

  useEffect(() => {
    let cancelled = false
    setConfigLoading(true)
    fetchLiveServerFilesConfig(serverId)
      .then((c) => {
        if (cancelled) return
        setSshOk(true)
        setFilesConfigured(c.filesConfigured)
        setRemoteRoot(c.remoteRoot)
        setMaxBytes(c.maxBytes)
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

  const loadEntries = useCallback(async () => {
    if (!sshOk || !filesConfigured) return
    setEntriesLoading(true)
    try {
      const { entries: list } = await fetchLiveServerFilesList(serverId, currentDirPath || undefined)
      setEntries(list)
    } catch (err) {
      showToast({
        title: 'Failed to list remote directory',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
      setEntries([])
    } finally {
      setEntriesLoading(false)
    }
  }, [sshOk, filesConfigured, currentDirPath, serverId, showToast])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  const loadFile = useCallback(
    async (relPath: string) => {
      setFileLoading(true)
      setSelectedFile(relPath)
      setContentDirty(false)
      setFileLoadError(null)
      try {
        const { content, isBinary } = await fetchLiveServerFileRead(serverId, relPath)
        setFileContent(content)
        setFileIsBinary(isBinary)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        showToast({
          title: 'Failed to load file',
          description: message,
          variant: 'danger',
        })
        setFileLoadError(message)
        setFileContent('')
        setFileIsBinary(false)
      } finally {
        setFileLoading(false)
      }
    },
    [serverId, showToast],
  )

  const { run: saveFile, busy: saveLoading } = useAsyncAction(
    async () => {
      if (!selectedFile) return
      await writeLiveServerRemoteFile(serverId, selectedFile, fileContent)
      setContentDirty(false)
    },
    {
      label: 'Saving…',
      successToast: () => ({
        title: 'Saved',
        description: 'File written on the remote server.',
        variant: 'success',
      }),
      errorToast: (err) => ({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      }),
    },
  )

  const handleEntryClick = useCallback(
    (entry: LiveServerFileListEntry) => {
      if (entry.type === 'directory') {
        setBreadcrumb((prev) => [...prev, entry.name])
        setSelectedFile(null)
        setFileContent('')
        setFileLoadError(null)
        setContentDirty(false)
      } else {
        void loadFile(entry.relativePath)
      }
    },
    [loadFile],
  )

  const handleBreadcrumbClick = useCallback((index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1))
    setSelectedFile(null)
    setFileContent('')
    setFileLoadError(null)
    setContentDirty(false)
  }, [])

  const handleContentChange = useCallback((value: string) => {
    setFileContent(value)
    setContentDirty(true)
  }, [])

  const codeExtensions = useMemo(
    () => [
      EditorView.lineWrapping,
      ...(selectedFile && isYamlPath(selectedFile) ? [yaml()] : []),
    ],
    [selectedFile],
  )

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setResizing(true)
  }, [])

  useEffect(() => {
    if (!resizing) return
    const handleMove = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const next = Math.max(180, Math.min(500, x))
      setPanelWidth(next)
    }
    const handleUp = () => setResizing(false)
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizing])

  if (configLoading) {
    return (
      <ContentSection>
        <MantineLoader size="lg" />
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
            Set {envPrefix}_SSH_HOST, {envPrefix}_SSH_USER, and {envPrefix}_SSH_PASSWORD or a private key on the backend.
          </Alert>
        )}

        {sshOk && !filesConfigured && (
          <Alert color="blue" title="Remote file root not set">
            {filesHint ??
              `Set ${envPrefix}_SFTP_REMOTE_ROOT to an absolute path on the VPS (for example the same path as your project SFTP remote path on the Upload page), then restart the backend.`}
          </Alert>
        )}

        {sshOk && filesConfigured && remoteRoot && (
          <Text size="xs" c="dimmed" ff="monospace">
            Root: {remoteRoot} · max file size {Math.round(maxBytes / (1024 * 1024))} MiB
          </Text>
        )}

        {sshOk && filesConfigured && (
          <Box
            ref={containerRef}
            style={{
              display: 'flex',
              minHeight: 400,
              maxHeight: 'min(720px, calc(100vh - 280px))',
              overflow: 'hidden',
            }}
          >
            <Paper
              component={Stack}
              gap="xs"
              p="md"
              style={{
                width: panelWidth,
                flexShrink: 0,
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-md)',
              }}
            >
              <Group gap="xs" mb="xs">
                <FolderOpen size={18} />
                <Text size="sm" fw={600}>
                  Server files
                </Text>
              </Group>
              {breadcrumb.length > 0 && (
                <Group gap={4} mb="xs" wrap="wrap">
                  <Anchor component="button" type="button" size="sm" onClick={() => setBreadcrumb([])}>
                    (root)
                  </Anchor>
                  {breadcrumb.map((segment, i) => (
                    <Fragment key={i}>
                      <Text size="xs" c="dimmed">
                        /
                      </Text>
                      <Anchor component="button" type="button" size="sm" onClick={() => handleBreadcrumbClick(i)}>
                        {segment}
                      </Anchor>
                    </Fragment>
                  ))}
                </Group>
              )}
              <ScrollArea style={{ flex: 1 }} type="auto">
                {entriesLoading ? (
                  <Group gap="xs" p="sm">
                    <MantineLoader size="sm" />
                    <Text size="sm">Loading…</Text>
                  </Group>
                ) : (
                  <Stack gap={4}>
                    {entries.map((entry) => (
                      <Group
                        key={entry.relativePath}
                        gap="xs"
                        wrap="nowrap"
                        style={{
                          cursor: 'pointer',
                          borderRadius: 4,
                          padding: '4px 6px',
                        }}
                        onClick={() => handleEntryClick(entry)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleEntryClick(entry)
                          }
                        }}
                        tabIndex={0}
                        role="button"
                      >
                        {entry.type === 'directory' ? (
                          <Folder size={16} weight="duotone" />
                        ) : (
                          <File size={16} />
                        )}
                        <Text size="sm" truncate style={{ flex: 1 }}>
                          {entry.name}
                        </Text>
                      </Group>
                    ))}
                    {entries.length === 0 && (
                      <Text size="sm" c="dimmed" p="sm">
                        Empty folder.
                      </Text>
                    )}
                  </Stack>
                )}
              </ScrollArea>
            </Paper>
            <Box
              onMouseDown={handleResizeStart}
              style={{
                width: 6,
                flexShrink: 0,
                cursor: 'col-resize',
                alignSelf: 'stretch',
                background: resizing ? 'var(--mantine-color-blue-filled)' : 'transparent',
              }}
              aria-hidden
            />
            <Paper
              p="md"
              style={{
                flex: 1,
                minWidth: 0,
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-md)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {!selectedFile ? (
                <Text size="sm" c="dimmed">
                  Select a file to edit.
                </Text>
              ) : fileLoading ? (
                <Group gap="xs">
                  <MantineLoader size="sm" />
                  <Text size="sm">Loading file…</Text>
                </Group>
              ) : fileLoadError ? (
                <Alert color="yellow">{fileLoadError}</Alert>
              ) : fileIsBinary ? (
                <Alert color="gray">This file looks binary and cannot be edited as text here.</Alert>
              ) : (
                <>
                  <Text size="xs" c="dimmed" mb="sm" ff="monospace" truncate>
                    {selectedFile}
                  </Text>
                  <Box style={{ flex: 1, minHeight: 280, overflow: 'auto' }}>
                    <CodeMirror
                      value={fileContent}
                      onChange={handleContentChange}
                      extensions={codeExtensions}
                      theme={oneDark}
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLine: true,
                      }}
                      style={{ minHeight: 260 }}
                    />
                  </Box>
                  <Group justify="flex-end" mt="md">
                    <UIButton
                      variant="primary"
                      size="sm"
                      icon={<FloppyDisk size={16} />}
                      onClick={() => void saveFile()}
                      disabled={!contentDirty || saveLoading}
                    >
                      {saveLoading ? 'Saving…' : 'Save to server'}
                    </UIButton>
                  </Group>
                </>
              )}
            </Paper>
          </Box>
        )}
      </Stack>
    </ContentSection>
  )
}
