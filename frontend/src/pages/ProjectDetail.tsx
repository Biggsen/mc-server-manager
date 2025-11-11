import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Play, FileText, MagnifyingGlass, Package as PackageIcon } from '@phosphor-icons/react'
import {
  fetchProject,
  fetchBuilds,
  fetchBuildManifest,
  fetchProjectRuns,
  triggerBuild,
  triggerManifest,
  scanProjectAssets,
  runProjectLocally,
  stopRunJob,
  searchPlugins,
  addProjectPlugin,
  uploadProjectPlugin,
  fetchPluginLibrary,
  deleteProjectPlugin,
  fetchProjectConfigs,
  uploadProjectConfig,
  fetchProjectConfigFile,
  updateProjectConfigFile,
  deleteProject,
  type ProjectSummary,
  type BuildJob,
  type RunJob,
  type RunLogEntry,
  type PluginSearchResult,
  type StoredPluginRecord,
  type ProjectConfigSummary,
} from '../lib/api'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
const catalogProviderLabel: Record<'hangar' | 'modrinth' | 'spiget', string> = {
  hangar: 'Hangar',
  modrinth: 'Modrinth',
  spiget: 'Spigot',
}

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
  | StoredPluginRecord
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

  const [loading, setLoading] = useState(true)
  const initialLoadRef = useRef(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [builds, setBuilds] = useState<BuildJob[]>([])
  const [runs, setRuns] = useState<RunJob[]>([])
  const [runBusy, setRunBusy] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [manifestPreview, setManifestPreview] = useState<ManifestPreview | null>(null)
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginResults, setPluginResults] = useState<PluginSearchResult[]>([])
  const [searchStatus, setSearchStatus] = useState<string | null>(null)
  const [loadingPlugins, setLoadingPlugins] = useState(false)
  const [manualPluginId, setManualPluginId] = useState('')
  const [manualPluginVersion, setManualPluginVersion] = useState('')
  const [manualPluginUrl, setManualPluginUrl] = useState('')
  const [manualMinVersion, setManualMinVersion] = useState('')
  const [manualMaxVersion, setManualMaxVersion] = useState('')
  const [uploadPluginId, setUploadPluginId] = useState('')
  const [uploadPluginVersion, setUploadPluginVersion] = useState('')
  const [uploadPluginFile, setUploadPluginFile] = useState<File | null>(null)
  const [uploadMinVersion, setUploadMinVersion] = useState('')
  const [uploadMaxVersion, setUploadMaxVersion] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [pluginMessage, setPluginMessage] = useState<string | null>(null)
  const [libraryPlugins, setLibraryPlugins] = useState<StoredPluginRecord[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryBusy, setLibraryBusy] = useState<string | null>(null)
  const [configFiles, setConfigFiles] = useState<ProjectConfigSummary[]>([])
  const [configsLoading, setConfigsLoading] = useState(false)
  const [configsError, setConfigsError] = useState<string | null>(null)
  const [configUploadPath, setConfigUploadPath] = useState('')
  const [configUploadFile, setConfigUploadFile] = useState<File | null>(null)
  const [configUploadBusy, setConfigUploadBusy] = useState(false)
  const [configEditor, setConfigEditor] = useState<{ path: string; content: string } | null>(null)
  const [configEditorBusy, setConfigEditorBusy] = useState(false)
  const [configEditorError, setConfigEditorError] = useState<string | null>(null)
  const [deleteRepo, setDeleteRepo] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const loadLibrary = useCallback(async () => {
    try {
      setLibraryLoading(true)
      const plugins = await fetchPluginLibrary()
      setLibraryPlugins(plugins)
      setLibraryError(null)
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : 'Failed to load saved plugins.')
    } finally {
      setLibraryLoading(false)
    }
  }, [])

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

  const handleStopRun = useCallback(
    async (target: RunJob) => {
      try {
        setRunBusy((prev) => ({ ...prev, [target.id]: true }))
        const updated = await stopRunJob(target.id)
        setRuns((prev) =>
          prev.map((run) => (run.id === updated.id ? { ...run, ...updated } : run)),
        )
        setMessage(`Stop requested for run ${target.id}`)
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Failed to stop run')
      } finally {
        setRunBusy((prev) => {
          const next = { ...prev }
          delete next[target.id]
          return next
        })
      }
    },
    [],
  )

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
    void loadLibrary()
  }, [loadLibrary])

useEffect(() => {
  void loadConfigs()
}, [loadConfigs])

  useEffect(() => {
    if (!project) {
      return
    }
    setManualMinVersion((prev) => prev || project.minecraftVersion)
    setManualMaxVersion((prev) => prev || project.minecraftVersion)
    setUploadMinVersion((prev) => prev || project.minecraftVersion)
    setUploadMaxVersion((prev) => prev || project.minecraftVersion)
  }, [project])

  useEffect(() => {
    if (!project?.repo) {
      setDeleteRepo(false)
    }
  }, [project?.repo])

  const latestBuild = useMemo(
    () => builds.find((build) => build.status === 'succeeded'),
    [builds],
  )

  const filteredLibrary = useMemo(() => {
    const term = libraryQuery.trim().toLowerCase()
    if (!term) {
      return libraryPlugins
    }
    return libraryPlugins.filter((plugin) => {
      const haystack = [
        plugin.id,
        plugin.version,
        plugin.provider,
        plugin.source?.slug,
        plugin.source?.projectUrl,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [libraryPlugins, libraryQuery])

  const projectPluginKeys = useMemo(() => {
    if (!project?.plugins) {
      return new Set<string>()
    }
    return new Set(project.plugins.map((plugin) => `${plugin.id}:${plugin.version}`))
  }, [project?.plugins])

  const handleAddLibraryPlugin = useCallback(
    async (plugin: StoredPluginRecord) => {
      if (!id) {
        return
      }
      try {
        setLibraryBusy(`${plugin.id}:${plugin.version}`)
        const plugins = await addProjectPlugin(id, {
          pluginId: plugin.id,
          version: plugin.version,
          provider: plugin.provider,
          downloadUrl: plugin.source?.downloadUrl,
          minecraftVersionMin: plugin.minecraftVersionMin ?? plugin.source?.minecraftVersionMin,
          minecraftVersionMax: plugin.minecraftVersionMax ?? plugin.source?.minecraftVersionMax,
          cachePath: plugin.cachePath ?? plugin.source?.cachePath,
          source: plugin.source,
        })
        setProject((prev) => (prev ? { ...prev, plugins: plugins ?? prev.plugins } : prev))
        setPluginMessage(`Added ${plugin.id} ${plugin.version} from saved plugins.`)
        await loadLibrary()
      } catch (err) {
        setPluginMessage(
          err instanceof Error ? err.message : 'Failed to add plugin from saved library.',
        )
      } finally {
        setLibraryBusy(null)
      }
    },
    [id, loadLibrary],
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
        setPluginMessage(`Removed plugin ${pluginId}`)
      } catch (err) {
        setPluginMessage(err instanceof Error ? err.message : 'Failed to remove plugin.')
      }
    },
    [id],
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
        })
        setConfigFiles(configs)
        setConfigsError(null)
        setConfigUploadPath('')
        setConfigUploadFile(null)
        if (event.currentTarget instanceof HTMLFormElement) {
          event.currentTarget.reset()
        }
      } catch (err) {
        setConfigsError(err instanceof Error ? err.message : 'Failed to upload config file.')
      } finally {
        setConfigUploadBusy(false)
      }
    },
    [configUploadFile, configUploadPath, id],
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
      navigate('/projects')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete project.')
    } finally {
      setDeleteBusy(false)
    }
  }, [deleteRepo, id, navigate, project])

  if (!id) {
    return (
      <section className="panel">
        <p className="error-text">Project identifier missing.</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="panel">
        <p className="muted">Loading project…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="panel">
        <p className="error-text">{error}</p>
        <button
          type="button"
          className="ghost"
          onClick={() => navigate('/projects')}
        >
          Back to Projects
        </button>
      </section>
    )
  }

  if (!project) {
    return (
      <section className="panel">
        <p className="error-text">Project not found.</p>
        <button
          type="button"
          className="ghost"
          onClick={() => navigate('/projects')}
        >
          Back to Projects
        </button>
      </section>
    )
  }

  const pluginCount = project.plugins?.length ?? 0
  const lastManifestGenerated =
    project.manifest?.generatedAt ? new Date(project.manifest.generatedAt).toLocaleString() : '—'

  const handleTriggerBuild = async () => {
    try {
      setBusy(true)
      const build = await triggerBuild(project.id)
      setMessage(`Triggered build ${build.id}`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to queue build')
    } finally {
      setBusy(false)
    }
  }

  const handleGenerateManifest = async () => {
    try {
      setBusy(true)
      const manifest = await triggerManifest(project.id)
      setMessage(
        manifest.manifest?.lastBuildId
          ? `Manifest ${manifest.manifest.lastBuildId} generated`
          : 'Manifest generated',
      )
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Manifest generation failed')
    } finally {
      setBusy(false)
    }
  }

  const handleScanAssets = async () => {
    try {
      setBusy(true)
      const assets = await scanProjectAssets(project.id)
      setMessage(`Scanned ${assets.plugins.length} plugins, ${assets.configs.length} configs`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Asset scan failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRunLocally = async () => {
    try {
      setBusy(true)
      const run = await runProjectLocally(project.id)
      setMessage(`Run queued (${run.status.toUpperCase()})`)
      setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)])
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Run failed to queue')
    } finally {
      setBusy(false)
    }
  }

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
              <span className="project-summary-card__meta-label">Last manifest</span>
              <strong>{lastManifestGenerated}</strong>
            </div>
          </div>
          <div className="project-summary-card__actions">
            <Button
              variant="primary"
              icon={<PackageIcon size={18} weight="fill" aria-hidden="true" />}
              onClick={handleTriggerBuild}
              disabled={busy}
            >
              Trigger build
            </Button>
            <Button
              variant="ghost"
              icon={<FileText size={18} weight="fill" aria-hidden="true" />}
              onClick={handleGenerateManifest}
              disabled={busy}
            >
              Generate manifest
            </Button>
            <Button
              variant="ghost"
              icon={<MagnifyingGlass size={18} weight="bold" aria-hidden="true" />}
              onClick={handleScanAssets}
              disabled={busy}
            >
              Scan assets
            </Button>
            <Button
              variant="pill"
              icon={<Play size={18} weight="fill" aria-hidden="true" />}
              onClick={handleRunLocally}
              disabled={busy}
            >
              Run locally
            </Button>
            <Button
              variant="link"
              onClick={() => navigate(`/projects/${project.id}/profile`)}
              disabled={busy}
            >
              Generate profile YAML
            </Button>
          </div>
          {message && <p className="project-summary-card__message">{message}</p>}
        </CardContent>
      </Card>

      <section className="panel">
      <div className="layout-grid">
        <article className="panel">
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
        </article>

        {project.plugins && project.plugins.length > 0 && (
          <article className="panel">
            <header>
              <h3>Configured Plugins</h3>
            </header>
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
                    </div>
                  </li>
                )
              })}
            </ul>
          </article>
        )}

      </div>

      <article className="panel">
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
                    <button
                      type="button"
                      className="ghost"
                      onClick={async () => {
                        try {
                          const manifest = await fetchBuildManifest(build.id)
                          setManifestPreview({
                            buildId: build.manifestBuildId ?? build.id,
                            content: manifest,
                          })
                        } catch (err) {
                          setMessage(
                            err instanceof Error
                              ? err.message
                              : 'Failed to load manifest',
                          )
                        }
                      }}
                    >
                      View Manifest
                    </button>
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
      </article>

      <details className="panel" open>
        <summary>Local Runs</summary>
        {runs.length === 0 && <p className="muted">No local run activity yet.</p>}
        {runs.length > 0 && (
          <ul className="project-list">
            {runs.map((run) => (
              <li key={run.id}>
                <div>
                  <strong>{run.id}</strong>
                  <p className="muted">
                    <span className="badge">{runStatusLabel[run.status]}</span> · Started{' '}
                    {new Date(run.createdAt).toLocaleString()}
                    {run.finishedAt && (
                      <>
                        {' '}
                        · Finished {new Date(run.finishedAt).toLocaleString()}
                      </>
                    )}
                  </p>
                  {run.port && (
                    <p className="muted">
                      Port: {run.port} (exposed on localhost)
                    </p>
                  )}
                  {run.containerName && <p className="muted">Container: {run.containerName}</p>}
                  {run.workspacePath && (
                    <p className="muted">
                      Workspace: <code>{run.workspacePath}</code>
                    </p>
                  )}
                  {run.logs.length > 0 && (
                    <details>
                      <summary>View logs</summary>
                      <pre className="log-box">
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
                  {run.error && <p className="error-text">{run.error}</p>}
                </div>
                {(run.status === 'running' || run.status === 'pending' || run.status === 'stopping') && (
                  <div className="dev-buttons">
                    <button
                      type="button"
                      className="ghost"
                      disabled={run.status === 'stopping' || runBusy[run.id]}
                      onClick={() => handleStopRun(run)}
                    >
                      {run.status === 'stopping' || runBusy[run.id] ? 'Stopping…' : 'Stop'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      {manifestPreview && (
        <article className="panel">
          <header>
            <h3>Manifest: {manifestPreview.buildId}</h3>
            <button
              type="button"
              className="ghost"
              onClick={() => setManifestPreview(null)}
            >
              Close
            </button>
          </header>
          <pre className="log-box">
            {JSON.stringify(manifestPreview.content, null, 2)}
          </pre>
        </article>
      )}

      <article className="panel">
        <header>
          <h3>Plugin Config Files</h3>
        </header>
        <form className="page-form" onSubmit={handleUploadConfig}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="config-upload-path">Relative path</label>
              <input
                id="config-upload-path"
                value={configUploadPath}
                onChange={(event) => setConfigUploadPath(event.target.value)}
                placeholder="plugins/WorldGuard/worlds/world/regions.yml"
              />
            </div>
            <div className="field">
              <label htmlFor="config-upload-file">Config file</label>
              <input
                id="config-upload-file"
                type="file"
                onChange={(event) => setConfigUploadFile(event.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="ghost" disabled={configUploadBusy}>
              {configUploadBusy ? 'Uploading…' : 'Upload config'}
            </button>
          </div>
        </form>
        {configsError && <p className="error-text">{configsError}</p>}
        {configsLoading && <p className="muted">Loading config files…</p>}
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
                </div>
                <div className="dev-buttons">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void handleEditConfig(file.path)}
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      {configEditor && (
        <article className="panel">
          <header>
            <h3>Edit Config: {configEditor.path}</h3>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setConfigEditor(null)
                setConfigEditorError(null)
              }}
            >
              Close
            </button>
          </header>
          {configEditorError && <p className="error-text">{configEditorError}</p>}
          <textarea
            value={configEditor.content}
            onChange={(event) =>
              setConfigEditor((prev) =>
                prev ? { ...prev, content: event.target.value } : prev,
              )
            }
            rows={18}
            spellCheck={false}
            style={{ width: '100%' }}
          />
          <div className="form-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void handleSaveConfig()}
              disabled={configEditorBusy}
            >
              {configEditorBusy ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setConfigEditor(null)
                setConfigEditorError(null)
              }}
              disabled={configEditorBusy}
            >
              Cancel
            </button>
          </div>
        </article>
      )}

      <article className="panel">
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
          <button
            type="button"
            className="danger"
            onClick={handleDeleteProject}
            disabled={deleteBusy}
          >
            {deleteBusy ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </article>

      <article className="panel">
        <header>
          <h3>Add Plugin</h3>
        </header>
        <section>
          <header>
            <h4>Saved Plugins</h4>
          </header>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="saved-plugin-search">Search saved plugins</label>
              <input
                id="saved-plugin-search"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Filter by name, version, or source"
              />
            </div>
          </div>
          {libraryError && <p className="error-text">{libraryError}</p>}
          {libraryLoading && <p className="muted">Loading saved plugins…</p>}
          {!libraryLoading && filteredLibrary.length === 0 && (
            <p className="muted">
              {libraryQuery.trim()
                ? 'No saved plugins match that search.'
                : 'No saved plugins yet. Add one via download URL or upload to populate this list.'}
            </p>
          )}
          {!libraryLoading && filteredLibrary.length > 0 && (
            <ul className="project-list">
              {filteredLibrary.map((plugin) => {
                const key = `${plugin.id}:${plugin.version}`
                const supportRange = formatMinecraftRange(
                  plugin.minecraftVersionMin ?? plugin.source?.minecraftVersionMin,
                  plugin.minecraftVersionMax ?? plugin.source?.minecraftVersionMax,
                )
                const alreadyAdded = projectPluginKeys.has(key)
                const busyKey = libraryBusy === key
                const sourceKind = getStoredPluginSourceKind(plugin)
                return (
                  <li key={key}>
                    <div>
                      <strong>{plugin.id}</strong>{' '}
                      <span className="badge">{sourceBadgeLabel[sourceKind]}</span>{' '}
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
                      {plugin.cachePath && <p className="muted">Cache: {plugin.cachePath}</p>}
                      {plugin.artifactFileName && (
                        <p className="muted">Artifact: {plugin.artifactFileName}</p>
                      )}
                      {plugin.cachedAt && (
                        <p className="muted">
                          Cached {new Date(plugin.cachedAt).toLocaleString()}
                        </p>
                      )}
                      {plugin.lastUsedAt && (
                        <p className="muted">
                          Last used {new Date(plugin.lastUsedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="dev-buttons">
                      <button
                        type="button"
                        className="primary"
                        disabled={alreadyAdded || busyKey}
                        onClick={() => void handleAddLibraryPlugin(plugin)}
                      >
                        {alreadyAdded
                          ? 'Already added'
                          : busyKey
                          ? 'Adding…'
                          : 'Add to server'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <form
          className="page-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!pluginQuery.trim()) return
            try {
              setLoadingPlugins(true)
              setSearchStatus(null)
              const results = await searchPlugins(
                pluginQuery,
                project.loader,
                project.minecraftVersion,
              )
              setPluginResults(results)
              if (results.length === 0) {
                setSearchStatus('No plugins found for that query.')
              }
            } catch (err) {
              setSearchStatus(err instanceof Error ? err.message : 'Search failed')
            } finally {
              setLoadingPlugins(false)
            }
          }}
        >
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="plugin-search">Search external catalogs</label>
              <input
                id="plugin-search"
                value={pluginQuery}
                onChange={(event) => setPluginQuery(event.target.value)}
                placeholder="WorldGuard, LuckPerms, ..."
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="ghost" disabled={loadingPlugins}>
              {loadingPlugins ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchStatus && <p className="muted">{searchStatus}</p>}
        </form>

        {pluginResults.length > 0 && (
          <div className="layout-grid">
            <section className="panel">
              <header>
                <h4>External results</h4>
              </header>
              <ul className="project-list">
                {pluginResults.map((result) => (
                  <li key={`${result.provider}:${result.slug}`}>
                    <div>
                      <strong>{result.name}</strong>{' '}
                      <span className="badge">{catalogProviderLabel[result.provider]}</span>
                      <p className="muted">
                        {result.slug} ·{' '}
                        <a
                          href={`https://google.com/search?q=${encodeURIComponent(`${result.name} ${project.loader} ${project.minecraftVersion}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Search releases
                        </a>
                      </p>
                      {result.summary && <p className="muted">{result.summary}</p>}
                      {result.projectUrl && (
                        <a href={result.projectUrl} target="_blank" rel="noreferrer">
                          View project
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
        <div className="layout-grid">
          <section className="panel">
            <header>
              <h4>Add via Download URL</h4>
            </header>
            <form
              className="page-form"
              onSubmit={async (event) => {
                event.preventDefault()
                if (
                  !manualPluginId.trim() ||
                  !manualPluginVersion.trim() ||
                  !manualPluginUrl.trim() ||
                  !manualMinVersion.trim() ||
                  !manualMaxVersion.trim()
                ) {
                  setPluginMessage(
                    'Plugin ID, version, download URL, and Minecraft version range are required.',
                  )
                  return
                }
                try {
                  setManualBusy(true)
                  const plugins = await addProjectPlugin(project.id, {
                    pluginId: manualPluginId.trim(),
                    version: manualPluginVersion.trim(),
                    provider: 'custom',
                    downloadUrl: manualPluginUrl.trim(),
                    minecraftVersionMin: manualMinVersion.trim(),
                    minecraftVersionMax: manualMaxVersion.trim(),
                  })
                  setProject((prev) =>
                    prev ? { ...prev, plugins: plugins ?? prev.plugins } : prev,
                  )
                  await loadLibrary()
                  setPluginMessage(`Added ${manualPluginId.trim()} ${manualPluginVersion.trim()}`)
                  setManualPluginId('')
                  setManualPluginVersion('')
                  setManualPluginUrl('')
                  setManualMinVersion('')
                  setManualMaxVersion('')
                } catch (err) {
                  setPluginMessage(err instanceof Error ? err.message : 'Failed to add plugin.')
                } finally {
                  setManualBusy(false)
                }
              }}
            >
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="manual-plugin-id">Plugin ID</label>
                  <input
                    id="manual-plugin-id"
                    value={manualPluginId}
                    onChange={(event) => setManualPluginId(event.target.value)}
                    placeholder="worldguard"
                  />
                </div>
                <div className="field">
                  <label htmlFor="manual-plugin-version">Version</label>
                  <input
                    id="manual-plugin-version"
                    value={manualPluginVersion}
                    onChange={(event) => setManualPluginVersion(event.target.value)}
                    placeholder="7.0.10"
                  />
                </div>
                <div className="field">
                  <label htmlFor="manual-plugin-min-version">Min Minecraft Version</label>
                  <input
                    id="manual-plugin-min-version"
                    value={manualMinVersion}
                    onChange={(event) => setManualMinVersion(event.target.value)}
                    placeholder={project.minecraftVersion}
                  />
                </div>
                <div className="field">
                  <label htmlFor="manual-plugin-max-version">Max Minecraft Version</label>
                  <input
                    id="manual-plugin-max-version"
                    value={manualMaxVersion}
                    onChange={(event) => setManualMaxVersion(event.target.value)}
                    placeholder={project.minecraftVersion}
                  />
                </div>
                <div className="field span-2">
                  <label htmlFor="manual-plugin-url">Download URL</label>
                  <input
                    id="manual-plugin-url"
                    value={manualPluginUrl}
                    onChange={(event) => setManualPluginUrl(event.target.value)}
                    placeholder="https://example.com/plugin.jar"
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="primary" disabled={manualBusy}>
                  {manualBusy ? 'Adding…' : 'Add Plugin'}
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <header>
              <h4>Upload Plugin Jar</h4>
            </header>
            <form
              className="page-form"
              onSubmit={async (event) => {
                event.preventDefault()
                if (
                  !uploadPluginId.trim() ||
                  !uploadPluginVersion.trim() ||
                  !uploadPluginFile ||
                  !uploadMinVersion.trim() ||
                  !uploadMaxVersion.trim()
                ) {
                  setPluginMessage(
                    'Plugin ID, version, file, and Minecraft version range are required.',
                  )
                  return
                }
                try {
                  setUploadBusy(true)
                  const plugins = await uploadProjectPlugin(project.id, {
                    pluginId: uploadPluginId.trim(),
                    version: uploadPluginVersion.trim(),
                    file: uploadPluginFile,
                    minecraftVersionMin: uploadMinVersion.trim(),
                    minecraftVersionMax: uploadMaxVersion.trim(),
                  })
                  setProject((prev) =>
                    prev ? { ...prev, plugins: plugins ?? prev.plugins } : prev,
                  )
                  await loadLibrary()
                  setPluginMessage(`Uploaded ${uploadPluginId.trim()} ${uploadPluginVersion.trim()}`)
                  setUploadPluginId('')
                  setUploadPluginVersion('')
                  setUploadPluginFile(null)
                  setUploadMinVersion('')
                  setUploadMaxVersion('')
                  if (event.currentTarget instanceof HTMLFormElement) {
                    event.currentTarget.reset()
                  }
                } catch (err) {
                  setPluginMessage(err instanceof Error ? err.message : 'Failed to upload plugin.')
                } finally {
                  setUploadBusy(false)
                }
              }}
            >
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="upload-plugin-id">Plugin ID</label>
                  <input
                    id="upload-plugin-id"
                    value={uploadPluginId}
                    onChange={(event) => setUploadPluginId(event.target.value)}
                    placeholder="my-custom-plugin"
                  />
                </div>
                <div className="field">
                  <label htmlFor="upload-plugin-version">Version</label>
                  <input
                    id="upload-plugin-version"
                    value={uploadPluginVersion}
                    onChange={(event) => setUploadPluginVersion(event.target.value)}
                    placeholder="1.0.0"
                  />
                </div>
                <div className="field">
                  <label htmlFor="upload-plugin-min-version">Min Minecraft Version</label>
                  <input
                    id="upload-plugin-min-version"
                    value={uploadMinVersion}
                    onChange={(event) => setUploadMinVersion(event.target.value)}
                    placeholder={project.minecraftVersion}
                  />
                </div>
                <div className="field">
                  <label htmlFor="upload-plugin-max-version">Max Minecraft Version</label>
                  <input
                    id="upload-plugin-max-version"
                    value={uploadMaxVersion}
                    onChange={(event) => setUploadMaxVersion(event.target.value)}
                    placeholder={project.minecraftVersion}
                  />
                </div>
                <div className="field span-2">
                  <label htmlFor="upload-plugin-file">Plugin Jar</label>
                  <input
                    id="upload-plugin-file"
                    type="file"
                    accept=".jar,.zip"
                    onChange={(event) => setUploadPluginFile(event.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="primary" disabled={uploadBusy}>
                  {uploadBusy ? 'Uploading…' : 'Upload Plugin'}
                </button>
              </div>
            </form>
          </section>
        </div>
        {pluginMessage && <p className="muted">{pluginMessage}</p>}
      </article>
    </section>
  </>
  )
}

export default ProjectDetail


