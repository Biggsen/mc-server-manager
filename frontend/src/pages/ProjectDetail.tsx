import { useEffect, useMemo, useState } from 'react'
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
  type ProjectSummary,
  type BuildJob,
  type RunJob,
} from '../lib/api'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

interface ManifestPreview {
  buildId: string
  content: unknown
}

function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [builds, setBuilds] = useState<BuildJob[]>([])
  const [runs, setRuns] = useState<RunJob[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [manifestPreview, setManifestPreview] = useState<ManifestPreview | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
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
        if (!cancelled) {
          setLoading(false)
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
    </section>
  )
}

export default ProjectDetail


