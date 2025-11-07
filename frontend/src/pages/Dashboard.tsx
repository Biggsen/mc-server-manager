import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchProjects, triggerBuild, type ProjectSummary, type BuildJob } from '../lib/api'
import { subscribeProjectsUpdated } from '../lib/events'

function Dashboard() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState<Record<string, BuildJob['status']>>({})

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
                    {project.minecraftVersion} · {project.loader.toUpperCase()}{' '}
                    {project.source === 'imported' ? '· Imported' : ''}
                    {project.manifest ? ` · Built ${new Date(project.manifest.generatedAt).toLocaleTimeString()}` : ''}
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

