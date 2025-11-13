import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Play, FileText, MagnifyingGlass, Package as PackageIcon } from '@phosphor-icons/react'
import {
  addProjectPlugin,
  deleteProject,
  deleteProjectConfigFile,
  deleteProjectPlugin,
  fetchBuildManifest,
  fetchBuilds,
  fetchProject,
  fetchProjectConfigFile,
  fetchProjectConfigs,
  fetchProjectPluginConfigs,
  fetchProjectRuns,
  fetchPluginLibrary,
  resetProjectWorkspace,
  runProjectLocally,
  scanProjectAssets,
  sendRunCommand,
  stopRunJob,
  triggerBuild,
  triggerManifest,
  updateProjectConfigFile,
  updateProjectPluginConfigs,
  uploadProjectConfig,
  uploadProjectPlugin,
  type BuildJob,
  type PluginConfigDefinitionView,
  type PluginConfigRequirement,
  type ProjectConfigSummary,
  type ProjectPluginConfigMapping,
  type ProjectSummary,
  type RunJob,
  type RunLogEntry,
  type StoredPluginRecord,
} from '../lib/api'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabList,
  TabTrigger,
  TabPanels,
  TabPanel,
  Skeleton,
} from '../components/ui'
import { useToast } from '../components/ui/toast'
import { ContentSection } from '../components/layout'
import { useAsyncAction } from '../lib/useAsyncAction'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
const sourceBadgeLabel: Record<'download' | 'upload', string> = {
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

type PluginWithSource =
  | NonNullable<ProjectSummary['plugins']>[number]
  | { source?: { uploadPath?: string | null } | null }

function getStoredPluginSourceKind(plugin: PluginWithSource): 'download' | 'upload' {
  const uploadPath =
    typeof plugin === 'object' && plugin !== null && typeof plugin.source === 'object'
      ? plugin.source?.uploadPath ?? null
      : null
  return uploadPath ? 'upload' : 'download'
}

interface ManifestPreview {
  buildId: string
  content: unknown
}

type PluginConfigDraft = {
  key: string
  definitionId: string
  source: 'library' | 'custom'
  label: string
  description: string
  defaultPath: string
  path: string
  requirement: PluginConfigRequirement
  notes: string
  missing: boolean
  uploaded?: ProjectConfigSummary
  hasExistingMapping: boolean
}

type PluginConfigManagerState = {
  pluginId: string
  pluginVersion: string
  busy: boolean
  saving: boolean
  error: string | null
  drafts: PluginConfigDraft[]
  uploads: ProjectConfigSummary[]
}

function toPluginConfigDraft(view: PluginConfigDefinitionView, index: number): PluginConfigDraft {
  return {
    key: `${view.id}-${index}-${Math.random().toString(36).slice(2)}`,
    definitionId: view.id,
    source: view.source,
    label: view.label ?? '',
    description: view.description ?? '',
    defaultPath: view.defaultPath,
    path: view.mapping?.path ?? view.resolvedPath ?? view.defaultPath,
    requirement: view.mapping?.requirement ?? view.requirement ?? 'optional',
    notes: view.mapping?.notes ?? '',
    missing: view.missing,
    uploaded: view.uploaded,
    hasExistingMapping: Boolean(view.mapping),
  }
}

function createCustomPluginConfigDraft(): PluginConfigDraft {
  const definitionId = `custom/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return {
    key: `${definitionId}-${Math.random().toString(36).slice(2)}`,
    definitionId,
    source: 'custom',
    label: '',
    description: '',
    defaultPath: '',
    path: '',
    requirement: 'optional',
    notes: '',
    missing: true,
    uploaded: undefined,
    hasExistingMapping: false,
  }
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

function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const initialLoadRef = useRef(true)
  const configUploadFormRef = useRef<HTMLFormElement | null>(null)
  const logRefs = useRef<Record<string, HTMLPreElement | null>>({})
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
  const [configUploadDefinition, setConfigUploadDefinition] = useState('')
  const [configUploadPathDirty, setConfigUploadPathDirty] = useState(false)
  const [configUploadBusy, setConfigUploadBusy] = useState(false)
  const [configEditor, setConfigEditor] = useState<{ path: string; content: string } | null>(null)
  const [configEditorBusy, setConfigEditorBusy] = useState(false)
  const [configEditorError, setConfigEditorError] = useState<string | null>(null)
  const [pluginConfigManager, setPluginConfigManager] = useState<PluginConfigManagerState | null>(null)
  const [deleteRepo, setDeleteRepo] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [addPluginOpen, setAddPluginOpen] = useState(false)
  const [addPluginMode, setAddPluginMode] = useState<'library' | 'upload'>('library')
  const [addPluginBusy, setAddPluginBusy] = useState(false)
  const [addPluginError, setAddPluginError] = useState<string | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [libraryPlugins, setLibraryPlugins] = useState<StoredPluginRecord[]>([])
  const [selectedLibraryPlugin, setSelectedLibraryPlugin] = useState('')
  const [uploadPluginId, setUploadPluginId] = useState('')
  const [uploadPluginVersion, setUploadPluginVersion] = useState('')
  const [uploadPluginMin, setUploadPluginMin] = useState('')
  const [uploadPluginMax, setUploadPluginMax] = useState('')
  const [uploadPluginFile, setUploadPluginFile] = useState<File | null>(null)

  const existingProjectPlugins = useMemo(() => {
    const set = new Set<string>()
    for (const plugin of project?.plugins ?? []) {
      set.add(`${plugin.id}:${plugin.version}`)
    }
    return set
  }, [project?.plugins])

  const resetAddPluginForms = useCallback(() => {
    setAddPluginError(null)
    setSelectedLibraryPlugin('')
    setUploadPluginId('')
    setUploadPluginVersion('')
    setUploadPluginMin('')
    setUploadPluginMax('')
    setUploadPluginFile(null)
  }, [])

  const openAddPluginPanel = useCallback(() => {
    resetAddPluginForms()
    setAddPluginMode('library')
    setAddPluginOpen(true)
  }, [resetAddPluginForms])

  const closeAddPluginPanel = useCallback(() => {
    setAddPluginOpen(false)
    setAddPluginBusy(false)
    resetAddPluginForms()
  }, [resetAddPluginForms])

  const handleSelectAddPluginMode = useCallback((mode: 'library' | 'upload') => {
    setAddPluginMode(mode)
    setAddPluginError(null)
    if (mode === 'library') {
      setUploadPluginId('')
      setUploadPluginVersion('')
      setUploadPluginMin('')
      setUploadPluginMax('')
      setUploadPluginFile(null)
    } else {
      setSelectedLibraryPlugin('')
    }
  }, [])

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
    async () => {
      if (!id) {
        throw new Error('Project identifier missing.')
      }
      return triggerBuild(id)
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
      return scanProjectAssets(id)
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
      return runProjectLocally(id)
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

  const busy = queueBuildBusy || generateManifestBusy || scanAssetsBusy || runLocallyBusy

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
      map[plugin.id] = mappings.map((mapping) =>
        formatOption(mapping.definitionId, mapping.path ?? '', mapping.definitionId),
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
    if (pluginConfigManager) {
      map[pluginConfigManager.pluginId] = pluginConfigManager.drafts.map((draft) =>
        formatOption(draft.definitionId, draft.path, draft.label || draft.definitionId || 'Custom'),
      )
    }
    return map
  }, [pluginConfigManager, pluginDefinitionCache, project?.plugins])

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

  const openPluginConfigManager = useCallback(
    async (pluginId: string) => {
      if (!id || !project) return
      const target = project.plugins?.find((entry) => entry.id === pluginId)
      if (!target) {
        toast({
          title: 'Plugin not found',
          description: `Plugin ${pluginId} is not part of this project.`,
          variant: 'danger',
        })
        return
      }
      setPluginConfigManager({
        pluginId: target.id,
        pluginVersion: target.version,
        busy: true,
        saving: false,
        error: null,
        drafts: [],
        uploads: [],
      })
      try {
        const data = await fetchProjectPluginConfigs(id, pluginId)
        setPluginConfigManager({
          pluginId: target.id,
          pluginVersion: target.version,
          busy: false,
          saving: false,
          error: null,
          drafts: data.definitions.map((definition, index) => toPluginConfigDraft(definition, index)),
          uploads: data.uploads,
        })
        setPluginDefinitionCache((prev) => ({
          ...prev,
          [pluginId]: data.definitions,
        }))
        setProject((prev) =>
          prev
            ? {
                ...prev,
                plugins: prev.plugins?.map((plugin) =>
                  plugin.id === pluginId ? { ...plugin, configMappings: data.mappings } : plugin,
                ),
              }
            : prev,
        )
      } catch (err) {
        setPluginConfigManager((prev) =>
          prev && prev.pluginId === pluginId
            ? {
                ...prev,
                busy: false,
                error: err instanceof Error ? err.message : 'Failed to load config paths.',
              }
            : prev,
        )
      }
    },
    [id, project, toast],
  )

  const closePluginConfigManager = useCallback(() => {
    setPluginConfigManager(null)
  }, [])

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

  const handleUploadPlugin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!id) {
        setAddPluginError('Project identifier missing.')
        return
      }
      if (!uploadPluginId.trim() || !uploadPluginVersion.trim()) {
        setAddPluginError('Plugin id and version are required.')
        return
      }
      if (!uploadPluginFile) {
        setAddPluginError('Select a plugin jar to upload.')
        return
      }

      setAddPluginBusy(true)
      setAddPluginError(null)
      try {
        const plugins = await uploadProjectPlugin(id, {
          pluginId: uploadPluginId.trim(),
          version: uploadPluginVersion.trim(),
          file: uploadPluginFile,
          minecraftVersionMin: uploadPluginMin.trim() || undefined,
          minecraftVersionMax: uploadPluginMax.trim() || undefined,
        })
        setProject((prev) => (prev ? { ...prev, plugins: plugins ?? [] } : prev))
        toast({
          title: 'Plugin uploaded',
          description: `${uploadPluginId.trim()} v${uploadPluginVersion.trim()} uploaded to project.`,
          variant: 'success',
        })
        closeAddPluginPanel()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to upload plugin.'
        setAddPluginError(message)
        toast({
          title: 'Upload failed',
          description: message,
          variant: 'danger',
        })
      } finally {
        setAddPluginBusy(false)
      }
    },
    [
      closeAddPluginPanel,
      id,
      setProject,
      toast,
      uploadPluginFile,
      uploadPluginId,
      uploadPluginMax,
      uploadPluginMin,
      uploadPluginVersion,
      uploadProjectPlugin,
    ],
  )

  const refreshPluginConfigManager = useCallback(async () => {
    if (!pluginConfigManager) return
    await openPluginConfigManager(pluginConfigManager.pluginId)
  }, [openPluginConfigManager, pluginConfigManager])

  const updatePluginConfigDraft = useCallback(
    (key: string, changes: Partial<PluginConfigDraft>) => {
      setPluginConfigManager((prev) =>
        prev
          ? {
              ...prev,
              drafts: prev.drafts.map((draft) =>
                draft.key === key ? { ...draft, ...changes } : draft,
              ),
            }
          : prev,
      )
    },
    [],
  )

  const addCustomPluginConfigDraft = useCallback(() => {
    setPluginConfigManager((prev) =>
      prev
        ? {
            ...prev,
            drafts: [...prev.drafts, createCustomPluginConfigDraft()],
          }
        : prev,
    )
  }, [])

  const removePluginConfigDraft = useCallback((key: string) => {
    setPluginConfigManager((prev) =>
      prev
        ? {
            ...prev,
            drafts: prev.drafts.filter((draft) => draft.key !== key),
          }
        : prev,
    )
  }, [])

  const handleSavePluginConfigManager = useCallback(async () => {
    if (!id || !pluginConfigManager) return
    const sanitizedMappings: ProjectPluginConfigMapping[] = []
    for (const draft of pluginConfigManager.drafts) {
      const path = draft.path.trim()
      if (!path) {
        setPluginConfigManager((prev) =>
          prev
            ? {
                ...prev,
                error: 'Each config mapping must include a relative path.',
              }
            : prev,
        )
        return
      }
      sanitizedMappings.push({
        definitionId: draft.definitionId,
        path,
        requirement: draft.requirement,
        notes: draft.notes.trim() || undefined,
      })
    }
    setPluginConfigManager((prev) =>
      prev
        ? {
            ...prev,
            saving: true,
            error: null,
          }
        : prev,
    )
    try {
      const response = await updateProjectPluginConfigs(id, pluginConfigManager.pluginId, {
        mappings: sanitizedMappings,
      })
      setProject((prev) =>
        prev
          ? {
              ...prev,
              plugins: prev.plugins?.map((plugin) =>
                plugin.id === pluginConfigManager.pluginId
                  ? { ...plugin, configMappings: response.mappings }
                  : plugin,
              ),
            }
          : prev,
      )
      setPluginConfigManager({
        pluginId: response.plugin.id,
        pluginVersion: response.plugin.version,
        busy: false,
        saving: false,
        error: null,
        drafts: response.definitions.map((definition, index) => toPluginConfigDraft(definition, index)),
        uploads: response.uploads,
      })
      setPluginDefinitionCache((prev) => ({
        ...prev,
        [response.plugin.id]: response.definitions,
      }))
      toast({
        title: 'Plugin config paths updated',
        description: `Saved ${sanitizedMappings.length} mapping${
          sanitizedMappings.length === 1 ? '' : 's'
        } for ${response.plugin.id}.`,
        variant: 'success',
      })
    } catch (err) {
      setPluginConfigManager((prev) =>
        prev
          ? {
              ...prev,
              saving: false,
              error: err instanceof Error ? err.message : 'Failed to save plugin config paths.',
            }
          : prev,
      )
    }
  }, [id, pluginConfigManager, toast, updateProjectPluginConfigs])

  const prepareConfigUpload = useCallback(
    (pluginId: string, definitionId: string, path: string) => {
      setConfigUploadPlugin(pluginId)
      setConfigUploadDefinition(definitionId)
      setConfigUploadPath(path ?? '')
      setConfigUploadPathDirty(false)
      configUploadFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [],
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
        element.scrollTop = element.scrollHeight
      }
    })
  }, [runs])

  const handleCommandChange = useCallback((runId: string, value: string) => {
    setCommandInputs((prev) => ({ ...prev, [runId]: value }))
  }, [])

  useEffect(() => {
    if (!addPluginOpen || addPluginMode !== 'library') {
      return
    }
    if (libraryLoading || libraryPlugins.length > 0 || libraryError) {
      return
    }
    void handleRefreshLibrary()
  }, [
    addPluginMode,
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
      if (!configUploadFile || !configUploadPath.trim()) {
        setConfigsError('Config path and file are required.')
        return
      }
      try {
        setConfigUploadBusy(true)
        const configs = await uploadProjectConfig(id, {
          path: configUploadPath.trim(),
          file: configUploadFile,
          pluginId: configUploadPlugin.trim() ? configUploadPlugin.trim() : undefined,
          definitionId: configUploadDefinition.trim() ? configUploadDefinition.trim() : undefined,
        })
        setConfigFiles(configs)
        setConfigsError(null)
        setConfigUploadPath('')
        setConfigUploadFile(null)
        setConfigUploadPlugin('')
        setConfigUploadDefinition('')
        setConfigUploadPathDirty(false)
        if (event.currentTarget instanceof HTMLFormElement) {
          event.currentTarget.reset()
        }
        if (configUploadFileInputRef.current) {
          configUploadFileInputRef.current.value = ''
        }
        if (pluginConfigManager && configUploadPlugin && pluginConfigManager.pluginId === configUploadPlugin) {
          void refreshPluginConfigManager()
        }
      } catch (err) {
        setConfigsError(err instanceof Error ? err.message : 'Failed to upload config file.')
      } finally {
        setConfigUploadBusy(false)
      }
    },
    [
      configUploadDefinition,
      configUploadFile,
      configUploadPath,
      configUploadPlugin,
      id,
      pluginConfigManager,
      refreshPluginConfigManager,
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
      <Card className="project-summary-card">
        <CardHeader>
          <div className="project-summary-card__header">
            <div>
              <CardTitle>{project.name}</CardTitle>
              <CardDescription>
                {[project.minecraftVersion, project.loader.toUpperCase(), project.source === 'imported' ? 'Imported' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </CardDescription>
            </div>
            <Link className="link" to="/projects">
              ← All Projects
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="project-summary-card__meta">
            <div>
              <span className="project-summary-card__meta-label">Minecraft</span>
              <strong>{project.minecraftVersion}</strong>
            </div>
            <div>
              <span className="project-summary-card__meta-label">Loader</span>
              <strong>{project.loader.toUpperCase()}</strong>
            </div>
            <div>
              <span className="project-summary-card__meta-label">Plugins</span>
              <strong>{pluginCount}</strong>
            </div>
            <div>
              <span className="project-summary-card__meta-label">Plugin configs</span>
              <strong>{pluginConfigCount}</strong>
            </div>
            <div>
              <span className="project-summary-card__meta-label">Last manifest</span>
              <strong>{lastManifestGenerated}</strong>
            </div>
          </div>
          <div className="project-summary-card__actions">
            <Button
              variant="primary"
              icon={<PackageIcon size={18} weight="fill" aria-hidden="true" />}
              onClick={() => void queueBuild()}
              disabled={busy}
            >
              Trigger build
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
              variant="ghost"
              icon={<MagnifyingGlass size={18} weight="bold" aria-hidden="true" />}
              onClick={() => void scanAssets()}
              disabled={busy}
            >
              Scan assets
            </Button>
            <Button
              variant="pill"
              icon={<Play size={18} weight="fill" aria-hidden="true" />}
              onClick={() => void queueRunLocally()}
              disabled={busy}
            >
              Run locally
            </Button>
          </div>
        </CardContent>
      </Card>

      <ContentSection as="section" className="project-detail-tabs">
        <Tabs defaultValue="overview">
          <TabList>
            <TabTrigger value="overview">Overview</TabTrigger>
            <TabTrigger value="profile">Profile</TabTrigger>
            <TabTrigger value="plugins">Plugins</TabTrigger>
            <TabTrigger value="configs">Config Files</TabTrigger>
            <TabTrigger value="builds">Builds</TabTrigger>
            <TabTrigger value="runs">Runs</TabTrigger>
            <TabTrigger value="settings">Settings</TabTrigger>
          </TabList>
          <TabPanels>
            <TabPanel value="overview">
              <div className="layout-grid">
                <ContentSection as="article">
                  <header>
                    <h3>Repository</h3>
                  </header>
                  {project.repo ? (
                    <>
                      <p className="muted">
                        Linked repo:{' '}
                        <a href={project.repo.htmlUrl} target="_blank" rel="noreferrer">
                          {project.repo.fullName}
                        </a>
                      </p>
                      <p className="muted">Default branch: {project.repo.defaultBranch}</p>
                    </>
                  ) : (
                    <p className="muted">No GitHub repository linked.</p>
                  )}
                  {project.manifest && (
                    <p className="muted">
                      Last build: {project.manifest.lastBuildId}{' '}
                      {project.manifest.commitSha && project.repo ? (
                        <a
                          href={`${project.repo.htmlUrl.replace(/\.git$/, '')}/commit/${project.manifest.commitSha}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ({project.manifest.commitSha.slice(0, 7)})
                        </a>
                      ) : null}
                    </p>
                  )}
                </ContentSection>
              </div>
            </TabPanel>

            <TabPanel value="profile">
              <ContentSection as="article">
                <header>
                  <h3>Profile YAML</h3>
                  <div className="dev-buttons">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => navigate(`/projects/${project.id}/profile`)}
                      disabled={busy}
                    >
                      Edit profile
                    </Button>
                  </div>
                </header>
                <p className="muted">
                  The server profile keeps your build definition in sync. Save updates to{' '}
                  <code>profiles/base.yml</code> to control plugins, config templates, and overrides used in builds.
                </p>
                <p className="muted">
                  Editing the profile will rescan assets automatically so manifests and builds stay aligned with your latest configuration.
                </p>
              </ContentSection>
            </TabPanel>

            <TabPanel value="builds">
              <ContentSection as="article">
                <header>
                  <h3>Build History</h3>
                  {latestBuild?.artifactPath && (
                    <a
                      className="link"
                      href={`${API_BASE}/builds/${latestBuild.id}/artifact`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download latest artifact
                    </a>
                  )}
                </header>
                {builds.length === 0 && <p className="muted">No builds yet.</p>}
                {builds.length > 0 && (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Build</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Finished</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {builds.map((build) => (
                        <tr key={build.id}>
                          <td>{build.manifestBuildId ?? build.id}</td>
                          <td>{build.status.toUpperCase()}</td>
                          <td>{new Date(build.createdAt).toLocaleString()}</td>
                          <td>{build.finishedAt ? new Date(build.finishedAt).toLocaleString() : '—'}</td>
                          <td className="dev-buttons">
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
                              <a
                                className="ghost"
                                href={`${API_BASE}/builds/${build.id}/artifact`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Download Artifact
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ContentSection>

              {manifestPreview && (
                <ContentSection as="article">
                  <header>
                    <h3>Manifest: {manifestPreview.buildId}</h3>
                    <Button variant="ghost" onClick={() => setManifestPreview(null)}>
                      Close
                    </Button>
                  </header>
                  <pre className="log-box">
                    {JSON.stringify(manifestPreview.content, null, 2)}
                  </pre>
                </ContentSection>
              )}
            </TabPanel>

            <TabPanel value="runs">
              <ContentSection as="article">
                <header>
                  <h3>Local Runs</h3>
                  <div className="dev-buttons">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void resetWorkspaceAction()}
                      disabled={resetWorkspaceBusy}
                    >
                      Reset workspace
                    </Button>
                  </div>
                </header>
                {runsError && <p className="muted">Run controls: {runsError}</p>}
                {runs.length === 0 && <p className="muted">No local run activity yet.</p>}
                {runs.length > 0 && (
                  <ul className="project-list">
                    {runs.map((run) => (
                      <li key={run.id}>
                        <div>
                          <strong>{run.id}</strong>
                          <p className="muted">
                            <Badge variant="outline">{runStatusLabel[run.status]}</Badge> · Started{' '}
                            {new Date(run.createdAt).toLocaleString()}
                            {run.finishedAt && (
                              <>
                                {' '}
                                · Finished {new Date(run.finishedAt).toLocaleString()}
                              </>
                            )}
                          </p>
                          {run.port && <p className="muted">Port: {run.port} (local)</p>}
                          {run.containerName && <p className="muted">Container: {run.containerName}</p>}
                          {run.workspacePath && (
                            <p className="muted">
                              Workspace: <code>{run.workspacePath}</code>
                            </p>
                          )}
                          {run.workspaceStatus && (
                            <p className="muted">
                              Workspace build {run.workspaceStatus.lastBuildId ?? 'unknown'} · Last sync{' '}
                              {run.workspaceStatus.lastSyncedAt
                                ? new Date(run.workspaceStatus.lastSyncedAt).toLocaleString()
                                : 'unknown'}
                              {run.workspaceStatus.dirtyPaths.length > 0
                                ? ` · ${run.workspaceStatus.dirtyPaths.length} local change${
                                    run.workspaceStatus.dirtyPaths.length === 1 ? '' : 's'
                                  }`
                                : ' · In sync'}
                            </p>
                          )}
                          {run.workspaceStatus?.dirtyPaths?.length ? (
                            <details>
                              <summary>Local changes ({run.workspaceStatus.dirtyPaths.length})</summary>
                              <ul className="muted">
                                {run.workspaceStatus.dirtyPaths.slice(0, 10).map((path) => (
                                  <li key={path}>{path}</li>
                                ))}
                                {run.workspaceStatus.dirtyPaths.length > 10 && (
                                  <li>...and {run.workspaceStatus.dirtyPaths.length - 10} more</li>
                                )}
                              </ul>
                            </details>
                          ) : null}
                          {run.logs.length > 0 && (
                            <details>
                              <summary>View logs</summary>
                              <pre
                                className="log-box"
                                ref={(element) => {
                                  logRefs.current[run.id] = element
                                }}
                              >
                                {run.logs
                                  .map(
                                    (entry) =>
                                      `[${new Date(entry.timestamp).toLocaleTimeString()}][${
                                        entry.stream
                                      }] ${entry.message}`,
                                  )
                                  .join('\n')}
                              </pre>
                            </details>
                          )}
                          {run.status === 'running' && (
                            <div>
                              {run.consoleAvailable ? (
                                <form
                                  style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}
                                  onSubmit={(event) => {
                                    event.preventDefault()
                                    const command = commandInputs[run.id]?.trim() ?? ''
                                    if (!command) {
                                      return
                                    }
                                    void dispatchRunCommand(run, command)
                                  }}
                                >
                                  <input
                                    type="text"
                                    aria-label="Console command"
                                    placeholder="/say Hello"
                                    value={commandInputs[run.id] ?? ''}
                                    onChange={(event) =>
                                      handleCommandChange(run.id, event.target.value)
                                    }
                                    disabled={Boolean(commandBusy[run.id])}
                                    style={{ flex: 1 }}
                                  />
                                  <Button
                                    type="submit"
                                    disabled={
                                      Boolean(commandBusy[run.id]) ||
                                      !commandInputs[run.id] ||
                                      commandInputs[run.id].trim().length === 0
                                    }
                                  >
                                    Send
                                  </Button>
                                </form>
                              ) : (
                                <p className="muted">Console not available yet.</p>
                              )}
                            </div>
                          )}
                          {run.error && <p className="error-text">{run.error}</p>}
                        </div>
                        {(run.status === 'running' ||
                          run.status === 'pending' ||
                          run.status === 'stopping') && (
                          <div className="dev-buttons">
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={run.status === 'stopping' || runBusy[run.id]}
                              onClick={() => void requestStopRun(run)}
                            >
                              {run.status === 'stopping' || runBusy[run.id] ? 'Stopping…' : 'Stop'}
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </ContentSection>
            </TabPanel>

            <TabPanel value="plugins">
              <div className="assets-grid">
                <ContentSection as="article">
                  <header>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                      }}
                    >
                      <h3>Configured Plugins</h3>
                      <div className="dev-buttons">
                        <Button
                          type="button"
                          variant="primary"
                          onClick={addPluginOpen ? closeAddPluginPanel : openAddPluginPanel}
                          disabled={addPluginBusy}
                        >
                          {addPluginOpen ? 'Close' : 'Add plugin'}
                        </Button>
                      </div>
                    </div>
                  </header>
                  {project.plugins && project.plugins.length > 0 ? (
                    <ul className="project-list">
                      {project.plugins.map((plugin) => {
                        const supportRange = formatMinecraftRange(
                          plugin.minecraftVersionMin ?? plugin.source?.minecraftVersionMin,
                          plugin.minecraftVersionMax ?? plugin.source?.minecraftVersionMax,
                        )
                        const sourceKind = getStoredPluginSourceKind(plugin)
                        return (
                          <li key={`${plugin.id}:${plugin.version}`}>
                            <div>
                              <strong>{plugin.id}</strong>{' '}
                              <Badge variant="outline">{sourceBadgeLabel[sourceKind]}</Badge>{' '}
                              {plugin.provider && plugin.provider !== 'custom' && (
                                <Badge variant="accent">{plugin.provider}</Badge>
                              )}{' '}
                              <span className="muted">v{plugin.version}</span>
                              {supportRange && <p className="muted">Supports: {supportRange}</p>}
                              {plugin.source?.projectUrl && (
                                <p className="muted">
                                  <a href={plugin.source.projectUrl} target="_blank" rel="noreferrer">
                                    View project
                                  </a>
                                </p>
                              )}
                              {plugin.source?.downloadUrl && (
                                <p className="muted">
                                  <a href={plugin.source.downloadUrl} target="_blank" rel="noreferrer">
                                    Download URL
                                  </a>
                                </p>
                              )}
                              {plugin.source?.uploadPath && (
                                <p className="muted">Uploaded jar: {plugin.source.uploadPath}</p>
                              )}
                              {(plugin.cachePath ?? plugin.source?.cachePath) && (
                                <p className="muted">
                                  Cache: {plugin.cachePath ?? plugin.source?.cachePath}
                                </p>
                              )}
                            </div>
                            <div className="dev-buttons">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => handleRemovePlugin(plugin.id)}
                              >
                                Remove
                              </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => void openPluginConfigManager(plugin.id)}
                            >
                              Manage config paths
                            </Button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="muted">No plugins configured yet.</p>
                  )}
                </ContentSection>

                {addPluginOpen && (
                  <ContentSection as="article">
                    <header>
                      <h3>Add Plugin to Project</h3>
                    </header>

                    <div
                      className="dev-buttons"
                      style={{ marginBottom: '1rem', flexWrap: 'wrap', rowGap: '0.5rem' }}
                    >
                      <Button
                        type="button"
                        variant={addPluginMode === 'library' ? 'primary' : 'ghost'}
                        onClick={() => handleSelectAddPluginMode('library')}
                        disabled={addPluginBusy}
                      >
                        From library
                      </Button>
                      <Button
                        type="button"
                        variant={addPluginMode === 'upload' ? 'primary' : 'ghost'}
                        onClick={() => handleSelectAddPluginMode('upload')}
                        disabled={addPluginBusy}
                      >
                        Upload jar
                      </Button>
                    </div>

                    {addPluginError && <p className="error-text">{addPluginError}</p>}

                    {addPluginMode === 'library' && (
                      <>
                        {libraryLoading && <p className="muted">Loading plugin library…</p>}
                        {libraryError && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p className="error-text">{libraryError}</p>
                            <div className="dev-buttons">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => void handleRefreshLibrary()}
                                disabled={libraryLoading}
                              >
                                Retry
                              </Button>
                            </div>
                          </div>
                        )}
                        {!libraryLoading && !libraryError && libraryPlugins.length === 0 && (
                          <p className="muted">
                            No saved plugins yet. Add plugins from the Plugin Library page first.
                          </p>
                        )}
                        {!libraryLoading && !libraryError && libraryPlugins.length > 0 && (
                          <form onSubmit={handleAddLibraryPlugin} className="form-grid">
                            <div className="field">
                              <label htmlFor="library-plugin-select">Library plugin</label>
                              <select
                                id="library-plugin-select"
                                value={selectedLibraryPlugin}
                                onChange={(event) => setSelectedLibraryPlugin(event.target.value)}
                                required
                              >
                                <option value="">Select a plugin</option>
                                {libraryPlugins.map((plugin) => {
                                  const key = `${plugin.id}:${plugin.version}`
                                  const providerLabel =
                                    plugin.provider && plugin.provider !== 'custom'
                                      ? ` (${plugin.provider})`
                                      : ''
                                  const isAlreadyAdded = existingProjectPlugins.has(key)
                                  return (
                                    <option key={key} value={key} disabled={isAlreadyAdded}>
                                      {plugin.id} v{plugin.version}
                                      {providerLabel}
                                      {isAlreadyAdded ? ' · already added' : ''}
                                    </option>
                                  )
                                })}
                              </select>
                            </div>
                            <div className="dev-buttons" style={{ gridColumn: '1 / -1' }}>
                              <Button
                                type="submit"
                                disabled={!selectedLibraryPlugin || addPluginBusy}
                              >
                                {addPluginBusy ? 'Adding…' : 'Add plugin'}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => void handleRefreshLibrary()}
                                disabled={libraryLoading}
                              >
                                Refresh
                              </Button>
                            </div>
                          </form>
                        )}
                      </>
                    )}

                    {addPluginMode === 'upload' && (
                      <form onSubmit={handleUploadPlugin} className="form-grid">
                        <div className="field">
                          <label htmlFor="upload-plugin-id">Plugin id</label>
                          <input
                            id="upload-plugin-id"
                            value={uploadPluginId}
                            onChange={(event) => setUploadPluginId(event.target.value)}
                            placeholder="WorldGuard"
                            required
                            disabled={addPluginBusy}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="upload-plugin-version">Version</label>
                          <input
                            id="upload-plugin-version"
                            value={uploadPluginVersion}
                            onChange={(event) => setUploadPluginVersion(event.target.value)}
                            placeholder="7.0.9"
                            required
                            disabled={addPluginBusy}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="upload-plugin-file">Plugin jar</label>
                          <input
                            id="upload-plugin-file"
                            type="file"
                            accept=".jar,.zip"
                            onChange={(event) => setUploadPluginFile(event.target.files?.[0] ?? null)}
                            required
                            disabled={addPluginBusy}
                          />
                          {uploadPluginFile && (
                            <p className="muted">Selected file: {uploadPluginFile.name}</p>
                          )}
                        </div>
                        <div className="field">
                          <label htmlFor="upload-plugin-min">Minecraft version min</label>
                          <input
                            id="upload-plugin-min"
                            value={uploadPluginMin}
                            onChange={(event) => setUploadPluginMin(event.target.value)}
                            placeholder="1.20"
                            disabled={addPluginBusy}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="upload-plugin-max">Minecraft version max</label>
                          <input
                            id="upload-plugin-max"
                            value={uploadPluginMax}
                            onChange={(event) => setUploadPluginMax(event.target.value)}
                            placeholder="1.20.1"
                            disabled={addPluginBusy}
                          />
                        </div>
                        <div className="dev-buttons" style={{ gridColumn: '1 / -1' }}>
                          <Button
                            type="submit"
                            disabled={
                              addPluginBusy ||
                              !uploadPluginId.trim() ||
                              !uploadPluginVersion.trim() ||
                              !uploadPluginFile
                            }
                          >
                            {addPluginBusy ? 'Uploading…' : 'Upload plugin'}
                          </Button>
                          <Button type="button" variant="ghost" onClick={closeAddPluginPanel}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}
                  </ContentSection>
                )}

                <ContentSection as="article">
                  <header>
                    <h3>Plugin Library</h3>
                  </header>
                  <p className="muted">
                    Manage saved plugins and add new ones from the{' '}
                    <Link to="/plugins" className="link">
                      Plugin Library
                    </Link>{' '}
                    page.
                  </p>
                </ContentSection>

                {pluginConfigManager && (
                  <ContentSection as="article" className="plugin-config-manager">
                    <header>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '1rem',
                        }}
                      >
                        <div>
                          <h3>
                            Manage Config Paths · {pluginConfigManager.pluginId}{' '}
                            <span className="muted">v{pluginConfigManager.pluginVersion ?? 'latest'}</span>
                          </h3>
                          <p className="muted">
                            Define per-project config file paths and requirements. These mappings drive uploads,
                            manifests, and status indicators.
                          </p>
                        </div>
                        <div className="dev-buttons">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void refreshPluginConfigManager()}
                            disabled={pluginConfigManager.busy || pluginConfigManager.saving}
                          >
                            Refresh
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={closePluginConfigManager}
                            disabled={pluginConfigManager.saving}
                          >
                            Close
                          </Button>
                        </div>
                      </div>
                    </header>

                    {pluginConfigManager.error && <p className="error-text">{pluginConfigManager.error}</p>}
                    {pluginConfigManager.busy && <p className="muted">Loading plugin config paths…</p>}

                    {!pluginConfigManager.busy && (
                      <>
                        <div className="config-definition-list">
                          {pluginConfigManager.drafts.length === 0 && (
                            <p className="muted">No config mappings yet. Add a custom entry or define paths in the library.</p>
                          )}
                          {pluginConfigManager.drafts.map((draft, index) => (
                            <div key={draft.key} className="config-definition-card">
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <strong>{draft.label || draft.definitionId}</strong>{' '}
                                  {draft.source === 'custom' && <Badge variant="accent">Custom</Badge>}{' '}
                                  <span className="muted">#{index + 1}</span>
                                </div>
                                <div className="dev-buttons">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() =>
                                      prepareConfigUpload(
                                        pluginConfigManager.pluginId,
                                        draft.definitionId,
                                        draft.path || draft.defaultPath,
                                      )
                                    }
                                  >
                                    Upload file
                                  </Button>
                                  {draft.source === 'custom' && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      onClick={() => removePluginConfigDraft(draft.key)}
                                      disabled={pluginConfigManager.saving}
                                    >
                                      Remove
                                    </Button>
                                  )}
                                  {draft.uploaded && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      onClick={async () => {
                                        if (!id) return
                                        if (
                                          !window.confirm(
                                            `Delete config file ${draft.uploaded?.path ?? draft.path}? This cannot be undone.`,
                                          )
                                        ) {
                                          return
                                        }
                                        try {
                                          const next = await deleteProjectConfigFile(
                                            id,
                                            draft.uploaded?.path ?? draft.path,
                                          )
                                          setConfigFiles(next)
                                          void refreshPluginConfigManager()
                                          toast({
                                            title: 'Config deleted',
                                            description: `${draft.uploaded?.path ?? draft.path} removed from project.`,
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
                                      disabled={pluginConfigManager.saving}
                                    >
                                      Delete file
                                    </Button>
                                  )}
                                </div>
                              </div>

                              <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                                <div className="field">
                                  <label htmlFor={`plugin-config-path-${draft.key}`}>Resolved path</label>
                                  <input
                                    id={`plugin-config-path-${draft.key}`}
                                    value={draft.path}
                                    onChange={(event) =>
                                      updatePluginConfigDraft(draft.key, { path: event.target.value })
                                    }
                                    placeholder={draft.defaultPath || 'plugins/example/config.yml'}
                                    disabled={pluginConfigManager.saving}
                                  />
                                  {draft.defaultPath && draft.defaultPath !== draft.path && (
                                    <p className="muted">Default: {draft.defaultPath}</p>
                                  )}
                                </div>
                                <div className="field">
                                  <label htmlFor={`plugin-config-requirement-${draft.key}`}>Requirement</label>
                                  <select
                                    id={`plugin-config-requirement-${draft.key}`}
                                    value={draft.requirement}
                                    onChange={(event) =>
                                      updatePluginConfigDraft(draft.key, {
                                        requirement: event.target.value as PluginConfigRequirement,
                                      })
                                    }
                                    disabled={pluginConfigManager.saving}
                                  >
                                    <option value="required">Required</option>
                                    <option value="optional">Optional</option>
                                    <option value="generated">Generated</option>
                                  </select>
                                </div>
                                <div className="field">
                                  <label htmlFor={`plugin-config-notes-${draft.key}`}>Notes</label>
                                  <input
                                    id={`plugin-config-notes-${draft.key}`}
                                    value={draft.notes}
                                    onChange={(event) =>
                                      updatePluginConfigDraft(draft.key, { notes: event.target.value })
                                    }
                                    placeholder="Optional guidance"
                                    disabled={pluginConfigManager.saving}
                                  />
                                </div>
                              </div>

                              <div className="config-definition-actions">
                                {draft.uploaded ? (
                                  <span className="muted">
                                    Uploaded {formatBytes(draft.uploaded.size)} ·{' '}
                                    {new Date(draft.uploaded.modifiedAt).toLocaleString()}
                                  </span>
                                ) : draft.missing ? (
                                  <span className="muted">Not uploaded yet</span>
                                ) : (
                                  <span className="muted">&nbsp;</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="form-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
                          <Button
                            type="button"
                            variant="primary"
                            disabled={pluginConfigManager.saving}
                            onClick={() => void handleSavePluginConfigManager()}
                          >
                            {pluginConfigManager.saving ? 'Saving…' : 'Save mappings'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={addCustomPluginConfigDraft}
                            disabled={pluginConfigManager.saving}
                          >
                            Add custom config
                          </Button>
                        </div>

                        {pluginConfigManager.uploads.length > 0 && (
                          <div style={{ marginTop: '1.5rem' }}>
                            <h4>Other uploaded files</h4>
                            <ul className="project-list">
                              {pluginConfigManager.uploads.map((upload) => (
                                <li key={upload.path}>
                                  <div>
                                    <strong>{upload.path}</strong>
                                    <p className="muted">
                                      {formatBytes(upload.size)} · Updated {new Date(upload.modifiedAt).toLocaleString()}
                                    </p>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </ContentSection>
                )}
              </div>
            </TabPanel>

            <TabPanel value="configs">
              <div className="assets-grid">
                <ContentSection as="article">
                  <header>
                    <h3>Plugin Config Files</h3>
                  </header>
                  <form
                    ref={configUploadFormRef}
                    className="page-form config-upload-form"
                    onSubmit={handleUploadConfig}
                  >
                    <div className="stacked-fields">
                      <div className="field">
                        <label htmlFor="config-upload-plugin">Plugin (optional)</label>
                        <select
                          id="config-upload-plugin"
                          value={configUploadPlugin}
                          onChange={(event) => {
                            const value = event.target.value
                            setConfigUploadPlugin(value)
                            setConfigUploadPathDirty(false)
                            if (value) {
                              const options = pluginDefinitionOptions[value] ?? []
                              const first = options[0]
                              setConfigUploadDefinition(first ? first.definitionId : '')
                              setConfigUploadPath(first ? first.path : '')
                            } else {
                              setConfigUploadDefinition('')
                              setConfigUploadPath('')
                            }
                          }}
                        >
                          <option value="">No association</option>
                          {(project?.plugins ?? []).map((plugin) => (
                            <option key={plugin.id} value={plugin.id}>
                              {plugin.id}
                              {plugin.configMappings && plugin.configMappings.length > 0
                                ? ` (${plugin.configMappings.length})`
                                : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="config-upload-definition">Config mapping</label>
                        <select
                          id="config-upload-definition"
                          value={configUploadDefinition}
                          onChange={(event) => {
                            const value = event.target.value
                            setConfigUploadDefinition(value)
                            setConfigUploadPathDirty(false)
                            const options = pluginDefinitionOptions[configUploadPlugin] ?? []
                            const selected = options.find((option) => option.definitionId === value)
                            if (selected) {
                              setConfigUploadPath(selected.path)
                            } else if (!value) {
                              setConfigUploadPath('')
                            }
                          }}
                          disabled={!configUploadPlugin || (pluginDefinitionOptions[configUploadPlugin] ?? []).length === 0}
                        >
                          <option value="">None</option>
                          {(pluginDefinitionOptions[configUploadPlugin] ?? []).map((option) => (
                            <option key={option.definitionId} value={option.definitionId}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {selectedDefinition?.path && (
                          <p className="muted">Suggested path: {selectedDefinition.path}</p>
                        )}
                      </div>
                      <div className="field">
                        <label htmlFor="config-upload-path">Relative path</label>
                        <input
                          id="config-upload-path"
                          value={configUploadPath}
                          onChange={(event) => {
                            setConfigUploadPath(event.target.value)
                            setConfigUploadPathDirty(true)
                          }}
                          placeholder="plugins/WorldGuard/worlds/world/regions.yml"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="config-upload-file">Config file</label>
                        <input
                          id="config-upload-file"
                          type="file"
                          ref={configUploadFileInputRef}
                          onChange={(event) => setConfigUploadFile(event.target.files?.[0] ?? null)}
                        />
                      </div>
                    </div>
                    <div className="config-upload-actions">
                      <Button type="submit" variant="ghost" disabled={configUploadBusy}>
                        {configUploadBusy ? 'Uploading…' : 'Upload config'}
                      </Button>
                    </div>
                  </form>
                  {configsError && <p className="error-text">{configsError}</p>}
                  {configsLoading && (
                    <ul className="project-list">
                      {[0, 1, 2].map((index) => (
                        <li key={index}>
                          <div>
                            <Skeleton style={{ width: '70%', height: '18px' }} />
                            <Skeleton style={{ width: '50%', height: '14px', marginTop: '8px' }} />
                          </div>
                          <div className="dev-buttons">
                            <Skeleton style={{ width: '88px', height: '32px', borderRadius: '999px' }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!configsLoading && configFiles.length === 0 && (
                    <p className="muted">
                      No plugin configs uploaded yet. Upload files to be included in your builds.
                    </p>
                  )}
                  {!configsLoading && configFiles.length > 0 && (
                    <ul className="project-list">
                      {configFiles.map((file) => (
                        <li key={file.path}>
                          <div>
                            <strong>{file.path}</strong>
                            <p className="muted">
                              {formatBytes(file.size)} · Updated {new Date(file.modifiedAt).toLocaleString()}
                            </p>
                            {file.pluginId && (
                              <p className="muted">
                                Plugin: {file.pluginId}
                                {file.definitionId ? ` · ${file.definitionId}` : ''}
                              </p>
                            )}
                          </div>
                          <div className="dev-buttons">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => void handleEditConfig(file.path)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={async () => {
                                if (!id) return
                                if (!window.confirm(`Delete config file ${file.path}? This cannot be undone.`)) {
                                  return
                                }
                                try {
                                  const next = await deleteProjectConfigFile(id, file.path)
                                  setConfigFiles(next)
                                  if (pluginConfigManager) {
                                    void refreshPluginConfigManager()
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
                              Delete
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </ContentSection>

                {configEditor && (
                  <ContentSection as="article">
                    <header>
                      <h3>Edit Config: {configEditor.path}</h3>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setConfigEditor(null)
                          setConfigEditorError(null)
                        }}
                      >
                        Close
                      </Button>
                    </header>
                    {configEditorError && <p className="error-text">{configEditorError}</p>}
                    <textarea
                      value={configEditor.content}
                      onChange={(event) =>
                        setConfigEditor((prev) => (prev ? { ...prev, content: event.target.value } : prev))
                      }
                      rows={18}
                      spellCheck={false}
                      style={{ width: '100%' }}
                    />
                    <div className="form-actions">
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => void handleSaveConfig()}
                        disabled={configEditorBusy}
                      >
                        {configEditorBusy ? 'Saving…' : 'Save changes'}
                      </Button>
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
                    </div>
                  </ContentSection>
                )}
              </div>
            </TabPanel>

            <TabPanel value="settings">
              <ContentSection as="article">
                <header>
                  <h3>Danger Zone</h3>
                </header>
                {deleteError && <p className="error-text">{deleteError}</p>}
                <p className="muted">
                  Deleting removes this project&apos;s builds, run history, and local workspace. This action
                  cannot be undone.
                </p>
                {project.repo && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={deleteRepo}
                      onChange={(event) => setDeleteRepo(event.target.checked)}
                    />
                    Also delete GitHub repository {project.repo.fullName}
                  </label>
                )}
                <div className="form-actions">
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
                </div>
              </ContentSection>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </ContentSection>
  </>
  )
}

export default ProjectDetail


