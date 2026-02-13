import { useCallback, useEffect, useMemo, useRef, useState, memo, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Play, FileText, MagnifyingGlass, Package as PackageIcon, Upload, PencilSimple, ArrowsClockwise, Trash, FloppyDisk, Plus, Copy } from '@phosphor-icons/react'
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  addProjectPlugin,
  copyProjectPluginsFrom,
  deleteProject,
  deleteProjectConfigFile,
  deleteProjectPlugin,
  fetchBuildManifest,
  fetchBuilds,
  fetchProject,
  fetchProjects,
  fetchProjectConfigFile,
  fetchProjectConfigs,
  fetchProjectPluginConfigs,
  fetchProjectProfile,
  fetchProjectRuns,
  fetchPluginLibrary,
  resetProjectWorkspace,
  runProjectLocally,
  saveProjectProfile,
  scanProjectAssets,
  sendRunCommand,
  stopRunJob,
  syncProjectRepository,
  triggerBuild,
  triggerManifest,
  updateProject,
  updateProjectConfigFile,
  updateProjectPluginConfigs,
  uploadProjectConfig,
  fetchInitStatus,
  clearInitMarker,
  type BuildJob,
  type BuildOptions,
  type PluginConfigDefinitionView,
  type ProjectConfigSummary,
  type ProjectPluginConfigMapping,
  type ProjectSummary,
  type RunJob,
  type RunLogEntry,
  type StoredPluginRecord,
  type InitStatusResponse,
} from '../lib/api'
import YAML from 'yaml'
import { Accordion, Alert, Anchor, Checkbox, Code, Group, Loader, NativeSelect, Radio, ScrollArea, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core'
import { Badge, Button, Card, CardContent, CardHeader, Modal, Skeleton } from '../components/ui'
import { useToast } from '../components/ui/toast'
import { ContentSection } from '../components/layout'
import { useAsyncAction } from '../lib/useAsyncAction'
import { CustomPathModal, type CustomPathModalState } from '../components/CustomPathModal'
import { RunLogsAndConsole } from '../components/RunLogsAndConsole'

import { getApiBase } from '../lib/api'
const API_BASE = getApiBase()

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

interface ManifestPreview {
  buildId: string
  content: unknown
}


function formatMinecraftRange(min?: string | null, max?: string | null): string | null {
  if (!min && !max) {
    return null
  }
  if (min && max) {
    return min === max ? min : `${min} – ${max}`
  }
  return min ?? max ?? null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

interface PluginCardProps {
  plugin: NonNullable<ProjectSummary['plugins']>[number]
  pluginDefinitions: PluginConfigDefinitionView[]
  onRemove: (pluginId: string) => void
  onEditCustomPath: (data: Omit<CustomPathModalState, 'opened'>) => void
  onRemoveCustomPath: (data: { pluginId: string; definitionId: string; path: string }) => void
  onAddCustomPath: (pluginId: string) => void
}

interface DescriptionModalProps {
  opened: boolean
  initialValue: string
  onClose: () => void
  onSave: (value: string) => Promise<void>
  loading: boolean
}

const DescriptionModal = memo(function DescriptionModal({
  opened,
  initialValue,
  onClose,
  onSave,
  loading,
}: DescriptionModalProps) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (opened) {
      setValue(initialValue)
    }
  }, [opened, initialValue])

  const handleSave = useCallback(async () => {
    await onSave(value.trim() || '')
  }, [value, onSave])

  const handleCancel = useCallback(() => {
    setValue(initialValue)
    onClose()
  }, [initialValue, onClose])

  return (
    <Modal
      opened={opened}
      onClose={handleCancel}
      title="Edit Description"
      size="lg"
      centered
    >
      <Stack gap="md">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          placeholder="Optional notes about this project"
          rows={15}
          autosize
          minRows={15}
          maxRows={30}
        />
        <Group justify="flex-end">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" loading={loading} onClick={handleSave}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
})

const PluginCard = memo(function PluginCard({
  plugin,
  pluginDefinitions,
  onRemove,
  onEditCustomPath,
  onRemoveCustomPath,
  onAddCustomPath,
}: PluginCardProps) {
  const supportRange = useMemo(
    () =>
      formatMinecraftRange(
        plugin.minecraftVersionMin ?? plugin.source?.minecraftVersionMin,
        plugin.minecraftVersionMax ?? plugin.source?.minecraftVersionMax,
      ),
    [plugin.minecraftVersionMin, plugin.source?.minecraftVersionMin, plugin.minecraftVersionMax, plugin.source?.minecraftVersionMax],
  )

  return (
    <Card key={`${plugin.id}:${plugin.version}`}>
      <CardContent>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Group gap="xs" wrap="wrap">
                <Text fw={600}>{plugin.id}</Text>
                {plugin.provider && plugin.provider !== 'custom' && (
                  <Badge variant="accent">{plugin.provider}</Badge>
                )}
                <Text size="sm" c="dimmed">v{plugin.version}</Text>
              </Group>
              {supportRange && <Text size="sm" c="dimmed">Supports: {supportRange}</Text>}
              {plugin.source?.projectUrl && (
                <Anchor href={plugin.source.projectUrl} target="_blank" rel="noreferrer" size="sm">
                  View project
                </Anchor>
              )}
              {plugin.source?.uploadPath && (
                <Text size="sm" c="dimmed">Uploaded jar: {plugin.source.uploadPath}</Text>
              )}
              {(plugin.cachePath ?? plugin.source?.cachePath) && (
                <Text size="sm" c="dimmed">Cache: {plugin.cachePath ?? plugin.source?.cachePath}</Text>
              )}
            </Stack>
            <Group gap="xs">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRemove(plugin.id)}
                icon={<Trash size={18} weight="fill" aria-hidden="true" />}
              >
                Remove
              </Button>
            </Group>
          </Group>

          <Stack gap="md" mt="xs">
            <Stack gap="xs">
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Config Paths
              </Text>
              {pluginDefinitions.map((definition) => (
                <Group key={definition.id} justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs" wrap="wrap">
                      <Badge variant={definition.type === 'library' ? 'accent' : 'outline'}>
                        {definition.type === 'library' ? 'Template' : 'Custom'}
                      </Badge>
                      <Text size="sm" fw={500}>
                        {definition.label || definition.id}
                      </Text>
                      {definition.uploaded ? (
                        <Badge variant="success">
                          Uploaded
                        </Badge>
                      ) : null}
                    </Group>
                    <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                      {definition.resolvedPath}
                    </Text>
                    {definition.description && (
                      <Text size="xs" c="dimmed">
                        {definition.description}
                      </Text>
                    )}
                    {definition.notes && (
                      <Text size="xs" c="dimmed">
                        Notes: {definition.notes}
                      </Text>
                    )}
                  </Stack>
                  {definition.type === 'custom' && (
                    <Group gap="xs">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onEditCustomPath({
                            pluginId: plugin.id,
                            definitionId: definition.id,
                            label: definition.label ?? '',
                            path: definition.resolvedPath,
                            notes: definition.notes ?? '',
                          })
                        }}
                        icon={<PencilSimple size={16} weight="fill" aria-hidden="true" />}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onRemoveCustomPath({
                            pluginId: plugin.id,
                            definitionId: definition.id,
                            path: definition.resolvedPath,
                          })
                        }}
                        icon={<Trash size={16} weight="fill" aria-hidden="true" />}
                      >
                        Remove
                      </Button>
                    </Group>
                  )}
                </Group>
              ))}
            </Stack>

            <Group>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onAddCustomPath(plugin.id)}
                icon={<Plus size={16} weight="fill" aria-hidden="true" />}
              >
                Add custom config
              </Button>
            </Group>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
})

function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const initialLoadRef = useRef(true)
  const configUploadFormRef = useRef<HTMLFormElement | null>(null)
  const logRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const configUploadFileInputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [pluginDefinitionCache, setPluginDefinitionCache] = useState<
    Record<string, PluginConfigDefinitionView[]>
  >({})
  const [builds, setBuilds] = useState<BuildJob[]>([])
  const [runs, setRuns] = useState<RunJob[]>([])
  const [runBusy, setRunBusy] = useState<Record<string, boolean>>({})
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({})
  const [commandBusy, setCommandBusy] = useState<Record<string, boolean>>({})
  const [runsError, setRunsError] = useState<string | null>(null)
  const [manifestPreview, setManifestPreview] = useState<ManifestPreview | null>(null)
  const [configFiles, setConfigFiles] = useState<ProjectConfigSummary[]>([])
  const [configsLoading, setConfigsLoading] = useState(false)
  const [configsError, setConfigsError] = useState<string | null>(null)
  const [configUploadPath, setConfigUploadPath] = useState('')
  const [configUploadFile, setConfigUploadFile] = useState<File | null>(null)
  const [configUploadPlugin, setConfigUploadPlugin] = useState('')
  const [configUploadType, setConfigUploadType] = useState<'template' | 'custom'>('template')
  const [configUploadDefinition, setConfigUploadDefinition] = useState('')
  const [configUploadName, setConfigUploadName] = useState('')
  const [configUploadPathDirty, setConfigUploadPathDirty] = useState(false)
  const [configUploadBusy, setConfigUploadBusy] = useState(false)
  const [configUploadModalOpened, setConfigUploadModalOpened] = useState(false)
  const [expandedConfigPlugins, setExpandedConfigPlugins] = useState<Set<string>>(new Set())
  const [configEditor, setConfigEditor] = useState<{ path: string; content: string } | null>(null)
  const [configEditorBusy, setConfigEditorBusy] = useState(false)
  const [configEditorError, setConfigEditorError] = useState<string | null>(null)
  const [customPathModal, setCustomPathModal] = useState<CustomPathModalState | null>(null)
  const [removeCustomPathConfirm, setRemoveCustomPathConfirm] = useState<{
    pluginId: string
    definitionId: string
    path: string
  } | null>(null)
  const [deleteRepo, setDeleteRepo] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [addPluginOpen, setAddPluginOpen] = useState(false)
  const [addPluginBusy, setAddPluginBusy] = useState(false)
  const [addPluginError, setAddPluginError] = useState<string | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [libraryPlugins, setLibraryPlugins] = useState<StoredPluginRecord[]>([])
  const [selectedLibraryPlugin, setSelectedLibraryPlugin] = useState('')
  const [editingVersion, setEditingVersion] = useState(false)
  const [versionValue, setVersionValue] = useState('')
  const [versionBusy, setVersionBusy] = useState(false)
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false)
  const [descriptionBusy, setDescriptionBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('overview')
  const [showRunOptions, setShowRunOptions] = useState(false)
  const [runOptions, setRunOptions] = useState({ resetWorld: false, resetPlugins: false, useSnapshot: false })
  const [showBuildOptions, setShowBuildOptions] = useState(false)
  const [buildOptions, setBuildOptions] = useState<BuildOptions>({ skipPush: false })
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([])
  const [copyFromOpen, setCopyFromOpen] = useState(false)
  const [copyFromSourceId, setCopyFromSourceId] = useState('')
  const [copyFromMode, setCopyFromMode] = useState<'replace' | 'merge'>('replace')
  const [copyFromBusy, setCopyFromBusy] = useState(false)
  const [copyFromError, setCopyFromError] = useState<string | null>(null)
  const [snapshotSourceBusy, setSnapshotSourceBusy] = useState(false)
  const [snapshotSourceEditMode, setSnapshotSourceEditMode] = useState(false)
  const [snapshotSourceDraft, setSnapshotSourceDraft] = useState<string>('')
  const [initCommands, setInitCommands] = useState<string[]>([])
  const [savedInitCommands, setSavedInitCommands] = useState<string[]>([])
  const [initCommandsLoading, setInitCommandsLoading] = useState(false)
  const [initCommandsSaving, setInitCommandsSaving] = useState(false)
  const [initCommandsError, setInitCommandsError] = useState<string | null>(null)
  const [initStatus, setInitStatus] = useState<InitStatusResponse | null>(null)
  const [initStatusLoading, setInitStatusLoading] = useState(false)
  const [initStatusError, setInitStatusError] = useState<string | null>(null)
  const [newCommandValue, setNewCommandValue] = useState('')
  const [editingCommandIndex, setEditingCommandIndex] = useState<number | null>(null)

  const existingProjectPlugins = useMemo(() => {
    const pluginSet = new Set<string>()
    for (const plugin of project?.plugins ?? []) {
      pluginSet.add(`${plugin.id}:${plugin.version}`)
    }
    return pluginSet
  }, [project?.plugins])

  const otherProjects = useMemo(
    () => (id ? allProjects.filter((p) => p.id !== id) : []),
    [allProjects, id],
  )

  const hasActiveRun = useMemo(() => {
    return runs.some((run) => 
      run.status === 'pending' || 
      run.status === 'running' || 
      run.status === 'stopping'
    )
  }, [runs])

  const resetAddPluginForms = useCallback(() => {
    setAddPluginError(null)
    setSelectedLibraryPlugin('')
  }, [])

  const openAddPluginPanel = useCallback(() => {
    resetAddPluginForms()
    setAddPluginOpen(true)
  }, [resetAddPluginForms])

  const closeAddPluginPanel = useCallback(() => {
    setAddPluginOpen(false)
    setAddPluginBusy(false)
    resetAddPluginForms()
  }, [resetAddPluginForms])

  const handleCopyFromProject = useCallback(async () => {
    if (!id || !copyFromSourceId) return
    setCopyFromBusy(true)
    setCopyFromError(null)
    try {
      const result = await copyProjectPluginsFrom(id, copyFromSourceId, {
        mode: copyFromMode,
      })
      const refreshed = await fetchProject(id)
      setProject(refreshed)
      setCopyFromOpen(false)
      setCopyFromSourceId('')
      const sourceName = otherProjects.find((p) => p.id === copyFromSourceId)?.name ?? 'project'
      const skipped = result.skippedPluginIds?.length ?? 0
      const copiedCount = result.copiedCount
      if (skipped > 0 && copiedCount !== undefined) {
        toast({ variant: 'success', title: `Copied ${copiedCount} plugins from ${sourceName}; ${skipped} already present and skipped.` })
      } else if (skipped > 0) {
        toast({ variant: 'success', title: `Plugins copied from ${sourceName}; ${skipped} already present and skipped.` })
      } else {
        toast({ variant: 'success', title: `Plugins copied from ${sourceName}.` })
      }
    } catch (err) {
      setCopyFromError(err instanceof Error ? err.message : 'Failed to copy plugins')
    } finally {
      setCopyFromBusy(false)
    }
  }, [id, copyFromSourceId, copyFromMode, otherProjects, toast])

  const handleRefreshLibrary = useCallback(async () => {
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      const items = await fetchPluginLibrary()
      setLibraryPlugins(items)
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : 'Failed to load plugin library.')
    } finally {
      setLibraryLoading(false)
    }
  }, [])

  const {
    run: queueBuild,
    busy: queueBuildBusy,
  } = useAsyncAction(
    async (options?: BuildOptions) => {
      if (!id) {
        throw new Error('Project identifier missing.')
      }
      return triggerBuild(id, undefined, options)
    },
    {
      label: 'Triggering build',
      successToast: (build) => ({
        title: 'Build queued',
        description: `Build ${build.id} is running.`,
        variant: 'success',
      }),
      errorToast: (error) => ({
        title: 'Build failed to queue',
        description: error instanceof Error ? error.message : 'Failed to queue build',
        variant: 'danger',
      }),
    },
  )

  const {
    run: generateManifest,
    busy: generateManifestBusy,
  } = useAsyncAction(
    async () => {
      if (!id) {
        throw new Error('Project identifier missing.')
      }
      return triggerManifest(id)
    },
    {
      label: 'Generating manifest',
      successToast: (manifest) => ({
        title: 'Manifest generated',
        description: manifest.manifest?.lastBuildId
          ? `Build ${manifest.manifest.lastBuildId}`
          : 'Latest manifest is ready.',
        variant: 'success',
      }),
      errorToast: (error) => ({
        title: 'Manifest generation failed',
        description: error instanceof Error ? error.message : 'Manifest generation failed',
        variant: 'danger',
      }),
    },
  )

  const {
    run: scanAssets,
    busy: scanAssetsBusy,
  } = useAsyncAction(
    async () => {
      if (!id) {
        throw new Error('Project identifier missing.')
      }
      const assets = await scanProjectAssets(id)
      // Update project state with scanned assets
      setProject((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          plugins: assets.plugins,
          configs: assets.configs,
        }
      })
      // Clear configFiles so it falls back to project.configs which we just updated
      setConfigFiles([])
      return assets
    },
    {
      label: 'Scanning assets',
      successToast: (assets) => {
        const pluginConfigTotal = assets.configs.filter(
          (entry) =>
            entry.pluginId !== undefined ||
            entry.definitionId !== undefined ||
            entry.path.startsWith('plugins/'),
        ).length
        return {
          title: 'Assets scanned',
          description: `Found ${assets.plugins.length} plugins and ${pluginConfigTotal} plugin configs.`,
          variant: 'success',
        }
      },
      errorToast: (error) => ({
        title: 'Asset scan failed',
        description: error instanceof Error ? error.message : 'Asset scan failed',
        variant: 'danger',
      }),
    },
  )

  const {
    run: queueRunLocally,
    busy: runLocallyBusy,
  } = useAsyncAction(
    async () => {
      if (!id) {
        throw new Error('Project identifier missing.')
      }
      const options = runOptions.resetWorld || runOptions.resetPlugins || runOptions.useSnapshot ? runOptions : undefined;
      return runProjectLocally(id, options)
    },
    {
      label: 'Starting local run',
      successToast: (run) => ({
        title: 'Run queued',
        description: `Run ${run.id} status: ${run.status.toUpperCase()}`,
        variant: 'success',
      }),
      errorToast: (error) => ({
        title: 'Run failed',
        description: error instanceof Error ? error.message : 'Run failed to queue',
        variant: 'danger',
      }),
      onSuccess: (run) => {
        setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)])
        setShowRunOptions(false)
        setRunOptions({ resetWorld: false, resetPlugins: false, useSnapshot: false })
      },
    },
  )

  const {
    run: resetWorkspaceAction,
    busy: resetWorkspaceBusy,
  } = useAsyncAction(
    async () => {
      if (!id) {
        throw new Error('Project identifier missing.')
      }
      return resetProjectWorkspace(id)
    },
    {
      label: 'Resetting workspace',
      onSuccess: () => {
        setRunsError(null)
      },
      successToast: (result) => ({
        title: 'Workspace reset',
        description: `Workspace path ${result.workspacePath} reset to latest artifact on next run.`,
        variant: 'success',
      }),
      errorToast: (error) => ({
        title: 'Workspace reset failed',
        description: error instanceof Error ? error.message : 'Failed to reset workspace',
        variant: 'danger',
      }),
    },
  )

  const {
    run: syncRepository,
    busy: syncRepositoryBusy,
  } = useAsyncAction(
    async () => {
      if (!id) {
        throw new Error('Project identifier missing.')
      }
      if (!project?.repo) {
        throw new Error('Project does not have a linked repository.')
      }
      return syncProjectRepository(id)
    },
    {
      label: 'Syncing repository',
      successToast: (result) => ({
        title: 'Repository synced',
        description: `Definition files committed to repository (${result.commitSha.slice(0, 7)})`,
        variant: 'success',
      }),
      errorToast: (error) => ({
        title: 'Sync failed',
        description: error instanceof Error ? error.message : 'Failed to sync repository',
        variant: 'danger',
      }),
      onSuccess: () => {
        // Refresh project to get updated commit SHA if needed
        if (id) {
          void fetchProject(id).then(setProject).catch(() => null)
        }
      },
    },
  )

  const busy = queueBuildBusy || generateManifestBusy || scanAssetsBusy || runLocallyBusy || syncRepositoryBusy

  const loadConfigs = useCallback(async () => {
    if (!id) return
    try {
      setConfigsLoading(true)
      const files = await fetchProjectConfigs(id)
      setConfigFiles(files)
      setConfigsError(null)
    } catch (err) {
      setConfigsError(err instanceof Error ? err.message : 'Failed to load config files.')
    } finally {
      setConfigsLoading(false)
    }
  }, [id])

  const pluginDefinitionOptions = useMemo(() => {
    const map: Record<string, Array<{ definitionId: string; path: string; label: string }>> = {}
    const formatOption = (definitionId: string, path: string, label?: string) => {
      const base = (label ?? definitionId).trim()
      return {
        definitionId,
        path,
        label: path ? `${base} · ${path}` : base,
      }
    }

    for (const plugin of project?.plugins ?? []) {
      const mappings = plugin.configMappings ?? []
      map[plugin.id] = mappings
        .filter((mapping): mapping is Extract<ProjectPluginConfigMapping, { type: 'library' }> => 
          mapping.type === 'library'
        )
        .map((mapping) =>
          formatOption(mapping.definitionId, '', mapping.definitionId),
        )
      const cachedDefinitions = pluginDefinitionCache[plugin.id]
      if (cachedDefinitions) {
        map[plugin.id] = cachedDefinitions.map((definition) =>
          formatOption(
            definition.id,
            definition.resolvedPath ?? definition.defaultPath ?? '',
            definition.label ?? definition.id,
          ),
        )
      }
    }
    return map
  }, [pluginDefinitionCache, project?.plugins])

  const selectedDefinitionOptions = pluginDefinitionOptions[configUploadPlugin] ?? []
  const selectedDefinition = selectedDefinitionOptions.find(
    (option) => option.definitionId === configUploadDefinition,
  )

  useEffect(() => {
    if (!id || !project?.plugins) {
      return
    }
    const missing = project.plugins
      .map((plugin) => plugin.id)
      .filter((pluginId) => !pluginDefinitionCache[pluginId])
    if (missing.length === 0) {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const results = await Promise.all(
          missing.map(async (pluginId) => {
            try {
              const data = await fetchProjectPluginConfigs(id, pluginId)
              return { pluginId, definitions: data.definitions }
            } catch (error) {
              console.error(`Failed to fetch config definitions for ${pluginId}`, error)
              return null
            }
          }),
        )
        if (cancelled) {
          return
        }
        setPluginDefinitionCache((prev) => {
          const next = { ...prev }
          for (const result of results) {
            if (result) {
              next[result.pluginId] = result.definitions
            }
          }
          return next
        })
      } catch (error) {
        console.error('Failed to prefetch plugin config definitions', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchProjectPluginConfigs, id, pluginDefinitionCache, project?.plugins])

  const handleAddLibraryPlugin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!id) {
        setAddPluginError('Project identifier missing.')
        return
      }
      if (!selectedLibraryPlugin) {
        setAddPluginError('Select a plugin to add.')
        return
      }

      const target = libraryPlugins.find(
        (plugin) => `${plugin.id}:${plugin.version}` === selectedLibraryPlugin,
      )
      if (!target) {
        setAddPluginError('Selected plugin is no longer available in the library.')
        return
      }

      setAddPluginBusy(true)
      setAddPluginError(null)
      try {
        const plugins = await addProjectPlugin(id, {
          pluginId: target.id,
          version: target.version,
          provider: target.provider,
          downloadUrl: target.source?.downloadUrl,
          minecraftVersionMin: target.minecraftVersionMin ?? target.source?.minecraftVersionMin,
          minecraftVersionMax: target.minecraftVersionMax ?? target.source?.minecraftVersionMax,
          cachePath: target.cachePath ?? target.source?.cachePath,
          source: target.source ? { ...target.source } : undefined,
        })
        setProject((prev) => (prev ? { ...prev, plugins: plugins ?? [] } : prev))
        toast({
          title: 'Plugin added',
          description: `${target.id} v${target.version} added to project.`,
          variant: 'success',
        })
        closeAddPluginPanel()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add plugin.'
        setAddPluginError(message)
        toast({
          title: 'Failed to add plugin',
          description: message,
          variant: 'danger',
        })
      } finally {
        setAddPluginBusy(false)
      }
    },
    [
      addProjectPlugin,
      closeAddPluginPanel,
      id,
      libraryPlugins,
      selectedLibraryPlugin,
      setProject,
      toast,
    ],
  )


  useEffect(() => {
    if (configUploadPlugin && !pluginDefinitionOptions[configUploadPlugin]) {
      setConfigUploadPlugin('')
      setConfigUploadDefinition('')
      setConfigUploadPath('')
      setConfigUploadPathDirty(false)
    }
  }, [configUploadPathDirty, configUploadPlugin, pluginDefinitionOptions])

  useEffect(() => {
    if (!configUploadPlugin) {
      return
    }
    const options = pluginDefinitionOptions[configUploadPlugin] ?? []
    if (options.length === 0) {
      if (configUploadDefinition) {
        setConfigUploadDefinition('')
      }
      if (!configUploadPathDirty && configUploadPath) {
        setConfigUploadPath('')
      }
      return
    }
    if (configUploadDefinition === '') {
      return
    }
    const match = options.find((option) => option.definitionId === configUploadDefinition)
    if (!match) {
      const [firstOption] = options
      if (!firstOption) {
        return
      }
      setConfigUploadDefinition(firstOption.definitionId)
      setConfigUploadPath(firstOption.path)
      setConfigUploadPathDirty(false)
      return
    }
    if (!configUploadPathDirty && match.path !== configUploadPath) {
      setConfigUploadPath(match.path)
    }
  }, [
    configUploadDefinition,
    configUploadPath,
    configUploadPathDirty,
    configUploadPlugin,
    pluginDefinitionOptions,
  ])

  const { run: requestStopRun } = useAsyncAction(
    async (target: RunJob) => stopRunJob(target.id),
    {
      label: (target) => `Stopping ${target.id}`,
      onStart: (target) => {
        setRunBusy((prev) => ({ ...prev, [target.id]: true }))
      },
      onSuccess: (updated) => {
        setRuns((prev) =>
          prev.map((run) => (run.id === updated.id ? { ...run, ...updated } : run)),
        )
        setRunsError(null)
      },
      onError: (error) => {
        setRunsError(error instanceof Error ? error.message : 'Failed to stop run')
      },
      onFinally: (target) => {
        setRunBusy((prev) => {
          const next = { ...prev }
          delete next[target.id]
          return next
        })
      },
      successToast: (_updated, [target]) => ({
        title: 'Stopping run',
        description: `Stop requested for ${target.id}.`,
        variant: 'warning',
      }),
      errorToast: (error) => ({
        title: 'Failed to stop run',
        description: error instanceof Error ? error.message : 'Failed to stop run',
        variant: 'danger',
      }),
    },
  )

  const { run: dispatchRunCommand } = useAsyncAction(
    async (target: RunJob, command: string) => {
      await sendRunCommand(target.id, command)
    },
    {
      label: (target) => `Sending command to ${target.id}`,
      onStart: (target) => {
        setCommandBusy((prev) => ({ ...prev, [target.id]: true }))
      },
      onSuccess: (_result, [target]) => {
        setCommandInputs((prev) => ({ ...prev, [target.id]: '' }))
        setRunsError(null)
      },
      onError: (error) => {
        setRunsError(error instanceof Error ? error.message : 'Failed to send command')
      },
      onFinally: (target) => {
        setCommandBusy((prev) => {
          const next = { ...prev }
          delete next[target.id]
          return next
        })
      },
      errorToast: (error) => ({
        title: 'Command failed',
        description: error instanceof Error ? error.message : 'Failed to send command',
        variant: 'danger',
      }),
    },
  )

  useEffect(() => {
    runs.forEach((run) => {
      const element = logRefs.current[run.id]
      if (element) {
        let scrollableParent: HTMLElement | null = element.parentElement
        while (scrollableParent) {
          const style = window.getComputedStyle(scrollableParent)
          if (
            scrollableParent.scrollHeight > scrollableParent.clientHeight &&
            (style.overflow === 'auto' || style.overflow === 'scroll' || style.overflowY === 'auto' || style.overflowY === 'scroll')
          ) {
            scrollableParent.scrollTop = scrollableParent.scrollHeight
            break
          }
          scrollableParent = scrollableParent.parentElement
        }
      }
    })
  }, [runs])

  const handleCommandChange = useCallback((runId: string, value: string) => {
    setCommandInputs((prev) => ({ ...prev, [runId]: value }))
  }, [])

  useEffect(() => {
    if (!addPluginOpen) {
      return
    }
    if (libraryLoading || libraryPlugins.length > 0 || libraryError) {
      return
    }
    void handleRefreshLibrary()
  }, [
    addPluginOpen,
    handleRefreshLibrary,
    libraryError,
    libraryLoading,
    libraryPlugins.length,
  ])

  useEffect(() => {
    if (!id) return
    let cancelled = false

    const load = async () => {
      try {
        if (initialLoadRef.current) {
          setLoading(true)
        }
        const runsPromise = initialLoadRef.current
          ? fetchProjectRuns(id)
          : Promise.resolve<RunJob[] | null>(null)
        const [proj, projBuilds, projRuns] = await Promise.all([
          fetchProject(id),
          fetchBuilds(id),
          runsPromise,
        ])
        if (cancelled) return
        setProject(proj)
        setBuilds(projBuilds)
        if (projRuns) {
          setRuns(projRuns)
        }
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled && initialLoadRef.current) {
          setLoading(false)
          initialLoadRef.current = false
        }
      }
    }

    load()
    const interval = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    const loadProjects = async () => {
      try {
        const projects = await fetchProjects()
        if (!cancelled) {
          setAllProjects(projects)
        }
      } catch (err) {
        console.error('Failed to load projects for snapshot selector', err)
      }
    }
    loadProjects()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!id) return
    if (typeof window === 'undefined') return

    const base =
      API_BASE.startsWith('http://') || API_BASE.startsWith('https://')
        ? API_BASE
        : `${window.location.origin}${API_BASE}`
    const urlBase = base.endsWith('/') ? base.slice(0, -1) : base
    const source = new EventSource(`${urlBase}/runs/stream?projectId=${encodeURIComponent(id)}`, {
      withCredentials: true,
    })

    const mergeRun = (incoming: RunJob) => {
      setRuns((prev) => {
        const normalized: RunJob = {
          ...incoming,
          logs: Array.isArray(incoming.logs) ? incoming.logs : [],
        }
        const existingIndex = prev.findIndex((run) => run.id === normalized.id)
        if (existingIndex >= 0) {
          const existing = prev[existingIndex]
          const merged: RunJob = {
            ...existing,
            ...normalized,
            logs:
              normalized.logs && normalized.logs.length > 0
                ? normalized.logs
                : existing.logs ?? [],
          }
          const next = prev.slice()
          next[existingIndex] = merged
          return next
        }
        return [normalized, ...prev]
      })
    }

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
        }
      } catch (err) {
        console.error('Failed to parse run stream init payload', err)
      }
    }

    const handleRunUpdate = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { run: RunJob }
        if (payload.run) {
          mergeRun(payload.run)
        }
      } catch (err) {
        console.error('Failed to parse run update payload', err)
      }
    }

    const handleRunLog = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          runId: string
          entry: RunLogEntry
        }
        if (!payload.runId || !payload.entry) {
          return
        }
        setRuns((prev) => {
          const index = prev.findIndex((run) => run.id === payload.runId)
          if (index === -1) {
            return prev
          }
          const target = prev[index]
          const nextLogs = [...(target.logs ?? []), payload.entry].slice(-500)
          const nextRun: RunJob = { ...target, logs: nextLogs }
          const next = prev.slice()
          next[index] = nextRun
          return next
        })
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
  }, [id])

useEffect(() => {
  void loadConfigs()
}, [loadConfigs])

  useEffect(() => {
    if (!id || activeTab !== 'init-commands') {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        setInitStatusLoading(true)
        setInitStatusError(null)
        const status = await fetchInitStatus(id)
        if (!cancelled) {
          setInitStatus(status)
        }
      } catch (err) {
        if (!cancelled) {
          setInitStatusError(err instanceof Error ? err.message : 'Failed to load initialization status')
        }
      } finally {
        if (!cancelled) {
          setInitStatusLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, activeTab])

  useEffect(() => {
    if (!id || activeTab !== 'init-commands') {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        setInitCommandsLoading(true)
        setInitCommandsError(null)
        const profile = await fetchProjectProfile(id)
        if (cancelled) return
        
        if (!profile) {
          setInitCommands([])
          return
        }

        try {
          const parsed = YAML.parse(profile.yaml) as { initCommands?: string[] | Array<{ type?: string; command: string; plugin?: string; description?: string }> }
          const commands = parsed.initCommands ?? []
          
          const normalizedCommands = commands.map((cmd) => {
            if (typeof cmd === 'string') {
              return cmd
            }
            return cmd.command
          })
          
          if (!cancelled) {
            setInitCommands(normalizedCommands)
            setSavedInitCommands(normalizedCommands)
          }
        } catch (parseError) {
          if (!cancelled) {
            setInitCommandsError('Failed to parse profile YAML')
            console.error('Failed to parse profile YAML', parseError)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setInitCommandsError(err instanceof Error ? err.message : 'Failed to load profile')
        }
      } finally {
        if (!cancelled) {
          setInitCommandsLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, activeTab])

  useEffect(() => {
    if (!project?.repo) {
      setDeleteRepo(false)
    }
  }, [project?.repo])

  const latestBuild = useMemo(
    () => builds.find((build) => build.status === 'succeeded'),
    [builds],
  )

  const handleRemovePlugin = useCallback(
    async (pluginId: string) => {
      if (!id) return
      if (!window.confirm(`Remove plugin ${pluginId} from this project?`)) {
        return
      }
      try {
        const plugins = await deleteProjectPlugin(id, pluginId)
        setProject((prev) => (prev ? { ...prev, plugins: plugins ?? [] } : prev))
        toast({
          title: 'Plugin removed',
          description: `${pluginId} removed from project.`,
          variant: 'warning',
        })
      } catch (err) {
        toast({
          title: 'Failed to remove plugin',
          description: err instanceof Error ? err.message : 'Failed to remove plugin.',
          variant: 'danger',
        })
      }
    },
    [id, toast],
  )

  const handleUploadConfig = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!id) return
      
      // Get the actual form value in case state is stale
      const form = event.currentTarget
      const templateSelect = form.querySelector<HTMLSelectElement>('#config-upload-definition')
      const actualDefinitionValue = templateSelect?.value || configUploadDefinition
      
      let finalPath = configUploadPath.trim()
      let selectedDefinition: { definitionId: string; path: string; label: string } | undefined
      
      if (configUploadType === 'template') {
        const options = pluginDefinitionOptions[configUploadPlugin] ?? []
        
        // If definitionId is not set but path is, try to find it from the path
        // Also check the actual form element value in case state is stale
        let definitionId = actualDefinitionValue?.trim() || configUploadDefinition?.trim()
        if (!definitionId && configUploadPath.trim()) {
          const foundByPath = options.find((option) => option.path === configUploadPath.trim())
          if (foundByPath) {
            definitionId = foundByPath.definitionId
          }
        }
        
        if (!definitionId) {
          setConfigsError('Config template is required.')
          return
        }
        
        // Verify the selected definition exists in the options
        selectedDefinition = options.find((option) => option.definitionId === definitionId)
        if (!selectedDefinition) {
          setConfigsError('Please select a valid config template.')
          return
        }
        
        // Ensure path is set from the selected definition
        if (!finalPath && selectedDefinition.path) {
          finalPath = selectedDefinition.path
          setConfigUploadPath(selectedDefinition.path)
        }
        
        // Update the definitionId in case we found it by path
        if (definitionId !== configUploadDefinition?.trim()) {
          setConfigUploadDefinition(definitionId)
        }
        
        // Final validation - path must be set
        if (!finalPath) {
          setConfigsError('Config path is required. Please select a valid template.')
          return
        }
      } else {
        if (!configUploadName.trim() || !finalPath) {
          setConfigsError('Config name and path are required.')
          return
        }
      }
      
      if (!configUploadFile) {
        setConfigsError('Config file is required.')
        return
      }
      
      // Final validation - path must be set
      if (!finalPath) {
        setConfigsError('Config path is required.')
        return
      }
      
      try {
        setConfigUploadBusy(true)
        
        const isReplacement = configFiles.some((f) => f.path === finalPath)
        
        // Determine payload based on type
        const payload: {
          path: string
          file: File
          type: 'library' | 'custom'
          pluginId?: string
          definitionId?: string
          customId?: string
          label?: string
        } = {
          path: finalPath,
          file: configUploadFile,
          type: configUploadType === 'template' ? 'library' : 'custom',
        }
        
        if (configUploadPlugin.trim()) {
          payload.pluginId = configUploadPlugin.trim()
        }
        
        if (configUploadType === 'template') {
          // Get the definitionId - use the one we validated/found above
          const options = pluginDefinitionOptions[configUploadPlugin] ?? []
          let definitionId = actualDefinitionValue?.trim() || configUploadDefinition?.trim()
          if (!definitionId && configUploadPath.trim()) {
            const foundByPath = options.find((option) => option.path === configUploadPath.trim())
            if (foundByPath) {
              definitionId = foundByPath.definitionId
            }
          }
          if (definitionId) {
            payload.definitionId = definitionId
          } else {
            setConfigsError('Config template is required.')
            return
          }
        } else {
          payload.customId = `custom/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
          payload.label = configUploadName.trim()
        }
        
        const configs = await uploadProjectConfig(id, payload)
        setConfigFiles(configs)
        setConfigsError(null)
        toast({
          title: isReplacement ? 'Config replaced' : 'Config uploaded',
          description: `${configUploadPath.trim()} ${isReplacement ? 'replaced' : 'uploaded'} successfully.`,
          variant: 'success',
        })
        setConfigUploadPath('')
        setConfigUploadFile(null)
        setConfigUploadPlugin('')
        setConfigUploadType('template')
        setConfigUploadDefinition('')
        setConfigUploadName('')
        setConfigUploadPathDirty(false)
        setConfigUploadModalOpened(false)
        if (event.currentTarget instanceof HTMLFormElement) {
          event.currentTarget.reset()
        }
        if (configUploadFileInputRef.current) {
          configUploadFileInputRef.current.value = ''
        }
        if (configUploadPlugin) {
          void fetchProjectPluginConfigs(id, configUploadPlugin)
            .then((data) => {
              setPluginDefinitionCache((prev) => ({
                ...prev,
                [configUploadPlugin]: data.definitions,
              }))
            })
            .catch(() => {
              // Ignore errors, cache will update on next load
            })
        }
      } catch (err) {
        setConfigsError(err instanceof Error ? err.message : 'Failed to upload config file.')
      } finally {
        setConfigUploadBusy(false)
      }
    },
    [
      configUploadType,
      configUploadDefinition,
      configUploadName,
      configUploadFile,
      configUploadPath,
      configUploadPlugin,
      configFiles,
      id,
      pluginDefinitionCache,
      pluginDefinitionOptions,
      toast,
    ],
  )

  const handleEditConfig = useCallback(
    async (path: string) => {
      if (!id) return
      try {
        const file = await fetchProjectConfigFile(id, path)
        setConfigEditor({ path: file.path, content: file.content })
        setConfigEditorError(null)
      } catch (err) {
        setConfigsError(err instanceof Error ? err.message : 'Failed to load config file.')
      }
    },
    [id],
  )

  const handleReplaceConfig = useCallback(
    (file: ProjectConfigSummary) => {
      setConfigUploadPath(file.path)
      setConfigUploadPathDirty(false)
      setConfigUploadPlugin(file.pluginId ?? '')
      setConfigUploadDefinition(file.definitionId ?? '')
      setConfigUploadFile(null)
      setConfigsError(null)
      setConfigUploadModalOpened(true)
      setTimeout(() => {
        configUploadFileInputRef.current?.click()
      }, 100)
    },
    [],
  )

  const handleSaveConfig = useCallback(async () => {
    if (!id || !configEditor) return
    try {
      setConfigEditorBusy(true)
      setConfigEditorError(null)
      await updateProjectConfigFile(id, configEditor)
      setConfigEditor(null)
      await loadConfigs()
    } catch (err) {
      setConfigEditorError(err instanceof Error ? err.message : 'Failed to save configuration.')
    } finally {
      setConfigEditorBusy(false)
    }
  }, [configEditor, id, loadConfigs])

  const handleCustomPathSubmit = useCallback(
    async (data: Omit<CustomPathModalState, 'opened'>) => {
      if (!id) return
      const currentMappings = project?.plugins?.find((p) => p.id === data.pluginId)?.configMappings ?? []
      const existingIndex = data.definitionId
        ? currentMappings.findIndex((m) => 
            m.type === 'custom' && m.customId === data.definitionId
          )
        : -1
      const customId = data.definitionId ?? `custom/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      const newMapping: ProjectPluginConfigMapping = {
        type: 'custom',
        customId,
        label: data.label.trim(),
        path: data.path.trim(),
        notes: data.notes.trim() || undefined,
      }
      const updatedMappings =
        existingIndex >= 0
          ? currentMappings.map((m, i) => (i === existingIndex ? newMapping : m))
          : [...currentMappings, newMapping]
      const response = await updateProjectPluginConfigs(id, data.pluginId, {
        mappings: updatedMappings,
      })
      setPluginDefinitionCache((prev) => ({
        ...prev,
        [data.pluginId]: response.definitions,
      }))
      setProject((prev) =>
        prev
          ? {
              ...prev,
              plugins: prev.plugins?.map((p) =>
                p.id === data.pluginId ? { ...p, configMappings: response.mappings } : p,
              ),
            }
          : prev,
      )
      toast({
        title: data.definitionId ? 'Custom path updated' : 'Custom path added',
        description: `${data.path.trim()} ${data.definitionId ? 'updated' : 'added'} successfully.`,
        variant: 'success',
      })
    },
    [id, project?.plugins, toast],
  )

  const handleEditCustomPath = useCallback(
    (data: Omit<CustomPathModalState, 'opened'>) => {
      setCustomPathModal({
        opened: true,
        ...data,
      })
    },
    [],
  )

  const handleRemoveCustomPath = useCallback(
    (data: { pluginId: string; definitionId: string; path: string }) => {
      setRemoveCustomPathConfirm(data)
    },
    [],
  )

  const handleAddCustomPath = useCallback((pluginId: string) => {
    setCustomPathModal({
      opened: true,
      pluginId,
      label: '',
      path: '',
      notes: '',
    })
  }, [])

  const handleDeleteProject = useCallback(async () => {
    if (!id || !project) {
      return
    }
    const warning = deleteRepo && project.repo
      ? `Delete project “${project.name}” and its GitHub repository (${project.repo.fullName})? This cannot be undone.`
      : `Delete project “${project.name}”? This cannot be undone.`
    if (!window.confirm(warning)) {
      return
    }
    try {
      setDeleteBusy(true)
      setDeleteError(null)
      await deleteProject(id, { deleteRepo: deleteRepo && Boolean(project.repo) })
      toast({
        title: 'Project deleted',
        description: `${project.name} removed successfully.`,
        variant: 'warning',
      })
      navigate('/projects')
    } catch (err) {
      const description = err instanceof Error ? err.message : 'Failed to delete project.'
      setDeleteError(description)
      toast({
        title: 'Delete failed',
        description,
        variant: 'danger',
      })
    } finally {
      setDeleteBusy(false)
    }
  }, [deleteRepo, id, navigate, project, toast])

  const handleSaveInitCommands = useCallback(async () => {
    if (!id) return
    try {
      setInitCommandsSaving(true)
      setInitCommandsError(null)
      const profile = await fetchProjectProfile(id)
      if (!profile) {
        throw new Error('Profile not found')
      }
      const parsed = YAML.parse(profile.yaml) as Record<string, unknown>
      parsed.initCommands = initCommands
      const updatedYaml = YAML.stringify(parsed)
      await saveProjectProfile(id, { yaml: updatedYaml })
      setSavedInitCommands([...initCommands])
      toast({
        title: 'Commands saved',
        description: 'Init commands saved to profile.',
        variant: 'success',
      })
    } catch (err) {
      setInitCommandsError(err instanceof Error ? err.message : 'Failed to save commands')
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save init commands',
        variant: 'danger',
      })
    } finally {
      setInitCommandsSaving(false)
    }
  }, [id, initCommands, toast])

  const hasUnsavedChanges = useMemo(() => {
    if (initCommands.length !== savedInitCommands.length) {
      return true
    }
    return initCommands.some((cmd, index) => cmd !== savedInitCommands[index])
  }, [initCommands, savedInitCommands])

  if (!id) {
    return (
      <ContentSection as="section">
        <p className="error-text">Project identifier missing.</p>
      </ContentSection>
    )
  }

  const pluginConfigFiles = useMemo(() => {
    const source =
      configFiles.length > 0
        ? configFiles
        : (project?.configs as ProjectConfigSummary[] | undefined) ?? []
    return source.filter(
      (entry) =>
        entry.pluginId !== undefined ||
        entry.definitionId !== undefined ||
        entry.path.startsWith('plugins/'),
    )
  }, [configFiles, project?.configs])

  const pluginConfigFilesByPlugin = useMemo(() => {
    const groups: Record<string, ProjectConfigSummary[]> = {}
    for (const file of pluginConfigFiles) {
      const key = file.pluginId ?? 'No plugin'
      if (!groups[key]) groups[key] = []
      groups[key].push(file)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [pluginConfigFiles])

  const pluginConfigCount = pluginConfigFiles.length

  if (loading) {
    return (
      <div className="project-detail-loading">
        <Card className="project-summary-card">
          <CardHeader>
            <div className="project-summary-card__header">
              <div>
                <Skeleton style={{ width: '220px', height: '28px' }} />
                <Skeleton style={{ width: '160px', height: '18px', marginTop: '8px' }} />
              </div>
              <Skeleton style={{ width: '110px', height: '18px' }} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="project-summary-card__meta">
              {[0, 1, 2, 3].map((index) => (
                <div key={index}>
                  <Skeleton style={{ width: '72px', height: '12px' }} />
                  <Skeleton
                    style={{ width: '96px', height: '20px', marginTop: '8px', borderRadius: '8px' }}
                  />
                </div>
              ))}
            </div>
            <div className="project-summary-card__actions">
              {[0, 1, 2].map((index) => (
                <Skeleton
                  key={index}
                  style={{ width: '140px', height: '40px', borderRadius: '999px' }}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <ContentSection as="article">
          <header>
            <Skeleton style={{ width: '180px', height: '24px' }} />
          </header>
          <div className="layout-grid" style={{ gap: '16px', marginTop: '16px' }}>
            {[0, 1].map((index) => (
              <Skeleton key={index} style={{ width: '100%', height: '180px', borderRadius: '16px' }} />
            ))}
          </div>
        </ContentSection>
      </div>
    )
  }

  if (error) {
    return (
      <ContentSection as="section">
        <p className="error-text">{error}</p>
        <button
          type="button"
          className="ghost"
          onClick={() => navigate('/projects')}
        >
          Back to Projects
        </button>
      </ContentSection>
    )
  }

  if (!project) {
    return (
      <ContentSection as="section">
        <p className="error-text">Project not found.</p>
        <button
          type="button"
          className="ghost"
          onClick={() => navigate('/projects')}
        >
          Back to Projects
        </button>
      </ContentSection>
    )
  }

  const pluginCount = project.plugins?.length ?? 0
  const lastManifestGenerated =
    project.manifest?.generatedAt ? new Date(project.manifest.generatedAt).toLocaleString() : '—'

  return (
    <>
      <Card>
        <CardContent>
          <Stack gap="xl">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Title order={2}>{project.name}</Title>
                <Text size="sm" c="dimmed">
                  {[project.minecraftVersion, project.loader.toUpperCase(), project.source === 'imported' ? 'Imported' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Stack>
              <Anchor component={Link} to="/projects" size="sm">
                ← All Projects
              </Anchor>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 5 }} spacing="lg">
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Paper version
                </Text>
                {editingVersion ? (
                  <Group gap="xs" align="flex-end">
                    <TextInput
                      value={versionValue}
                      onChange={(e) => setVersionValue(e.currentTarget.value)}
                      placeholder="e.g., 1.21.11-54"
                      size="sm"
                      style={{ flex: 1 }}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      loading={versionBusy}
                      onClick={async () => {
                        if (!versionValue.trim()) {
                          toast({ variant: 'danger', description: 'Version cannot be empty' })
                          return
                        }
                        try {
                          setVersionBusy(true)
                          const updated = await updateProject(id!, {
                            minecraftVersion: versionValue.trim(),
                          })
                          setProject(updated)
                          setEditingVersion(false)
                          toast({ variant: 'success', description: 'Version updated' })
                        } catch (err) {
                          toast({ variant: 'danger', description: err instanceof Error ? err.message : 'Failed to update version' })
                        } finally {
                          setVersionBusy(false)
                        }
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingVersion(false)
                        setVersionValue(project.minecraftVersion)
                      }}
                    >
                      Cancel
                    </Button>
                  </Group>
                ) : (
                  <Group gap="xs" align="center">
                    <Text fw={600}>{project.minecraftVersion}</Text>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setVersionValue(project.minecraftVersion)
                        setEditingVersion(true)
                      }}
                    >
                      Edit
                    </Button>
                  </Group>
                )}
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Loader
                </Text>
                <Text fw={600}>{project.loader.toUpperCase()}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Plugins
                </Text>
                <Text fw={600}>{pluginCount}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Plugin configs
                </Text>
                <Text fw={600}>{pluginConfigCount}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Last manifest
                </Text>
                <Text fw={600}>{lastManifestGenerated}</Text>
              </Stack>
            </SimpleGrid>

            <Group gap="sm" wrap="wrap">
              <Button
                variant="ghost"
                icon={<MagnifyingGlass size={18} weight="bold" aria-hidden="true" />}
                onClick={() => void scanAssets()}
                disabled={busy}
              >
                Scan assets
              </Button>
              <Button
                variant="ghost"
                icon={<FileText size={18} weight="fill" aria-hidden="true" />}
                onClick={() => void generateManifest()}
                disabled={busy}
              >
                Generate manifest
              </Button>
              <Button
                variant="primary"
                icon={<PackageIcon size={18} weight="fill" aria-hidden="true" />}
                onClick={() => setShowBuildOptions(true)}
                disabled={busy}
              >
                Trigger build
              </Button>
              <Button
                variant="pill"
                icon={<Play size={18} weight="fill" aria-hidden="true" />}
                onClick={() => setShowRunOptions(true)}
                disabled={busy}
              >
                Run locally
              </Button>
              {project?.repo && (
                <Button
                  variant="secondary"
                  icon={<ArrowsClockwise size={18} weight="bold" aria-hidden="true" />}
                  onClick={() => void syncRepository()}
                  disabled={busy}
                >
                  Sync to repository
                </Button>
              )}
            </Group>
          </Stack>
        </CardContent>
      </Card>

      <ContentSection as="section" padding="xl">
        <Tabs value={activeTab} onChange={(value) => setActiveTab(value ?? 'overview')}>
          <Tabs.List>
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="profile">Profile</Tabs.Tab>
            <Tabs.Tab value="plugins">Plugins</Tabs.Tab>
            <Tabs.Tab value="configs">Config Files</Tabs.Tab>
            <Tabs.Tab value="init-commands">Start Commands</Tabs.Tab>
            <Tabs.Tab value="builds">Builds</Tabs.Tab>
            <Tabs.Tab 
              value="runs"
              leftSection={hasActiveRun ? <Play size={14} weight="fill" aria-hidden="true" /> : undefined}
            >
              Runs
            </Tabs.Tab>
            <Tabs.Tab value="snapshot">World Snapshot</Tabs.Tab>
            <Tabs.Tab value="settings">Settings</Tabs.Tab>
          </Tabs.List>
            <Tabs.Panel value="overview">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="sm">
                      <Group justify="space-between" align="flex-start">
                        <Title order={3}>Description</Title>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDescriptionModalOpen(true)}
                        >
                          {project.description ? 'Edit' : 'Add'}
                        </Button>
                      </Group>
                      <Text 
                        size="sm" 
                        c={project.description ? undefined : 'dimmed'} 
                        style={{ minHeight: '20px', whiteSpace: 'pre-wrap' }}
                      >
                        {project.description || 'No description'}
                      </Text>
                    </Stack>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Stack gap="sm">
                      <Group justify="space-between" align="flex-start">
                        <Title order={3}>Plugins</Title>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setActiveTab('plugins')}
                        >
                          View all
                        </Button>
                      </Group>
                      {project.plugins && project.plugins.length > 0 ? (
                        <Stack gap={4}>
                          {project.plugins
                            .slice()
                            .sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }))
                            .slice(0, 10)
                            .map((plugin) => (
                            <Group key={`${plugin.id}:${plugin.version}`} gap="xs" wrap="nowrap">
                              <Text size="sm" fw={500} style={{ flex: 1 }}>
                                {plugin.id}
                              </Text>
                              <Text size="sm" c="dimmed">
                                v{plugin.version}
                              </Text>
                              {plugin.provider && plugin.provider !== 'custom' && (
                                <Badge variant="accent">
                                  {plugin.provider}
                                </Badge>
                              )}
                            </Group>
                          ))}
                          {project.plugins.length > 10 && (
                            <Text size="sm" c="dimmed">
                              +{project.plugins.length - 10} more
                            </Text>
                          )}
                        </Stack>
                      ) : (
                        <Text size="sm" c="dimmed">
                          No plugins configured yet.
                        </Text>
                      )}
                    </Stack>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <Title order={3}>Repository</Title>
                      {project.repo && (
                        <Anchor href={project.repo.htmlUrl} target="_blank" rel="noreferrer" size="sm">
                          View on GitHub
                        </Anchor>
                      )}
                    </Group>

                    {project.repo ? (
                      <Stack gap={4}>
                        <Text size="sm" c="dimmed">
                          Linked repo:
                        </Text>
                        <Text fw={600}>{project.repo.fullName}</Text>
                        <Text size="sm" c="dimmed">
                          Default branch: {project.repo.defaultBranch}
                        </Text>
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">
                        No GitHub repository linked.
                      </Text>
                    )}

                    {project.manifest && (
                      <Stack gap={2}>
                        <Text size="sm" c="dimmed">
                          Last build
                        </Text>
                        <Group gap="xs">
                          <Text fw={600}>{project.manifest.lastBuildId ?? '—'}</Text>
                          {project.manifest.commitSha && project.repo ? (
                            <Anchor
                              href={`${project.repo.htmlUrl.replace(/\.git$/, '')}/commit/${project.manifest.commitSha}`}
                              target="_blank"
                              rel="noreferrer"
                              size="sm"
                            >
                              {project.manifest.commitSha.slice(0, 7)}
                            </Anchor>
                          ) : (
                            <Text size="sm" c="dimmed">
                              No commit recorded
                            </Text>
                          )}
                        </Group>
                        {project.manifest.generatedAt && (
                          <Text size="sm" c="dimmed">
                            Generated {new Date(project.manifest.generatedAt).toLocaleString()}
                          </Text>
                        )}
                      </Stack>
                    )}
                    </Stack>
                  </CardContent>
                </Card>

              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="profile">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Title order={3}>Profile YAML</Title>
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => navigate(`/projects/${project.id}/profile`)}
                          disabled={busy}
                        >
                          Edit profile
                        </Button>
                      </Group>
                      <Text size="sm" c="dimmed">
                        The server profile keeps your build definition in sync. Save updates to{' '}
                        <Code>profiles/base.yml</Code> to control plugins, config templates, and overrides used in builds.
                      </Text>
                      <Text size="sm" c="dimmed">
                        Editing the profile will rescan assets automatically so manifests and builds stay aligned with your latest configuration.
                      </Text>
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="builds">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Title order={3}>Build History</Title>
                        {latestBuild?.artifactPath && (
                          <Anchor
                            href={`${API_BASE}/builds/${latestBuild.id}/artifact`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download latest artifact
                          </Anchor>
                        )}
                      </Group>
                      {builds.length === 0 && (
                        <Text size="sm" c="dimmed">No builds yet.</Text>
                      )}
                      {builds.length > 0 && (
                        <ScrollArea>
                          <Table>
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Build</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th>Created</Table.Th>
                                <Table.Th>Finished</Table.Th>
                                <Table.Th>Actions</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {builds.map((build) => (
                                <Table.Tr key={build.id}>
                                  <Table.Td>{build.manifestBuildId ?? build.id}</Table.Td>
                                  <Table.Td>{build.status.toUpperCase()}</Table.Td>
                                  <Table.Td>{new Date(build.createdAt).toLocaleString()}</Table.Td>
                                  <Table.Td>{build.finishedAt ? new Date(build.finishedAt).toLocaleString() : '—'}</Table.Td>
                                  <Table.Td>
                                    <Group gap="xs">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={async () => {
                                          try {
                                            const manifest = await fetchBuildManifest(build.id)
                                            setManifestPreview({
                                              buildId: build.manifestBuildId ?? build.id,
                                              content: manifest,
                                            })
                                          } catch (err) {
                                            toast({
                                              title: 'Failed to load manifest',
                                              description: err instanceof Error
                                                ? err.message
                                                : 'Failed to load manifest',
                                              variant: 'danger',
                                            })
                                          }
                                        }}
                                      >
                                        View Manifest
                                      </Button>
                                      {build.artifactPath && (
                                        <Anchor
                                          href={`${API_BASE}/builds/${build.id}/artifact`}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Download Artifact
                                        </Anchor>
                                      )}
                                    </Group>
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </ScrollArea>
                      )}
                    </Stack>
                  </CardContent>
                </Card>

                {manifestPreview && (
                  <Card>
                    <CardContent>
                      <Stack gap="md">
                        <Group justify="space-between" align="flex-start">
                          <Title order={3}>Manifest: {manifestPreview.buildId}</Title>
                          <Button variant="ghost" onClick={() => setManifestPreview(null)}>
                            Close
                          </Button>
                        </Group>
                        <ScrollArea>
                          <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(manifestPreview.content, null, 2)}
                          </Code>
                        </ScrollArea>
                      </Stack>
                    </CardContent>
                  </Card>
                )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="runs">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Title order={3}>Local Runs</Title>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void resetWorkspaceAction()}
                          disabled={resetWorkspaceBusy}
                        >
                          Reset workspace
                        </Button>
                      </Group>
                      {runsError && (
                        <Text size="sm" c="dimmed">Run controls: {runsError}</Text>
                      )}
                      {runs.length === 0 && (
                        <Text size="sm" c="dimmed">No local run activity yet.</Text>
                      )}
                      {runs.length > 0 && (
                        <Stack gap="md">
                          {runs.map((run) => (
                            <Card key={run.id} style={{ backgroundColor: 'var(--mantine-color-dark-7)' }}>
                              <CardContent>
                                <Stack gap="sm">
                                  <Group justify="space-between" align="flex-start">
                                    <Stack gap={4}>
                                      <Text fw={600}>{run.id}</Text>
                                      <Group gap="xs" wrap="wrap">
                                        <Badge variant="outline">{runStatusLabel[run.status]}</Badge>
                                        <Text size="sm" c="dimmed">
                                          Started {new Date(run.createdAt).toLocaleString()}
                                          {run.finishedAt && (
                                            <> · Finished {new Date(run.finishedAt).toLocaleString()}</>
                                          )}
                                        </Text>
                                      </Group>
                                      {run.port && (
                                        <Text size="sm" c="dimmed">Port: {run.port} (local)</Text>
                                      )}
                                      {run.containerName && (
                                        <Text size="sm" c="dimmed">Container: {run.containerName}</Text>
                                      )}
                                      {run.workspacePath && (
                                        <Text size="sm" c="dimmed">
                                          Workspace: <Code>{run.workspacePath}</Code>
                                        </Text>
                                      )}
                                      {run.workspaceStatus && (
                                        <Text size="sm" c="dimmed">
                                          Workspace build {run.workspaceStatus.lastBuildId ?? 'unknown'} · Last sync{' '}
                                          {run.workspaceStatus.lastSyncedAt
                                            ? new Date(run.workspaceStatus.lastSyncedAt).toLocaleString()
                                            : 'unknown'}
                                          {run.workspaceStatus.dirtyPaths.length > 0
                                            ? ` · ${run.workspaceStatus.dirtyPaths.length} local change${
                                                run.workspaceStatus.dirtyPaths.length === 1 ? '' : 's'
                                              }`
                                            : ' · In sync'}
                                        </Text>
                                      )}
                                    </Stack>
                                    {(run.status === 'running' ||
                                      run.status === 'pending' ||
                                      run.status === 'stopping') && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={run.status === 'stopping' || runBusy[run.id]}
                                        onClick={() => void requestStopRun(run)}
                                      >
                                        {run.status === 'stopping' || runBusy[run.id] ? 'Stopping…' : 'Stop'}
                                      </Button>
                                    )}
                                  </Group>

                                  {run.workspaceStatus?.dirtyPaths?.length ? (
                                    <Accordion>
                                      <Accordion.Item value="dirty-paths">
                                        <Accordion.Control>
                                          Local changes ({run.workspaceStatus.dirtyPaths.length})
                                        </Accordion.Control>
                                        <Accordion.Panel>
                                          <Stack gap={4}>
                                            {run.workspaceStatus.dirtyPaths.slice(0, 10).map((path) => (
                                              <Text key={path} size="sm" c="dimmed">
                                                {path}
                                              </Text>
                                            ))}
                                            {run.workspaceStatus.dirtyPaths.length > 10 && (
                                              <Text size="sm" c="dimmed">
                                                ...and {run.workspaceStatus.dirtyPaths.length - 10} more
                                              </Text>
                                            )}
                                          </Stack>
                                        </Accordion.Panel>
                                      </Accordion.Item>
                                    </Accordion>
                                  ) : null}

                                  <RunLogsAndConsole
                                    run={run}
                                    registerLogRef={(id, el) => {
                                      logRefs.current[id] = el
                                    }}
                                    commandValue={commandInputs[run.id] ?? ''}
                                    onCommandChange={(value) => handleCommandChange(run.id, value)}
                                    onSubmit={() => {
                                      const command = commandInputs[run.id]?.trim() ?? ''
                                      if (command) void dispatchRunCommand(run, command)
                                    }}
                                    onSendCommand={(command) => {
                                      void dispatchRunCommand(run, command)
                                    }}
                                    commandBusy={Boolean(commandBusy[run.id])}
                                  />

                                  {run.error && (
                                    <Alert color="red" title="Error">
                                      {run.error}
                                    </Alert>
                                  )}
                                </Stack>
                              </CardContent>
                            </Card>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="init-commands">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={4}>
                          <Title order={3}>Start Commands</Title>
                          {hasUnsavedChanges && (
                            <Text size="sm" c="orange">
                              You have unsaved changes
                            </Text>
                          )}
                        </Stack>
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => void handleSaveInitCommands()}
                          disabled={initCommandsSaving || initCommandsLoading || !hasUnsavedChanges}
                          icon={<FloppyDisk size={18} weight="fill" aria-hidden="true" />}
                        >
                          {initCommandsSaving ? 'Saving…' : 'Save Commands'}
                        </Button>
                      </Group>
                      <Text size="sm" c="dimmed">
                        Configure commands to execute automatically after the server starts. Commands are stored in your profile YAML and executed once per build. Add or edit commands below, then click "Save Commands" to persist your changes.
                      </Text>
                      {initCommandsError && (
                        <Alert color="red" title="Error">
                          {initCommandsError}
                        </Alert>
                      )}
                    </Stack>
                  </CardContent>
                </Card>

                <Group gap="lg" align="stretch" wrap="nowrap">
                  <div style={{ flex: 1 }}>
                    <Card>
                      <CardContent>
                      <Stack gap="md">
                        <Title order={4}>Commands</Title>
                        {initCommandsLoading && <Loader size="sm" />}
                        {!initCommandsLoading && (
                          <>
                            {initCommands.length === 0 ? (
                              <Text size="sm" c="dimmed">
                                No commands configured. Add a command below to get started.
                              </Text>
                            ) : (
                              <Stack gap="sm">
                                {initCommands.map((cmd, index) => (
                                  <Group key={index} gap="sm" align="center" wrap="nowrap">
                                    <Text size="sm" style={{ fontFamily: 'monospace', flex: 1 }}>
                                      {cmd}
                                    </Text>
                                    {editingCommandIndex === index ? null : (
                                      <Group gap="xs">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          icon={<PencilSimple size={16} weight="fill" aria-hidden="true" />}
                                          onClick={() => {
                                            setEditingCommandIndex(index)
                                            setNewCommandValue(cmd)
                                          }}
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          icon={<Trash size={16} weight="fill" aria-hidden="true" />}
                                          onClick={() => {
                                            setInitCommands((prev) => prev.filter((_, i) => i !== index))
                                          }}
                                        >
                                          Remove
                                        </Button>
                                      </Group>
                                    )}
                                  </Group>
                                ))}
                              </Stack>
                            )}
                            <Stack gap="sm">
                              {editingCommandIndex !== null ? (
                                <>
                                  <TextInput
                                    label="Edit command"
                                    value={newCommandValue}
                                    onChange={(e) => setNewCommandValue(e.currentTarget.value)}
                                    placeholder="gamerule keepInventory true"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && newCommandValue.trim()) {
                                        e.preventDefault()
                                        setInitCommands((prev) => {
                                          const next = [...prev]
                                          next[editingCommandIndex] = newCommandValue.trim()
                                          return next
                                        })
                                        setEditingCommandIndex(null)
                                        setNewCommandValue('')
                                      } else if (e.key === 'Escape') {
                                        setEditingCommandIndex(null)
                                        setNewCommandValue('')
                                      }
                                    }}
                                  />
                                  <Group>
                                    <Button
                                      type="button"
                                      variant="primary"
                                      onClick={() => {
                                        if (newCommandValue.trim()) {
                                          setInitCommands((prev) => {
                                            const next = [...prev]
                                            next[editingCommandIndex] = newCommandValue.trim()
                                            return next
                                          })
                                          setEditingCommandIndex(null)
                                          setNewCommandValue('')
                                        }
                                      }}
                                      disabled={!newCommandValue.trim()}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditingCommandIndex(null)
                                        setNewCommandValue('')
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </Group>
                                </>
                              ) : (
                                <>
                                  <TextInput
                                    label="Add command"
                                    value={newCommandValue}
                                    onChange={(e) => setNewCommandValue(e.currentTarget.value)}
                                    placeholder="gamerule keepInventory true"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && newCommandValue.trim()) {
                                        e.preventDefault()
                                        setInitCommands((prev) => [...prev, newCommandValue.trim()])
                                        setNewCommandValue('')
                                      }
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                      if (newCommandValue.trim()) {
                                        setInitCommands((prev) => [...prev, newCommandValue.trim()])
                                        setNewCommandValue('')
                                      }
                                    }}
                                    disabled={!newCommandValue.trim()}
                                    icon={<Plus size={18} weight="fill" aria-hidden="true" />}
                                  >
                                    Add Command
                                  </Button>
                                </>
                              )}
                            </Stack>
                          </>
                        )}
                      </Stack>
                    </CardContent>
                    </Card>
                  </div>

                  <div style={{ flex: 1 }}>
                    <Card>
                      <CardContent>
                      <Stack gap="md">
                        <Title order={4}>Initialization Status</Title>
                        {initStatusLoading && <Loader size="sm" />}
                        {initStatusError && (
                          <Alert color="red" title="Error">
                            {initStatusError}
                          </Alert>
                        )}
                        {!initStatusLoading && !initStatusError && initStatus && (
                          <Stack gap="sm">
                            {initStatus.initialized && initStatus.marker ? (
                              <>
                                <Group gap="xs">
                                  <Badge variant="success">Initialized</Badge>
                                  <Text size="sm" c="dimmed">
                                    Build: {initStatus.marker.buildId}
                                  </Text>
                                </Group>
                                <Text size="sm" c="dimmed">
                                  Initialized at: {new Date(initStatus.marker.initializedAt).toLocaleString()}
                                </Text>
                                <Text size="sm" c="dimmed">
                                  Commands executed: {initStatus.marker.commands.length}
                                </Text>
                                {initStatus.marker.commands.length > 0 && (
                                  <Stack gap={4}>
                                    {initStatus.marker.commands.map((cmd, idx) => (
                                      <Text key={idx} size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                                        {cmd}
                                      </Text>
                                    ))}
                                  </Stack>
                                )}
                                <Group>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={async () => {
                                      if (!id) return
                                      try {
                                        setInitStatusLoading(true)
                                        await clearInitMarker(id)
                                        const status = await fetchInitStatus(id)
                                        setInitStatus(status)
                                        toast({
                                          title: 'Marker cleared',
                                          description: 'Init commands will execute on next server start.',
                                          variant: 'success',
                                        })
                                      } catch (err) {
                                        toast({
                                          title: 'Failed to clear marker',
                                          description: err instanceof Error ? err.message : 'Failed to clear initialization marker',
                                          variant: 'danger',
                                        })
                                      } finally {
                                        setInitStatusLoading(false)
                                      }
                                    }}
                                    disabled={initStatusLoading}
                                  >
                                    Clear Marker
                                  </Button>
                                </Group>
                              </>
                            ) : (
                              <Text size="sm" c="dimmed">
                                Not initialized. Commands will execute on next server start.
                              </Text>
                            )}
                          </Stack>
                        )}
                      </Stack>
                    </CardContent>
                    </Card>
                  </div>
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="plugins">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Title order={3}>Configured Plugins</Title>
                        <Group>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setCopyFromError(null)
                              setCopyFromSourceId('')
                              setCopyFromOpen(true)
                            }}
                            disabled={otherProjects.length === 0}
                            icon={<Copy size={18} weight="bold" aria-hidden="true" />}
                          >
                            Copy from project…
                          </Button>
                          <Button
                            type="button"
                            variant="primary"
                            onClick={openAddPluginPanel}
                            disabled={addPluginBusy}
                            icon={<Plus size={18} weight="fill" aria-hidden="true" />}
                          >
                            Add plugin
                          </Button>
                        </Group>
                      </Group>
                      {project.plugins && project.plugins.length > 0 ? (
                        <Stack gap="md">
                          {[...project.plugins]
                            .sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }))
                            .map((plugin) => (
                              <PluginCard
                                key={`${plugin.id}:${plugin.version}`}
                                plugin={plugin}
                                pluginDefinitions={pluginDefinitionCache[plugin.id] ?? []}
                                onRemove={handleRemovePlugin}
                                onEditCustomPath={handleEditCustomPath}
                                onRemoveCustomPath={handleRemoveCustomPath}
                                onAddCustomPath={handleAddCustomPath}
                              />
                            ))}
                        </Stack>
                      ) : (
                        <Text size="sm" c="dimmed">No plugins configured yet.</Text>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>

              <Modal
                opened={addPluginOpen}
                onClose={closeAddPluginPanel}
                title="Add Plugin to Project"
                size="lg"
                centered
              >
                <Stack gap="md">
                  {addPluginError && (
                    <Alert color="red" title="Error">
                      {addPluginError}
                    </Alert>
                  )}

                  {libraryLoading && <Loader size="sm" />}
                  {libraryError && (
                    <Stack gap="sm">
                      <Alert color="red" title="Error">
                        {libraryError}
                      </Alert>
                      <Group>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void handleRefreshLibrary()}
                          disabled={libraryLoading}
                        >
                          Retry
                        </Button>
                      </Group>
                    </Stack>
                  )}
                  {!libraryLoading && !libraryError && libraryPlugins.length === 0 && (
                    <Text size="sm" c="dimmed">
                      No saved plugins yet. Add plugins from the Plugin Library page first.
                    </Text>
                  )}
                  {!libraryLoading && !libraryError && libraryPlugins.length > 0 && (
                    <form onSubmit={handleAddLibraryPlugin}>
                      <Stack gap="md">
                        <NativeSelect
                          label="Library plugin"
                          id="library-plugin-select"
                          value={selectedLibraryPlugin}
                          onChange={(event) => setSelectedLibraryPlugin(event.target.value)}
                          required
                          data={[
                            { value: '', label: 'Select a plugin' },
                            ...libraryPlugins
                              .slice()
                              .sort((a, b) => {
                                const idCompare = a.id.localeCompare(b.id, undefined, { sensitivity: 'base' })
                                if (idCompare !== 0) return idCompare
                                return b.version.localeCompare(a.version, undefined, { numeric: true })
                              })
                              .map((plugin) => {
                              const key = `${plugin.id}:${plugin.version}`
                              const providerLabel =
                                plugin.provider && plugin.provider !== 'custom'
                                  ? ` (${plugin.provider})`
                                  : ''
                              const minVersion = plugin.minecraftVersionMin ?? plugin.source?.minecraftVersionMin
                              const maxVersion = plugin.minecraftVersionMax ?? plugin.source?.minecraftVersionMax
                              const versionRangeLabel =
                                minVersion && maxVersion
                                  ? minVersion === maxVersion
                                    ? ` (${minVersion})`
                                    : ` (${minVersion} - ${maxVersion})`
                                  : ''
                              const isAlreadyAdded = existingProjectPlugins.has(key)
                              return {
                                value: key,
                                label: `${plugin.id} v${plugin.version}${versionRangeLabel}${providerLabel}${isAlreadyAdded ? ' · already added' : ''}`,
                                disabled: isAlreadyAdded,
                              }
                            }),
                          ]}
                        />
                        <Group justify="flex-end">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={closeAddPluginPanel}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={!selectedLibraryPlugin || addPluginBusy}
                          >
                            {addPluginBusy ? 'Adding…' : 'Add plugin'}
                          </Button>
                        </Group>
                      </Stack>
                    </form>
                  )}
                </Stack>
              </Modal>

              <Modal
                opened={copyFromOpen}
                onClose={() => {
                  if (!copyFromBusy) {
                    setCopyFromOpen(false)
                    setCopyFromError(null)
                  }
                }}
                title="Copy plugin list from project"
                size="md"
                centered
              >
                <Stack gap="md">
                  {copyFromError && (
                    <Alert color="red" title="Error">
                      {copyFromError}
                    </Alert>
                  )}
                  {otherProjects.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No other projects. Create another project first to copy plugins from it.
                    </Text>
                  ) : (
                    <>
                      <NativeSelect
                        label="Source project"
                        value={copyFromSourceId}
                        onChange={(e) => setCopyFromSourceId(e.target.value)}
                        data={[
                          { value: '', label: 'Select a project' },
                          ...otherProjects.map((p) => ({
                            value: p.id,
                            label: `${p.name} (${p.plugins?.length ?? 0} plugins)`,
                          })),
                        ]}
                      />
                      <Radio.Group
                        label="Mode"
                        value={copyFromMode}
                        onChange={(v) => setCopyFromMode(v as 'replace' | 'merge')}
                      >
                        <Stack gap="xs" mt="xs">
                          <Radio value="replace" label="Replace — set this project's plugin list to the source's list" />
                          <Radio value="merge" label="Merge — add source plugins; skip any already on this project" />
                        </Stack>
                      </Radio.Group>
                      {copyFromSourceId && project && (
                        <Text size="sm" c="dimmed">
                          {copyFromMode === 'replace'
                            ? `This will replace the plugin list of "${project.name}" with the ${otherProjects.find((p) => p.id === copyFromSourceId)?.plugins?.length ?? 0} plugins from "${otherProjects.find((p) => p.id === copyFromSourceId)?.name ?? ''}". Continue?`
                            : `This will add plugins from "${otherProjects.find((p) => p.id === copyFromSourceId)?.name ?? ''}" to "${project.name}". Plugins already on this project will be skipped.`}
                        </Text>
                      )}
                      <Group justify="flex-end">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setCopyFromOpen(false)}
                          disabled={copyFromBusy}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => void handleCopyFromProject()}
                          disabled={!copyFromSourceId || copyFromBusy}
                        >
                          {copyFromBusy ? 'Copying…' : 'Copy plugins'}
                        </Button>
                      </Group>
                    </>
                  )}
                </Stack>
              </Modal>
            </Tabs.Panel>

            <Tabs.Panel value="configs">
              <Stack gap="lg" pt="lg" style={{ maxWidth: 1100, margin: '0 auto' }}>
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Group justify="space-between" align="center">
                        <Title order={3}>Plugin Config Files</Title>
                        <Button
                          variant="primary"
                          icon={<Upload size={18} weight="fill" aria-hidden="true" />}
                          onClick={() => {
                            setConfigUploadModalOpened(true)
                            setConfigsError(null)
                          }}
                        >
                          Upload Config
                        </Button>
                      </Group>
                      {configsError && (
                        <Alert color="red" title="Error">
                          {configsError}
                        </Alert>
                      )}
                      {configsLoading && (
                        <Stack gap="md">
                          {[0, 1, 2].map((index) => (
                            <Card key={index}>
                              <CardContent>
                                <Stack gap="xs">
                                  <Skeleton style={{ width: '70%', height: '18px' }} />
                                  <Skeleton style={{ width: '50%', height: '14px' }} />
                                </Stack>
                              </CardContent>
                            </Card>
                          ))}
                        </Stack>
                      )}
                      {!configsLoading && pluginConfigFiles.length === 0 && (
                        <Text size="sm" c="dimmed">
                          No plugin configs uploaded yet. Upload files to be included in your builds.
                        </Text>
                      )}
                      {!configsLoading && pluginConfigFiles.length > 0 && (
                        <Stack gap="md">
                          {pluginConfigFilesByPlugin.map(([pluginId, files]) => {
                            const defaultVisible = 10
                            const isExpanded = expandedConfigPlugins.has(pluginId)
                            const displayFiles =
                              files.length > defaultVisible && !isExpanded
                                ? files.slice(0, defaultVisible)
                                : files
                            const hiddenCount = files.length - defaultVisible
                            return (
                            <Card key={pluginId}>
                              <CardContent>
                                <Stack gap="md">
                                  <Title order={4}>{pluginId}</Title>
                                  <Stack gap="xs">
                                    {displayFiles.map((file) => (
                                      <Group key={file.path} justify="space-between" align="flex-start">
                                        <Stack gap={2}>
                                          <Text fw={600} size="sm">{file.path}</Text>
                                          {file.size !== undefined && file.modifiedAt && (
                                            <Text size="xs" c="dimmed">
                                              {formatBytes(file.size)} · Updated {new Date(file.modifiedAt).toLocaleString()}
                                            </Text>
                                          )}
                                          {file.definitionId && (
                                            <Text size="xs" c="dimmed">
                                              Definition: {file.definitionId}
                                            </Text>
                                          )}
                                        </Stack>
                                        <Group gap="xs">
                                          <Anchor
                                            component="button"
                                            type="button"
                                            size="sm"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                            onClick={() => void handleEditConfig(file.path)}
                                          >
                                            <PencilSimple size={16} weight="fill" aria-hidden="true" />
                                            Edit
                                          </Anchor>
                                          <Anchor
                                            component="button"
                                            type="button"
                                            size="sm"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                            onClick={() => handleReplaceConfig(file)}
                                          >
                                            <ArrowsClockwise size={16} weight="fill" aria-hidden="true" />
                                            Replace
                                          </Anchor>
                                          <Anchor
                                            component="button"
                                            type="button"
                                            size="sm"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                            onClick={async () => {
                                              if (!id) return
                                              if (!window.confirm(`Delete config file ${file.path}? This cannot be undone.`)) {
                                                return
                                              }
                                              try {
                                                const next = await deleteProjectConfigFile(id, file.path)
                                                setConfigFiles(next)
                                                if (file.pluginId) {
                                                  void fetchProjectPluginConfigs(id, file.pluginId)
                                                    .then((data) => {
                                                      setPluginDefinitionCache((prev) => ({
                                                        ...prev,
                                                        [file.pluginId!]: data.definitions,
                                                      }))
                                                    })
                                                    .catch(() => {})
                                                }
                                                toast({
                                                  title: 'Config deleted',
                                                  description: `${file.path} removed from project.`,
                                                  variant: 'warning',
                                                })
                                              } catch (err) {
                                                toast({
                                                  title: 'Delete failed',
                                                  description:
                                                    err instanceof Error ? err.message : 'Failed to delete config file.',
                                                  variant: 'danger',
                                                })
                                              }
                                            }}
                                          >
                                            <Trash size={16} weight="fill" aria-hidden="true" />
                                            Delete
                                          </Anchor>
                                        </Group>
                                      </Group>
                                    ))}
                                    {files.length > defaultVisible && (
                                      <Group mt="xs">
                                        <Anchor
                                          component="button"
                                          type="button"
                                          size="sm"
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                          onClick={() => {
                                            setExpandedConfigPlugins((prev) => {
                                              const next = new Set(prev)
                                              if (next.has(pluginId)) next.delete(pluginId)
                                              else next.add(pluginId)
                                              return next
                                            })
                                          }}
                                        >
                                          {isExpanded
                                            ? 'Show less'
                                            : `Show all (${hiddenCount} more)`}
                                        </Anchor>
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
                  </CardContent>
                </Card>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="snapshot">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Title order={3}>Snapshot Source</Title>
                      <Text size="sm" c="dimmed">
                        Select a project to use as a snapshot source. When &apos;Use snapshot&apos; is enabled in Run Options, world data will be copied from the selected project&apos;s workspace.
                      </Text>
                      <Text size="sm" c="dimmed">
                        Note: When using a snapshot, the world seed configured in the profile is ignored since the world is copied, not generated.
                      </Text>
                      {project?.snapshotSourceProjectId && !snapshotSourceEditMode && snapshotSourceDraft === '' ? (
                        <Stack gap="sm">
                          <Group gap="sm" align="center">
                            <Text size="sm" fw={500}>
                              Snapshot source:
                            </Text>
                            <Text size="sm">
                              {allProjects.find((p) => p.id === project.snapshotSourceProjectId)?.name || project.snapshotSourceProjectId}
                            </Text>
                            <Anchor
                              size="sm"
                              component="button"
                              type="button"
                              onClick={() => {
                                setSnapshotSourceEditMode(true)
                                setSnapshotSourceDraft(project.snapshotSourceProjectId || '')
                              }}
                            >
                              Change
                            </Anchor>
                          </Group>
                        </Stack>
                      ) : (
                        <Stack gap="sm">
                          <NativeSelect
                            label="Snapshot source project"
                            value={snapshotSourceDraft !== '' ? snapshotSourceDraft : (project?.snapshotSourceProjectId || '')}
                            onChange={(event) => {
                              setSnapshotSourceDraft(event.currentTarget.value)
                            }}
                            disabled={snapshotSourceBusy}
                            data={[
                              { value: '', label: 'None' },
                              ...allProjects
                                .filter((p) => p.id !== id)
                                .map((p) => ({ value: p.id, label: p.name })),
                            ]}
                          />
                          <Group>
                            <Button
                              variant="primary"
                              onClick={async () => {
                                if (!id) return
                                const currentDraft = snapshotSourceDraft !== '' ? snapshotSourceDraft : (project?.snapshotSourceProjectId || '')
                                const newValue = currentDraft || undefined
                                setSnapshotSourceBusy(true)
                                try {
                                  const updated = await updateProject(id, {
                                    snapshotSourceProjectId: newValue,
                                  })
                                  setProject(updated)
                                  setSnapshotSourceEditMode(false)
                                  setSnapshotSourceDraft('')
                                  toast({
                                    title: 'Snapshot source updated',
                                    description: newValue
                                      ? `Snapshot source set to ${allProjects.find((p) => p.id === newValue)?.name || 'selected project'}`
                                      : 'Snapshot source cleared',
                                    variant: 'success',
                                  })
                                } catch (err) {
                                  toast({
                                    title: 'Update failed',
                                    description: err instanceof Error ? err.message : 'Failed to update snapshot source',
                                    variant: 'danger',
                                  })
                                } finally {
                                  setSnapshotSourceBusy(false)
                                }
                              }}
                              disabled={snapshotSourceBusy}
                            >
                              Save
                            </Button>
                            {snapshotSourceEditMode && (
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setSnapshotSourceEditMode(false)
                                  setSnapshotSourceDraft('')
                                }}
                                disabled={snapshotSourceBusy}
                              >
                                Cancel
                              </Button>
                            )}
                          </Group>
                        </Stack>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="settings">
              <Stack gap="lg" pt="lg">
                <Card>
                  <CardContent>
                    <Stack gap="md">
                      <Title order={3}>Danger Zone</Title>
                      {deleteError && (
                        <Alert color="red" title="Error">
                          {deleteError}
                        </Alert>
                      )}
                      <Text size="sm" c="dimmed">
                        Deleting removes this project&apos;s builds, run history, and local workspace. This action
                        cannot be undone.
                      </Text>
                      {project.repo && (
                        <Checkbox
                          label={`Also delete GitHub repository ${project.repo.fullName}`}
                          checked={deleteRepo}
                          onChange={(event) => setDeleteRepo(event.target.checked)}
                        />
                      )}
                      <Group>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => {
                            void handleDeleteProject()
                          }}
                          disabled={deleteBusy}
                        >
                          {deleteBusy ? 'Deleting…' : 'Delete project'}
                        </Button>
                      </Group>
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            </Tabs.Panel>
        </Tabs>

        <DescriptionModal
          opened={descriptionModalOpen}
          initialValue={project.description ?? ''}
          onClose={() => setDescriptionModalOpen(false)}
          onSave={async (value) => {
            try {
              setDescriptionBusy(true)
              const updated = await updateProject(id!, {
                description: value || undefined,
              })
              setProject(updated)
              setDescriptionModalOpen(false)
              toast({ variant: 'success', description: 'Description updated' })
            } catch (err) {
              toast({ variant: 'danger', description: err instanceof Error ? err.message : 'Failed to update description' })
            } finally {
              setDescriptionBusy(false)
            }
          }}
          loading={descriptionBusy}
        />
      </ContentSection>

      <Modal
        opened={configUploadModalOpened}
        onClose={() => {
          setConfigUploadModalOpened(false)
          setConfigsError(null)
        }}
        title="Upload Plugin Config File"
        size="lg"
        centered
      >
        <form
          ref={configUploadFormRef}
          onSubmit={handleUploadConfig}
        >
          <Stack gap="md">
            <NativeSelect
              label="Plugin (optional)"
              id="config-upload-plugin"
              value={configUploadPlugin}
              onChange={(event) => {
                const value = event.target.value
                setConfigUploadPlugin(value)
                setConfigUploadPathDirty(false)
                setConfigUploadDefinition('')
                setConfigUploadPath('')
              }}
              data={[
                { value: '', label: 'No association' },
                ...(project?.plugins ?? [])
                  .slice()
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .map((plugin) => {
                    const fileCount = configFiles.filter(f => f.pluginId === plugin.id).length
                    return {
                      value: plugin.id,
                      label: `${plugin.id}${fileCount > 0 ? ` (${fileCount})` : ''}`,
                    }
                  }),
              ]}
            />
            <Radio.Group
              label="Config Type"
              value={configUploadType}
              onChange={(value) => {
                setConfigUploadType(value as 'template' | 'custom')
                setConfigUploadDefinition('')
                setConfigUploadName('')
                setConfigUploadPath('')
                setConfigUploadPathDirty(false)
              }}
            >
              <Radio value="template" label="Use Config Template" />
              <Radio value="custom" label="Create Custom Config" />
            </Radio.Group>

            {configUploadType === 'template' && (
              <>
                <NativeSelect
                  label="Config Template"
                  id="config-upload-definition"
                  value={configUploadDefinition}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setConfigUploadDefinition(value)
                    const options = pluginDefinitionOptions[configUploadPlugin] ?? []
                    const selected = options.find((option) => option.definitionId === value)
                    if (selected) {
                      setConfigUploadPath(selected.path)
                      setConfigUploadPathDirty(false)
                    }
                  }}
                  disabled={!configUploadPlugin}
                  required
                  data={[
                    ...(pluginDefinitionOptions[configUploadPlugin] ?? []).map((option) => ({
                      value: option.definitionId,
                      label: option.label,
                    })),
                  ]}
                />
                {selectedDefinition?.path && (
                  <TextInput
                    label="Path"
                    value={selectedDefinition.path}
                    readOnly
                    disabled
                    styles={{ input: { backgroundColor: 'var(--mantine-color-gray-1)' } }}
                  />
                )}
              </>
            )}

            {configUploadType === 'custom' && (
              <>
                <TextInput
                  label="Config Name"
                  value={configUploadName}
                  onChange={(event) => setConfigUploadName(event.target.value)}
                  placeholder="My Custom Config"
                  required
                />
                <TextInput
                  label="Relative Path"
                  value={configUploadPath}
                  onChange={(event) => {
                    setConfigUploadPath(event.target.value)
                    setConfigUploadPathDirty(true)
                  }}
                  placeholder="plugins/MyPlugin/config.yml"
                  required
                />
              </>
            )}
            <div>
              <label htmlFor="config-upload-file" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                Config file
              </label>
              <input
                id="config-upload-file"
                type="file"
                ref={configUploadFileInputRef}
                onChange={(event) => setConfigUploadFile(event.target.files?.[0] ?? null)}
              />
            </div>
            {configsError && (
              <Alert color="red" title="Error">
                {configsError}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfigUploadModalOpened(false)
                  setConfigsError(null)
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon={<Upload size={18} weight="fill" aria-hidden="true" />}
                disabled={configUploadBusy}
              >
                {configUploadBusy
                  ? 'Uploading…'
                  : configFiles.some((f) => f.path === configUploadPath.trim())
                    ? 'Replace config'
                    : 'Upload config'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={configEditor !== null}
        onClose={() => {
          setConfigEditor(null)
          setConfigEditorError(null)
        }}
        title={configEditor ? `Edit Config: ${configEditor.path}` : 'Edit Config'}
        size="100%"
        styles={{
          content: { height: 'calc(100vh - 120px)', maxHeight: 'calc(100vh - 120px)' },
          body: { height: 'calc(100vh - 180px)', display: 'flex', flexDirection: 'column' },
        }}
      >
        <Stack gap="md" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {configEditorError && (
            <Alert color="red" title="Error" style={{ flexShrink: 0 }}>
              {configEditorError}
            </Alert>
          )}
          {configEditor && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              <CodeMirror
                value={configEditor.content}
                onChange={(value: string) =>
                  setConfigEditor((prev) => (prev ? { ...prev, content: value } : null))
                }
                extensions={[yaml()]}
                theme={oneDark}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  dropCursor: false,
                  allowMultipleSelections: false,
                }}
                style={{ flex: 1, height: '100%' }}
              />
            </div>
          )}
          <Group justify="flex-end" style={{ flexShrink: 0, paddingBottom: '2px' }}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfigEditor(null)
                setConfigEditorError(null)
              }}
              disabled={configEditorBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              icon={<FloppyDisk size={18} weight="fill" aria-hidden="true" />}
              onClick={() => void handleSaveConfig()}
              disabled={configEditorBusy}
            >
              {configEditorBusy ? 'Saving…' : 'Save changes'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <CustomPathModal
        modal={customPathModal}
        onClose={() => setCustomPathModal(null)}
        onSubmit={handleCustomPathSubmit}
      />

      <Modal
        opened={removeCustomPathConfirm !== null}
        onClose={() => setRemoveCustomPathConfirm(null)}
        title="Remove Custom Config Path"
        size="sm"
        centered
      >
        {removeCustomPathConfirm && (
          <Stack gap="md">
            <Text>
              Remove custom config path <Code>{removeCustomPathConfirm.path}</Code>?
            </Text>
            <Text size="sm" c="dimmed">
              This action cannot be undone.
            </Text>
            <Group justify="flex-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRemoveCustomPathConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  if (!id || !removeCustomPathConfirm) return
                  try {
                    const plugin = project?.plugins?.find((p) => p.id === removeCustomPathConfirm.pluginId)
                    if (!plugin) return
                    const currentMappings = plugin.configMappings ?? []
                    const updatedMappings = currentMappings.filter(
                      (m) => !(m.type === 'custom' && m.customId === removeCustomPathConfirm.definitionId),
                    )
                    const response = await updateProjectPluginConfigs(id, removeCustomPathConfirm.pluginId, {
                      mappings: updatedMappings,
                    })
                    setPluginDefinitionCache((prev) => ({
                      ...prev,
                      [removeCustomPathConfirm.pluginId]: response.definitions,
                    }))
                    setProject((prev) =>
                      prev
                        ? {
                            ...prev,
                            plugins: prev.plugins?.map((p) =>
                              p.id === removeCustomPathConfirm.pluginId
                                ? { ...p, configMappings: response.mappings }
                                : p,
                            ),
                          }
                        : prev,
                    )
                    toast({
                      title: 'Custom path removed',
                      description: `${removeCustomPathConfirm.path} removed.`,
                      variant: 'success',
                    })
                    setRemoveCustomPathConfirm(null)
                  } catch (err) {
                    toast({
                      title: 'Remove failed',
                      description: err instanceof Error ? err.message : 'Failed to remove custom path.',
                      variant: 'danger',
                    })
                  }
                }}
              >
                Remove
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={showRunOptions}
        onClose={() => {
          setShowRunOptions(false)
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
                setRunOptions(prev => ({ ...prev, resetWorld: true, useSnapshot: false }))
              } else {
                setRunOptions(prev => ({ ...prev, resetWorld: false }))
              }
            }}
            description="Deletes the world directory to start fresh"
          />
          {project?.snapshotSourceProjectId && (
            <Checkbox
              label="Use snapshot"
              checked={runOptions.useSnapshot}
              disabled={runOptions.resetWorld}
              onChange={(event) => {
                if (event.target.checked) {
                  setRunOptions(prev => ({ ...prev, useSnapshot: true, resetWorld: false }))
                } else {
                  setRunOptions(prev => ({ ...prev, useSnapshot: false }))
                }
              }}
              description={`Copy world from ${allProjects.find((p) => p.id === project.snapshotSourceProjectId)?.name || 'snapshot source'}`}
            />
          )}
          <Checkbox
            label="Reset plugin data"
            checked={runOptions.resetPlugins}
            onChange={(event) => setRunOptions(prev => ({ ...prev, resetPlugins: event.target.checked }))}
            description="Removes plugin data directories (keeps plugin JARs)"
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="ghost"
              onClick={() => {
                setShowRunOptions(false)
                setRunOptions({ resetWorld: false, resetPlugins: false, useSnapshot: false })
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void queueRunLocally()}
              disabled={runLocallyBusy}
            >
              {runLocallyBusy ? 'Starting...' : 'Start Run'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={showBuildOptions}
        onClose={() => {
          setShowBuildOptions(false)
          setBuildOptions({ skipPush: false })
        }}
        title="Build Options"
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Choose how to run the build:
          </Text>
          {project?.repo && (
            <Checkbox
              label="Build only (don't sync to repository)"
              checked={buildOptions.skipPush ?? false}
              onChange={(event) =>
                setBuildOptions((prev) => ({ ...prev, skipPush: event.target.checked }))
              }
              description="Build artifact and manifest locally without pushing to GitHub. Use when GitHub is rate limiting or offline."
            />
          )}
          <Group justify="flex-end" gap="sm">
            <Button
              variant="ghost"
              onClick={() => {
                setShowBuildOptions(false)
                setBuildOptions({ skipPush: false })
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setShowBuildOptions(false)
                setBuildOptions({ skipPush: false })
                void queueBuild(buildOptions)
              }}
              disabled={queueBuildBusy}
            >
              {queueBuildBusy ? 'Starting...' : 'Start build'}
            </Button>
          </Group>
        </Stack>
      </Modal>
  </>
  )
}

export default ProjectDetail


