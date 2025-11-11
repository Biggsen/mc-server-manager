import { ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building, Plug } from '@phosphor-icons/react'
import { Button, type ButtonProps } from '../components/ui'
import {
  fetchProjects,
  triggerBuild,
  fetchPluginLibrary,
  fetchRuns,
  stopRunJob,
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
          const merged: RunJob = {
            ...existing,
            ...normalized,
            logs: existing.logs ?? normalized.logs ?? [],
          }
          const next = prev.slice()
          next[index] = merged
          return next
        })
      } catch (err) {
        console.error('Failed to parse run update payload', err)
      }
    }

    source.addEventListener('init', handleInit as EventListener)
    source.addEventListener('run-update', handleRunUpdate as EventListener)
    source.onerror = (event) => {
      console.error('Run stream error', event)
    }

    return () => {
      source.removeEventListener('init', handleInit as EventListener)
      source.removeEventListener('run-update', handleRunUpdate as EventListener)
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

  const handleStopRun = async (run: RunJob) => {
    try {
      setRunBusy((prev) => ({ ...prev, [run.id]: true }))
      const updated = await stopRunJob(run.id)
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) {
      console.error('Failed to stop run', err)
      setRunsError(err instanceof Error ? err.message : 'Failed to stop run')
    } finally {
      setRunBusy((prev) => {
        const next = { ...prev }
        delete next[run.id]
        return next
      })
    }
  }

  return (
    <>
      <section className="dashboard-hero">
        <div className="hero-headline">
          <h2>Mission control</h2>
          <p className="hero-subtitle">
            Track your Paper servers, watch active runs, and keep plugins aligned across every
            environment.
          </p>
        </div>

        <div className="hero-metrics">
          <div className="metric-card">
            <span className="metric-value">{projects.length}</span>
            <span className="metric-label">Projects</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{activeRuns.length}</span>
            <span className="metric-label">Active runs</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{library.length}</span>
            <span className="metric-label">Saved plugins</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">
              {latestManifest ? latestManifest.toLocaleTimeString() : '—'}
            </span>
            <span className="metric-label">{latestManifestLabel}</span>
          </div>
        </div>

        <div className="quick-actions">
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
        </div>
      </section>

      <section className="dashboard-stack">
        <article className="panel">
        <header>
          <h2>Recent Projects</h2>
            <Link to="/projects" className="link">
            View all
          </Link>
        </header>
        {loading && <p className="muted">Loading projects…</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && recent.length === 0 && (
          <p className="empty-state">No projects yet. Create your first Paper server to get started.</p>
        )}
        {!loading && !error && recent.length > 0 && (
          <ul className="project-list">
            {recent.map((project) => (
              <li key={project.id}>
                <div>
                  <h4>
                    <Link to={`/projects/${project.id}`}>{project.name}</Link>
                  </h4>
                  <p className="muted">
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
                  </p>
                </div>
                <div className="dev-buttons">
                  <button
                    type="button"
                    className="ghost"
                    disabled={building[project.id] === 'running'}
                    onClick={async () => {
                      try {
                        setBuilding((prev) => ({ ...prev, [project.id]: 'running' }))
                        const build = await triggerBuild(project.id)
                        setBuilding((prev) => ({ ...prev, [project.id]: build.status }))
                      } catch (err) {
                        setBuilding((prev) => ({ ...prev, [project.id]: 'failed' }))
                        console.error('Failed to trigger build', err)
                      }
                    }}
                  >
                    {building[project.id] === 'running' ? 'Building…' : 'Build'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        </article>

        <article className="panel">
        <header>
          <h2>Active Local Servers</h2>
        </header>
        {runsLoading && <p className="muted">Checking active runs…</p>}
        {runsError && <p className="error-text">{runsError}</p>}
        {!runsLoading && !runsError && activeRuns.length === 0 && (
          <p className="muted">No local servers are running right now.</p>
        )}
        {!runsLoading && !runsError && activeRuns.length > 0 && (
          <ul className="project-list">
            {activeRuns.map((run) => {
              const project = projectLookup[run.projectId]
              return (
                <li key={run.id}>
                  <div>
                    <h4>
                      {project ? project.name : run.projectId}{' '}
                      <span className="badge">{runStatusLabel[run.status]}</span>
                    </h4>
                    <p className="muted">
                      Started {new Date(run.createdAt).toLocaleString()}
                      {run.port && <> · Port {run.port}</>}
                      {project?.minecraftVersion && <> · {project.minecraftVersion}</>}
                    </p>
                    {run.containerName && <p className="muted">Container: {run.containerName}</p>}
                    {project && (
                      <p className="muted">
                        Loader: {project.loader.toUpperCase()}{' '}
                        {project.repo?.fullName ? `· ${project.repo.fullName}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="dev-buttons">
                    <Link className="ghost" to={`/projects/${run.projectId}`}>
                      View project
                    </Link>
                    <button
                      type="button"
                      className="ghost"
                      disabled={run.status === 'stopping' || runBusy[run.id]}
                      onClick={() => handleStopRun(run)}
                    >
                      {run.status === 'stopping' || runBusy[run.id] ? 'Stopping…' : 'Stop'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        </article>
      </section>

      <section className="dashboard-stack">
        <article className="panel">
        <header>
          <h2>Saved Plugins</h2>
          <Link to="/plugins" className="link">
            Browse library
          </Link>
        </header>
        {libraryLoading && <p className="muted">Loading plugins…</p>}
        {libraryError && <p className="error-text">{libraryError}</p>}
        {!libraryLoading && !libraryError && library.length === 0 && (
          <p className="muted">No saved plugins yet. Add one from a project to populate the library.</p>
        )}
        {!libraryLoading && !libraryError && library.length > 0 && (
          <ul className="project-list">
            {library.slice(0, 5).map((plugin) => (
              <li key={`${plugin.id}:${plugin.version}`}>
                <div>
                  <strong>{plugin.id}</strong>{' '}
                  <span className="muted">{sourceLabel[getPluginSourceKind(plugin)]}</span>{' '}
                  <span className="muted">v{plugin.version}</span>
                  {plugin.cachePath && (
                    <p className="muted">
                      Cache: <code>{plugin.cachePath}</code>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        </article>

        <article className="panel">
          <header>
            <h3>Resources</h3>
          </header>
          <ul>
            <li>Plugin registry overview</li>
            <li>Overlay configuration guide</li>
            <li>Deterministic build checklist</li>
          </ul>
        </article>
      </section>
    </>
  )
}

export default Dashboard

