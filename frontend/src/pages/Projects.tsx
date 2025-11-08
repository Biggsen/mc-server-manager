import { useEffect, useState } from 'react'
import {
  fetchProjects,
  triggerBuild,
  triggerManifest,
  scanProjectAssets,
  fetchBuilds,
  runProjectLocally,
  type ProjectSummary,
  type BuildJob,
} from '../lib/api'
import { subscribeProjectsUpdated } from '../lib/events'

type ProjectMessage = { type: 'success' | 'error'; text: string }

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

  return (
    <section className="panel">
      <header>
        <h2>All Projects</h2>
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
                  <h4>{project.name}</h4>
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
                        const response = await runProjectLocally(project.id)
                        setProjectMessage(project.id, {
                          type: 'success',
                          text: `Local run queued (${response.status})`,
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

