import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  fetchProject,
  fetchBuilds,
  fetchBuildManifest,
  fetchProjectRuns,
  triggerBuild,
  triggerManifest,
  scanProjectAssets,
  runProjectLocally,
  searchPlugins,
  fetchPluginVersions,
  addProjectPlugin,
  type ProjectSummary,
  type BuildJob,
  type RunJob,
  type PluginSearchResult,
  type PluginVersionInfo,
} from '../lib/api'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
const providerLabel: Record<PluginSearchResult['provider'], string> = {
  hangar: 'Hangar',
  modrinth: 'Modrinth',
  spiget: 'Spigot',
}

interface ManifestPreview {
  buildId: string
  content: unknown
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
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [manifestPreview, setManifestPreview] = useState<ManifestPreview | null>(null)
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginResults, setPluginResults] = useState<PluginSearchResult[]>([])
  const [pluginVersions, setPluginVersions] = useState<PluginVersionInfo[]>([])
  const [pluginSelection, setPluginSelection] = useState<PluginSearchResult | null>(null)
  const [pluginStatus, setPluginStatus] = useState<string | null>(null)
  const [loadingPlugins, setLoadingPlugins] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    const load = async () => {
      try {
        if (initialLoadRef.current) {
          setLoading(true)
        }
        const [proj, projBuilds, projRuns] = await Promise.all([
          fetchProject(id),
          fetchBuilds(id),
          fetchProjectRuns(id),
        ])
        if (cancelled) return
        setProject(proj)
        setBuilds(projBuilds)
        setRuns(projRuns)
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

  const latestBuild = useMemo(
    () => builds.find((build) => build.status === 'succeeded'),
    [builds],
  )

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

  return (
    <section className="panel">
      <header>
        <h2>{project.name}</h2>
        <p className="muted">
          {[project.minecraftVersion, project.loader.toUpperCase(), project.source === 'imported' ? 'Imported' : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="dev-buttons">
          <Link className="ghost" to="/projects">
            ← All Projects
          </Link>
        </div>
      </header>

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
              {project.plugins.map((plugin) => (
                <li key={`${plugin.id}:${plugin.version}`}>
                  <div>
                    <strong>{plugin.id}</strong>{' '}
                    {plugin.provider && (
                      <span className="badge">
                        {plugin.provider.charAt(0).toUpperCase() + plugin.provider.slice(1)}
                      </span>
                    )}{' '}
                    <span className="muted">v{plugin.version}</span>
                    {plugin.source?.projectUrl && (
                      <p className="muted">
                        <a href={plugin.source.projectUrl} target="_blank" rel="noreferrer">
                          View project
                        </a>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        )}

        <article className="panel">
          <header>
            <h3>Actions</h3>
          </header>
          <div className="dev-buttons vertical">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                try {
                  setBusy(true)
                  const build = await triggerBuild(project.id)
                  setMessage(`Triggered build ${build.id}`)
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Failed to queue build')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Trigger Build
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={async () => {
                try {
                  setBusy(true)
                  const manifest = await triggerManifest(project.id)
                  setMessage(
                    `Manifest ${manifest.manifest?.lastBuildId ?? 'generated'} queued`,
                  )
                } catch (err) {
                  setMessage(
                    err instanceof Error ? err.message : 'Manifest generation failed',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Generate Manifest
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={async () => {
                try {
                  setBusy(true)
                  const assets = await scanProjectAssets(project.id)
                  setMessage(
                    `Scanned ${assets.plugins.length} plugins, ${assets.configs.length} configs`,
                  )
                } catch (err) {
                  setMessage(
                    err instanceof Error ? err.message : 'Asset scan failed',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Scan Assets
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={async () => {
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
              }}
            >
              Run Locally
            </button>
          </div>
          {message && <p className="success-text">{message}</p>}
        </article>
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

      <article className="panel">
        <header>
          <h3>Local Runs</h3>
        </header>
        {runs.length === 0 && <p className="muted">No local run activity yet.</p>}
        {runs.length > 0 && (
          <ul className="project-list">
            {runs.map((run) => (
              <li key={run.id}>
                <div>
                  <strong>{run.id}</strong>
                  <p className="muted">
                    Status: {run.status.toUpperCase()} ·{' '}
                    {new Date(run.createdAt).toLocaleString()}
                  </p>
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

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
          <h3>Add Plugin</h3>
        </header>
        <form
          className="page-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!pluginQuery.trim()) return
            try {
              setLoadingPlugins(true)
              const results = await searchPlugins(
                pluginQuery,
                project.loader,
                project.minecraftVersion,
              )
              setPluginResults(results)
              setPluginSelection(null)
              setPluginVersions([])
              setPluginStatus(null)
            } catch (err) {
              setPluginStatus(err instanceof Error ? err.message : 'Search failed')
            } finally {
              setLoadingPlugins(false)
            }
          }}
        >
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="plugin-search">Search Hangar</label>
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
            {pluginStatus && <p className="muted">{pluginStatus}</p>}
        </form>

        {pluginResults.length > 0 && (
          <div className="layout-grid">
            <section className="panel">
              <header>
                <h4>Results</h4>
              </header>
              <ul className="project-list">
                {pluginResults.map((result) => (
                  <li key={result.slug}>
                    <div>
                      <strong>{result.name}</strong>{' '}
                      <span className="badge">{providerLabel[result.provider]}</span>
                      {result.summary && <p className="muted">{result.summary}</p>}
                      {result.projectUrl && (
                        <a href={result.projectUrl} target="_blank" rel="noreferrer">
                          View project
                        </a>
                      )}
                    </div>
                    <div className="dev-buttons">
                      <button
                        type="button"
                        className="ghost"
                        onClick={async () => {
                          setPluginSelection(result)
                          try {
                          const versions = await fetchPluginVersions(
                            result.provider,
                            result.slug,
                            project.loader,
                            project.minecraftVersion,
                          )
                            const filtered = versions.filter((version) =>
                              version.supports.some(
                                (support) =>
                                  support.loader.toLowerCase() === project.loader.toLowerCase() &&
                                  support.minecraftVersions.includes(project.minecraftVersion),
                              ),
                            )
                            setPluginVersions(filtered.length > 0 ? filtered : versions)
                  setPluginStatus(
                    filtered.length === 0
                      ? 'No exact version match for this Minecraft version, showing recent releases.'
                      : null,
                  )
                          } catch (err) {
                            setPluginStatus(
                              err instanceof Error ? err.message : 'Failed to load versions.',
                            )
                          }
                        }}
                      >
                        View Versions
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {pluginSelection && (
              <section className="panel">
                <header>
                  <h4>Versions for {pluginSelection.name}</h4>
                </header>
                {pluginVersions.length === 0 && <p className="muted">No versions found.</p>}
                {pluginVersions.length > 0 && (
                  <ul className="project-list">
                    {pluginVersions.slice(0, 10).map((version) => (
                      <li key={version.versionId}>
                        <div>
                          <strong>{version.name}</strong>
                          {version.releasedAt && (
                            <p className="muted">
                              Released {new Date(version.releasedAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="dev-buttons">
                          <button
                            type="button"
                            className="ghost"
                            onClick={async () => {
                              try {
                                setBusy(true)
                                const plugins = await addProjectPlugin(project.id, {
                                  pluginId: pluginSelection.slug,
                                  version: version.name,
                                  provider: pluginSelection.provider,
                                  source: {
                                    slug: pluginSelection.slug,
                                    projectUrl: pluginSelection.projectUrl,
                                    versionId: version.versionId,
                                  },
                                })
                                setProject((prev) =>
                                  prev ? { ...prev, plugins: plugins ?? prev.plugins } : prev,
                                )
                                setMessage(`Added ${pluginSelection.name} ${version.name}`)
                              } catch (err) {
                                setMessage(
                                  err instanceof Error ? err.message : 'Failed to add plugin.',
                                )
                              } finally {
                                setBusy(false)
                              }
                            }}
                          >
                            Add to server
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </article>
    </section>
  )
}

export default ProjectDetail


