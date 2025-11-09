import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchProjects,
  triggerBuild,
  fetchPluginLibrary,
  type ProjectSummary,
  type BuildJob,
  type StoredPluginRecord,
} from '../lib/api'

const sourceLabel: Record<'download' | 'upload', string> = {
  download: 'Download URL',
  upload: 'Uploaded jar',
}

function getPluginSourceKind(plugin: StoredPluginRecord): 'download' | 'upload' {
  return plugin.source?.uploadPath ? 'upload' : 'download'
}
import { subscribeProjectsUpdated } from '../lib/events'

function Dashboard() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState<Record<string, BuildJob['status']>>({})
  const [library, setLibrary] = useState<StoredPluginRecord[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState<string | null>(null)

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

  const recent = projects.slice(0, 3)

  return (
    <>
      <section className="panel">
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
                  <h4>{project.name}</h4>
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
      </section>

      <section className="panel">
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
      </section>

      <section className="layout-grid">
        <article className="panel">
          <header>
            <h3>Next Steps</h3>
          </header>
          <ol>
            <li>Connect your GitHub account</li>
            <li>Create a project definition</li>
            <li>Build and run locally</li>
          </ol>
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

