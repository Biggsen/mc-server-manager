import './App.css'

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-badge">MC</span>
          <div>
            <h1>Server Manager</h1>
            <p className="muted">Define. Build. Deploy.</p>
          </div>
        </div>
        <nav className="header-actions">
          <button type="button" className="primary">New Project</button>
          <button type="button" className="ghost">Import Repo</button>
        </nav>
      </header>

      <main className="app-content">
        <section className="panel">
          <header>
            <h2>Recent Projects</h2>
            <button type="button" className="link">View all</button>
          </header>
          <p className="empty-state">No projects yet. Create your first Paper server to get started.</p>
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
      </main>
    </div>
  )
}

export default App
