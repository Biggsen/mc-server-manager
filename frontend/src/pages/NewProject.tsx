function NewProject() {
  return (
    <section className="panel">
      <header>
        <h2>Create Paper Project</h2>
        <p className="muted">Define the core details for your new server build.</p>
      </header>

      <form
        className="page-form"
        aria-label="New project"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="project-name">Project name</label>
            <input id="project-name" name="projectName" placeholder="e.g. skyblock-hub" />
          </div>

          <div className="field">
            <label htmlFor="minecraft-version">Minecraft version</label>
            <select id="minecraft-version" name="minecraftVersion" defaultValue="1.21.1">
              <option value="1.21.1">1.21.1</option>
              <option value="1.21">1.21</option>
              <option value="1.20.6">1.20.6</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="loader">Server loader</label>
            <select id="loader" name="loader" defaultValue="paper">
              <option value="paper">Paper</option>
              <option value="purpur" disabled>
                Purpur (planned)
              </option>
            </select>
          </div>

          <div className="field span-2">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Optional notes about this project"
            />
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="ghost">
            Cancel
          </button>
          <button type="submit" className="primary">
            Continue
          </button>
        </div>
      </form>
    </section>
  )
}

export default NewProject

