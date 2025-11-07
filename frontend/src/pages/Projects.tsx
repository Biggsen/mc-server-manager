import { useEffect, useState } from 'react'
import { fetchProjects, type ProjectSummary } from '../lib/api'
import { subscribeProjectsUpdated } from '../lib/events'

function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
                </p>
              </div>
              <time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default Projects

