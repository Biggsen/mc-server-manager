import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowsOutSimple,
  CaretRight,
  File,
  Folder,
  FolderOpen,
  FloppyDisk,
  ArrowSquareUp,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react'
import {
  Alert,
  Anchor,
  Box,
  Code,
  Group,
  Loader as MantineLoader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { ContentSection } from '../components/layout'
import { Button as UIButton, Modal } from '../components/ui'
import {
  fetchProjects,
  fetchRuns,
  fetchProjectConfigs,
  listWorkspacePluginFiles,
  readWorkspacePluginFile,
  writeWorkspacePluginFile,
  deleteWorkspacePluginFile,
  promoteWorkspacePluginFiles,
  type ProjectSummary,
  type RunJob,
  type WorkspaceFileEntry,
} from '../lib/api'
import { useToast } from '../components/ui'
import { useAsyncAction } from '../lib/useAsyncAction'

function isYamlPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.yml') || lower.endsWith('.yaml')
}

function LiveEditor() {
  const { toast: showToast } = useToast()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [runs, setRuns] = useState<RunJob[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([])
  const [breadcrumb, setBreadcrumb] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileIsBinary, setFileIsBinary] = useState(false)
  const [contentDirty, setContentDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [panelWidth, setPanelWidth] = useState(320)
  const [resizing, setResizing] = useState(false)
  const [expandedModal, setExpandedModal] = useState(false)
  const [projectConfigPaths, setProjectConfigPaths] = useState<Set<string>>(new Set())
  const [addFileModal, setAddFileModal] = useState(false)
  const [addFileName, setAddFileName] = useState('')
  const [addFileBusy, setAddFileBusy] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeRun = useMemo(
    () => runs.find((r) => r.status === 'running' || r.status === 'pending'),
    [runs],
  )

  useEffect(() => {
    fetchProjects().then(setProjects).catch(console.error)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchRuns().then(setRuns).catch(console.error)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (activeRun && !projectId) {
      setProjectId(activeRun.projectId)
    }
  }, [activeRun, projectId])

  const loadEntries = useCallback(async () => {
    if (!projectId) return
    setEntriesLoading(true)
    try {
      const subPath = breadcrumb.length > 0 ? `plugins/${breadcrumb.join('/')}` : ''
      const items = await listWorkspacePluginFiles(projectId, subPath || undefined)
      setEntries(items)
    } catch (err) {
      showToast({
        title: 'Failed to load files',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
      setEntries([])
    } finally {
      setEntriesLoading(false)
    }
  }, [projectId, breadcrumb, showToast])

  useEffect(() => {
    if (projectId) {
      loadEntries()
      fetchProjectConfigs(projectId)
        .then((configs) => setProjectConfigPaths(new Set(configs.map((c) => c.path))))
        .catch(() => setProjectConfigPaths(new Set()))
    } else {
      setEntries([])
      setProjectConfigPaths(new Set())
    }
  }, [projectId, loadEntries, showToast])

  const loadFile = useCallback(async (path: string) => {
    if (!projectId) return
    setFileLoading(true)
    setSelectedFile(path)
    setContentDirty(false)
    try {
      const { content, isBinary } = await readWorkspacePluginFile(projectId, path)
      setFileContent(content)
      setFileIsBinary(isBinary)
    } catch (err) {
      showToast({
        title: 'Failed to load file',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
      setFileContent('')
      setFileIsBinary(false)
    } finally {
      setFileLoading(false)
    }
  }, [projectId, showToast])

  const { run: saveFile, busy: saveLoading } = useAsyncAction(
    async () => {
      if (!projectId || !selectedFile) return
      await writeWorkspacePluginFile(projectId, selectedFile, fileContent, fileIsBinary)
      setContentDirty(false)
    },
    {
      label: 'Saving…',
      successToast: () => ({
        title: 'Saved',
        description: 'File written to workspace. Changes apply live.',
        variant: 'success',
      }),
      errorToast: (err) => ({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      }),
    },
  )

  const handleDeleteFile = useCallback(async () => {
    if (!projectId || !selectedFile || !window.confirm(`Delete ${selectedFile}? This cannot be undone.`)) return
    try {
      await deleteWorkspacePluginFile(projectId, selectedFile)
      setSelectedFile(null)
      setFileContent('')
      setExpandedModal(false)
      loadEntries()
      showToast({ title: 'File deleted', description: selectedFile, variant: 'success' })
    } catch (err) {
      showToast({ title: 'Delete failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'danger' })
    }
  }, [projectId, selectedFile, loadEntries, showToast])

  const { run: promoteFile, busy: promoteLoading } = useAsyncAction(
    async () => {
      if (!projectId || !selectedFile) return
      const { promoted, errors } = await promoteWorkspacePluginFiles(projectId, [selectedFile])
      if (errors.length > 0) {
        throw new Error(errors.map((e) => `${e.path}: ${e.error}`).join('; '))
      }
      return promoted
    },
    {
      label: 'Promoting…',
      successToast: () => ({
        title: 'Promoted to project',
        description: 'File saved to project. Run a build to include in future artifacts.',
        variant: 'success',
      }),
      errorToast: (err) => ({
        title: 'Promote failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      }),
      onSuccess: (promoted) => {
        if (projectId && promoted?.length) {
          setProjectConfigPaths((prev) => new Set([...prev, ...promoted]))
        }
      },
    },
  )

  const handleEntryClick = useCallback(
    (entry: WorkspaceFileEntry) => {
      if (entry.type === 'directory') {
        setBreadcrumb((prev) => [...prev, entry.name])
        setSelectedFile(null)
      } else if (entry.editable !== false) {
        loadFile(entry.path)
      }
    },
    [loadFile],
  )

  const handleBreadcrumbClick = useCallback((index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1))
    setSelectedFile(null)
  }, [])

  const handleContentChange = useCallback((value: string) => {
    setFileContent(value)
    setContentDirty(true)
  }, [])

  const currentFolderPath = useMemo(
    () => (breadcrumb.length > 0 ? `plugins/${breadcrumb.join('/')}` : 'plugins'),
    [breadcrumb],
  )

  const handleAddFile = useCallback(async () => {
    if (!projectId) return
    const trimmed = addFileName.trim()
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
      showToast({ title: 'Invalid filename', description: 'Use a simple filename without path segments.', variant: 'danger' })
      return
    }
    const newPath = breadcrumb.length > 0 ? `plugins/${breadcrumb.join('/')}/${trimmed}` : `plugins/${trimmed}`
    setAddFileBusy(true)
    try {
      await writeWorkspacePluginFile(projectId, newPath, '', false)
      setAddFileModal(false)
      setAddFileName('')
      await loadEntries()
      loadFile(newPath)
      showToast({ title: 'File created', description: trimmed, variant: 'success' })
    } catch (err) {
      showToast({ title: 'Failed to create file', description: err instanceof Error ? err.message : 'Unknown error', variant: 'danger' })
    } finally {
      setAddFileBusy(false)
    }
  }, [projectId, addFileName, breadcrumb, loadEntries, loadFile, showToast])

  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: p.name,
      })),
    [projects],
  )

  const codeExtensions = useMemo(
    () => (selectedFile && isYamlPath(selectedFile) ? [yaml()] : []),
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

  useEffect(() => {
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <ContentSection>
        <MantineLoader size="lg" />
      </ContentSection>
    )
  }

  return (
    <ContentSection>
      <Stack gap="lg">
        <Box>
          <Title order={2}>Live Editor</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Edit plugin configs and data files in the run workspace. Changes apply instantly.
            Promote to save into the project.
          </Text>
        </Box>

        {activeRun && (
          <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-green-6)' }}>
            <Group gap="xs">
              <Box component="span" style={{ color: 'var(--mantine-color-green-6)' }}>
                <CaretRight size={18} weight="fill" />
              </Box>
              <Text size="sm" fw={500}>
                Run active
              </Text>
              <Text size="sm" c="dimmed">
                •
              </Text>
              <Anchor component={Link} to={`/projects/${activeRun.projectId}`} size="sm">
                {projects.find((p) => p.id === activeRun.projectId)?.name ?? activeRun.projectId}
              </Anchor>
            </Group>
          </Paper>
        )}

        <Select
          label="Project"
          placeholder="Select project"
          data={projectOptions}
          value={projectId ?? ''}
          onChange={(v) => {
            setProjectId(v || null)
            setBreadcrumb([])
            setSelectedFile(null)
          }}
          w={220}
          clearable
        />

        {!projectId ? (
          <Alert variant="light">
            Select a project to browse its workspace plugin files. Start a run first if the
            workspace is empty.
          </Alert>
        ) : (
          <Box ref={containerRef} style={{ display: 'flex', minHeight: 400 }}>
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
              <Group gap="xs" mb="xs" justify="space-between" wrap="nowrap">
                <Group gap="xs">
                  <FolderOpen size={18} />
                  <Text size="sm" fw={600}>
                    plugins/
                  </Text>
                </Group>
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  onClick={() => {
                    setAddFileName('')
                    setAddFileModal(true)
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={14} /> Add file
                </Anchor>
              </Group>
              {breadcrumb.length > 0 && (
                <Group gap={4} mb="xs" wrap="wrap">
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={() => setBreadcrumb([])}
                  >
                    plugins
                  </Anchor>
                  {breadcrumb.map((segment, i) => (
                    <Fragment key={i}>
                      <Text size="xs" c="dimmed">
                        /
                      </Text>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={() => handleBreadcrumbClick(i)}
                      >
                        {segment}
                      </Anchor>
                    </Fragment>
                  ))}
                </Group>
              )}
              <ScrollArea h={420} type="scroll">
                {entriesLoading ? (
                  <MantineLoader size="sm" />
                ) : entries.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    No files
                  </Text>
                ) : (
                  <Stack gap={2}>
                    {entries.map((entry) => (
                      <Group
                        key={entry.path}
                        gap="xs"
                        align="center"
                        style={{
                          cursor: entry.type === 'directory' || entry.editable !== false ? 'pointer' : 'default',
                          padding: '0 6px',
                          margin: '0 -6px',
                          borderRadius: 'var(--mantine-radius-sm)',
                          background: selectedFile === entry.path ? 'var(--mantine-color-blue-light)' : 'transparent',
                        }}
                        onClick={() => handleEntryClick(entry)}
                        opacity={entry.editable === false ? 0.6 : 1}
                      >
                        {entry.type === 'directory' ? (
                          <Folder size={16} />
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
                      </Group>
                    ))}
                  </Stack>
                )}
              </ScrollArea>
            </Paper>

            <Box
              onMouseDown={handleResizeStart}
              role="separator"
              aria-orientation="vertical"
              style={{
                width: 8,
                flexShrink: 0,
                cursor: 'col-resize',
                background: resizing ? 'var(--mantine-color-blue-6)' : 'transparent',
                marginLeft: 4,
                marginRight: 4,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Drag to resize"
            >
              <Box
                style={{
                  width: 2,
                  height: 40,
                  borderRadius: 1,
                  background: resizing
                    ? 'var(--mantine-color-white)'
                    : 'var(--mantine-color-default-border)',
                }}
              />
            </Box>

            <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {selectedFile ? (
                <>
                  <Group justify="space-between" mb="xs">
                    <Code>{selectedFile}</Code>
                    <Group gap="xs">
                      <UIButton
                        variant="ghost"
                        size="sm"
                        icon={<ArrowsOutSimple size={16} />}
                        onClick={() => setExpandedModal(true)}
                        title="Expand editor"
                      >
                        Expand
                      </UIButton>
                      <UIButton
                        variant="primary"
                        size="sm"
                        icon={<FloppyDisk size={16} />}
                        onClick={() => saveFile()}
                        disabled={!contentDirty || saveLoading}
                      >
                        {saveLoading ? 'Saving…' : 'Save'}
                      </UIButton>
                      <UIButton
                        variant="secondary"
                        size="sm"
                        icon={<ArrowSquareUp size={16} />}
                        onClick={() => promoteFile()}
                        disabled={promoteLoading}
                      >
                        {promoteLoading
                          ? projectConfigPaths.has(selectedFile)
                            ? 'Promoting…'
                            : 'Adding…'
                          : projectConfigPaths.has(selectedFile)
                            ? 'Promote to project'
                            : 'Add to project'}
                      </UIButton>
                      {!projectConfigPaths.has(selectedFile) && (
                        <UIButton
                          variant="danger"
                          size="sm"
                          icon={<Trash size={16} />}
                          onClick={() => handleDeleteFile()}
                        >
                          Delete
                        </UIButton>
                      )}
                    </Group>
                  </Group>
                  {fileIsBinary ? (
                    <Alert>Binary files cannot be edited here.</Alert>
                  ) : fileLoading ? (
                    <MantineLoader />
                  ) : (
                    <CodeMirror
                      value={fileContent}
                      onChange={handleContentChange}
                      extensions={codeExtensions}
                      theme={oneDark}
                      style={{
                        flex: 1,
                        minHeight: 320,
                        border: '1px solid var(--mantine-color-default-border)',
                        borderRadius: 'var(--mantine-radius-md)',
                      }}
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLine: true,
                      }}
                    />
                  )}
                </>
              ) : (
                <Box
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px dashed var(--mantine-color-default-border)',
                    borderRadius: 'var(--mantine-radius-md)',
                  }}
                >
                  <Text size="sm" c="dimmed">
                    Select a file to edit
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Stack>

      <Modal
        opened={addFileModal}
        onClose={() => setAddFileModal(false)}
        title="Add file"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Create a new file in {currentFolderPath}/
          </Text>
          <TextInput
            label="Filename"
            placeholder="e.g. book2.yml"
            value={addFileName}
            onChange={(e) => setAddFileName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddFile()}
          />
          <Group justify="flex-end" gap="xs">
            <UIButton variant="ghost" onClick={() => setAddFileModal(false)} disabled={addFileBusy}>
              Cancel
            </UIButton>
            <UIButton variant="primary" onClick={() => handleAddFile()} disabled={addFileBusy || !addFileName.trim()}>
              {addFileBusy ? 'Creating…' : 'Create'}
            </UIButton>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={expandedModal && !!selectedFile}
        onClose={() => setExpandedModal(false)}
        title={selectedFile ? `Edit: ${selectedFile}` : 'Edit'}
        size="100%"
        styles={{
          content: { height: 'calc(100vh - 120px)', maxHeight: 'calc(100vh - 120px)' },
          body: { height: 'calc(100vh - 180px)', display: 'flex', flexDirection: 'column' },
        }}
      >
        <Stack gap="md" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {selectedFile && (
            <>
              {fileIsBinary ? (
                <Alert>Binary files cannot be edited here.</Alert>
              ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
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
                    style={{ flex: 1, height: '100%' }}
                  />
                </div>
              )}
              <Group justify="space-between" style={{ flexShrink: 0 }}>
                <UIButton
                  variant="ghost"
                  size="sm"
                  icon={<X size={18} />}
                  onClick={() => setExpandedModal(false)}
                >
                  Close
                </UIButton>
                <Group gap="xs">
                  <UIButton
                    variant="primary"
                    size="sm"
                    icon={<FloppyDisk size={16} />}
                    onClick={() => saveFile()}
                    disabled={!contentDirty || saveLoading}
                  >
                    {saveLoading ? 'Saving…' : 'Save'}
                  </UIButton>
                  <UIButton
                    variant="secondary"
                    size="sm"
                    icon={<ArrowSquareUp size={16} />}
                    onClick={() => promoteFile()}
                    disabled={promoteLoading}
                  >
                    {promoteLoading
                      ? projectConfigPaths.has(selectedFile)
                        ? 'Promoting…'
                        : 'Adding…'
                      : projectConfigPaths.has(selectedFile)
                        ? 'Promote to project'
                        : 'Add to project'}
                  </UIButton>
                  {!projectConfigPaths.has(selectedFile) && (
                    <UIButton
                      variant="danger"
                      size="sm"
                      icon={<Trash size={16} />}
                      onClick={() => handleDeleteFile()}
                    >
                      Delete
                    </UIButton>
                  )}
                </Group>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </ContentSection>
  )
}

export default LiveEditor
