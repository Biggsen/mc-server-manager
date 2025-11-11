import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Buildings } from '@phosphor-icons/react'
import {
  fetchProjects,
  triggerBuild,
  triggerManifest,
  scanProjectAssets,
  fetchBuilds,
  runProjectLocally,
  fetchRuns,
  type ProjectSummary,
  type BuildJob,
  type RunJob,
} from '../lib/api'
import { subscribeProjectsUpdated } from '../lib/events'

type ProjectMessage = { type: 'success' | 'error'; text: string }

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

const ACTIVE_STATUSES = new Set<RunJob['status']>(['pending', 'running', 'stopping'])

function isActiveRun(run: RunJob | undefined): boolean {
  return !!run && ACTIVE_STATUSES.has(run.status)
}

function preferRun(current: RunJob | undefined, candidate: RunJob): RunJob {
  if (!current) {
    return candidate
  }
  if (isActiveRun(candidate)) {
    return candidate
  }
  if (isActiveRun(current)) {
    return current
  }
  return candidate.createdAt > current.createdAt ? candidate : current
}

function describeRunStatus(run: RunJob): string {
  const portInfo = run.port ? ` on port ${run.port}` : ''
  switch (run.status) {
    case 'pending':
      return 'Local server starting…'
    case 'running':
      return `Local server started${portInfo}`
    case 'stopping':
      return 'Stopping local server…'
    case 'stopped':
      return 'Local server stopped'
    case 'succeeded':
      return 'Local server exited normally'
    case 'failed':
      return `Local server failed${run.error ? ` — ${run.error}` : ''}`
    default:
      return `Local server ${run.status}`
  }
}

function projectMessageForRun(run: RunJob): ProjectMessage {
  return {
    type: run.status === 'failed' ? 'error' : 'success',
    text: describeRunStatus(run),
  }
}

function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState<Record<string, BuildJob['status']>>({})
  const [builds, setBuilds] = useState<Record<string, BuildJob | undefined>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Record<string, ProjectMessage | undefined>>({})

  useEffect(() => {
    let active = true

    const loadProjects = () => {
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

    loadProjects()
    const unsubscribe = subscribeProjectsUpdated(loadProjects)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadBuilds = () => {
      fetchBuilds()
        .then((items) => {
          if (cancelled) return
          const latest: Record<string, BuildJob> = {}
          for (const build of items) {
            const existing = latest[build.projectId]
            if (!existing || existing.createdAt < build.createdAt) {
              latest[build.projectId] = build
            }
          }
          setBuilds(latest)
        })
        .catch((err: Error) => {
          console.error('Failed to load build history', err)
        })
    }

    loadBuilds()
    const interval = window.setInterval(loadBuilds, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    setBuilding((prev) => {
      const next = { ...prev }
      Object.entries(builds).forEach(([projectId, build]) => {
        if (build && build.status !== 'running') {
          next[projectId] = build.status
        }
      })
      return next
    })
  }, [builds])

  const setProjectMessage = (projectId: string, message?: ProjectMessage) => {
    setMessages((prev) => ({ ...prev, [projectId]: message }))
  }

  const setProjectBusy = (projectId: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [projectId]: value }))
  }

  useEffect(() => {
    let cancelled = false
    fetchRuns()
      .then((runs) => {
        if (cancelled) return
        const latestByProject = runs.reduce<Record<string, RunJob>>((acc, run) => {
          acc[run.projectId] = preferRun(acc[run.projectId], run)
          return acc
        }, {})
        setMessages((prev) => {
          const next = { ...prev }
          Object.entries(latestByProject).forEach(([projectId, run]) => {
            next[projectId] = projectMessageForRun(run)
          })
          return next
        })
      })
      .catch((err: Error) => {
        console.error('Failed to load run status', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const base =
      API_BASE.startsWith('http://') || API_BASE.startsWith('https://')
        ? API_BASE
        : `${window.location.origin}${API_BASE}`
    const urlBase = base.endsWith('/') ? base.slice(0, -1) : base
    const source = new EventSource(`${urlBase}/runs/stream`, { withCredentials: true })

    const latestRunsRef = new Map<string, RunJob>()

    const updateMessage = (run: RunJob) => {
      const preferred = preferRun(latestRunsRef.get(run.projectId), run)
      latestRunsRef.set(run.projectId, preferred)

      if (isActiveRun(preferred) || preferred.status === 'failed') {
        setMessages((prev) => ({
          ...prev,
          [run.projectId]: projectMessageForRun(preferred),
        }))
      } else if (preferred.status === 'stopped' || preferred.status === 'succeeded') {
        setMessages((prev) => {
          const next = { ...prev }
          delete next[run.projectId]
          return next
        })
      } else {
        setMessages((prev) => ({
          ...prev,
          [run.projectId]: projectMessageForRun(preferred),
        }))
      }
    }

    const handleInit = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { runs: RunJob[] }
        if (Array.isArray(payload.runs)) {
          payload.runs.forEach((run) => {
            const preferred = preferRun(latestRunsRef.get(run.projectId), run)
            latestRunsRef.set(run.projectId, preferred)
          })
          const nextMessages: Record<string, ProjectMessage> = {}
          latestRunsRef.forEach((storedRun, projectId) => {
            if (isActiveRun(storedRun) || storedRun.status === 'failed') {
              nextMessages[projectId] = projectMessageForRun(storedRun)
            }
          })
          setMessages((prev) => ({ ...prev, ...nextMessages }))
        }
      } catch (err) {
        console.error('Failed to parse run stream init payload', err)
      }
    }

    const handleRunUpdate = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { run: RunJob }
        if (payload.run) {
          updateMessage(payload.run)
        }
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

  return (
    <section className="panel">
      <header>
        <h2>
          <span className="title-icon" aria-hidden="true">
            <Buildings size={22} weight="fill" />
          </span>
          All Projects
        </h2>
        <p className="muted">Projects synced with your GitHub account will appear here.</p>
      </header>
      {loading && <p className="muted">Loading projects…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <div className="empty-state">Nothing to show yet. Trigger your first build and we’ll track it here.</div>
      )}
      {!loading && !error && projects.length > 0 && (
        <ul className="project-list">
          {projects.map((project) => {
            const latestBuild = builds[project.id]
            const repoUrl = project.repo?.htmlUrl
            const repoLabel = project.repo?.fullName ?? project.repo?.name
            const commitSha = project.manifest?.commitSha
            const buildStatus = latestBuild?.status ?? building[project.id] ?? 'idle'

            return (
              <li key={project.id}>
                <div>
                <h4>
                  <Link to={`/projects/${project.id}`}>{project.name}</Link>
                </h4>
                  <p className="muted">
                    {[
                      project.minecraftVersion,
                      project.loader.toUpperCase(),
                      project.source === 'imported' ? 'Imported' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {repoUrl && repoLabel && (
                    <p className="muted">
                      Repo:{' '}
                      <a href={repoUrl} target="_blank" rel="noreferrer">
                        {repoLabel}
                      </a>
                    </p>
                  )}
                  <p className="muted">
                    {latestBuild
                      ? `Build status: ${latestBuild.status.toUpperCase()}${
                          latestBuild.finishedAt
                            ? ` · ${new Date(
                                latestBuild.finishedAt ?? latestBuild.createdAt,
                              ).toLocaleTimeString()}`
                            : ''
                        }${latestBuild.error ? ` — ${latestBuild.error}` : ''}`
                      : 'Build status: IDLE'}
                  </p>
                  {project.manifest && (
                    <p className="muted">
                      Manifest:{' '}
                      {project.manifest.lastBuildId}{' '}
                      {commitSha && repoUrl ? (
                        <a
                          href={`${repoUrl.replace(/\.git$/, '')}/commit/${commitSha}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ({commitSha.slice(0, 7)})
                        </a>
                      ) : null}
                    </p>
                  )}
                </div>
                <div className="dev-buttons">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy[project.id] || buildStatus === 'running'}
                    onClick={async () => {
                      try {
                        setProjectBusy(project.id, true)
                        setBuilding((prev) => ({ ...prev, [project.id]: 'running' }))
                        const build = await triggerBuild(project.id)
                        setBuilding((prev) => ({ ...prev, [project.id]: build.status }))
                        setProjectMessage(project.id, {
                          type: 'success',
                          text: `Triggered build ${build.id}`,
                        })
                      } catch (err) {
                        console.error('Failed to queue build', err)
                        setBuilding((prev) => ({ ...prev, [project.id]: 'failed' }))
                        setProjectMessage(project.id, {
                          type: 'error',
                          text: err instanceof Error ? err.message : 'Failed to queue build',
                        })
                      } finally {
                        setProjectBusy(project.id, false)
                      }
                    }}
                  >
                    {buildStatus === 'running' ? 'Building…' : 'Build'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy[project.id]}
                    onClick={async () => {
                      try {
                        setProjectBusy(project.id, true)
                        const manifest = await triggerManifest(project.id)
                        setProjectMessage(project.id, {
                          type: 'success',
                          text: `Manifest ${manifest.manifest?.lastBuildId ?? 'generated'}`,
                        })
                      } catch (err) {
                        console.error('Failed to generate manifest', err)
                        setProjectMessage(project.id, {
                          type: 'error',
                          text: err instanceof Error ? err.message : 'Manifest generation failed',
                        })
                      } finally {
                        setProjectBusy(project.id, false)
                      }
                    }}
                  >
                    Generate Manifest
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy[project.id]}
                    onClick={async () => {
                      try {
                        setProjectBusy(project.id, true)
                        const assets = await scanProjectAssets(project.id)
                        setProjectMessage(project.id, {
                          type: 'success',
                          text: `Scanned ${assets.plugins.length} plugins, ${assets.configs.length} configs`,
                        })
                      } catch (err) {
                        console.error('Failed to scan assets', err)
                        setProjectMessage(project.id, {
                          type: 'error',
                          text: err instanceof Error ? err.message : 'Asset scan failed',
                        })
                      } finally {
                        setProjectBusy(project.id, false)
                      }
                    }}
                  >
                    Scan Assets
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy[project.id]}
                    onClick={async () => {
                      try {
                        setProjectBusy(project.id, true)
                        const run = await runProjectLocally(project.id)
                        setProjectMessage(project.id, {
                        ...projectMessageForRun(run),
                        })
                      } catch (err) {
                        console.error('Failed to queue local run', err)
                        setProjectMessage(project.id, {
                          type: 'error',
                          text: err instanceof Error ? err.message : 'Run locally failed',
                        })
                      } finally {
                        setProjectBusy(project.id, false)
                      }
                    }}
                  >
                    Run Locally
                  </button>
                </div>
                {(() => {
                  const message = messages[project.id]
                  if (!message) return null
                  return (
                    <p className={message.type === 'error' ? 'error-text' : 'success-text'}>
                      {message.text}
                    </p>
                  )
                })()}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default Projects

