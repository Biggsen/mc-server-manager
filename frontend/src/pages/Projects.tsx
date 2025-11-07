import { useEffect, useState } from 'react'
import { fetchProjects, triggerBuild, type ProjectSummary, type BuildJob } from '../lib/api'
import { subscribeProjectsUpdated } from '../lib/events'

function Projects() {
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
          {projects.map((project) => (
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
                      console.error('Failed to queue build', err)
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
  )
}

export default Projects

