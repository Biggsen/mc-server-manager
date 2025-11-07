import { Link } from 'react-router-dom'

function Dashboard() {
  return (
    <>
      <section className="panel">
        <header>
          <h2>Recent Projects</h2>
          <Link to="/projects" className="link">
            View all
          </Link>
        </header>
        <p className="empty-state">
          No projects yet. Create your first Paper server to get started.
        </p>
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

