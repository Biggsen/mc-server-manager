function ImportProject() {
  return (
    <section className="panel">
      <header>
        <h2>Import Existing Repo</h2>
        <p className="muted">Link an existing Git repository that already follows the manager structure.</p>
      </header>

      <form
        className="page-form"
        aria-label="Import project"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="repo-url">Repository URL</label>
            <input
              id="repo-url"
              name="repoUrl"
              type="url"
              placeholder="https://github.com/username/server-project"
            />
          </div>

          <div className="field">
            <label htmlFor="default-branch">Default branch</label>
            <input id="default-branch" name="defaultBranch" placeholder="main" defaultValue="main" />
          </div>

          <div className="field">
            <label htmlFor="profile-path">Profile path</label>
            <input
              id="profile-path"
              name="profilePath"
              placeholder="profiles/base.yml"
              defaultValue="profiles/base.yml"
            />
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="ghost">
            Cancel
          </button>
          <button type="submit" className="primary">
            Connect Repo
          </button>
        </div>
      </form>
    </section>
  )
}

export default ImportProject

