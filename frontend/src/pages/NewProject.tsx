import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createProject } from '../lib/api'

function NewProject() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const navigate = useNavigate()

  return (
    <section className="panel">
      <header>
        <h2>Create Paper Project</h2>
        <p className="muted">Define the core details for your new server build.</p>
      </header>

      <form
        className="page-form"
        aria-label="New project"
        ref={formRef}
        onSubmit={async (event) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)

          const payload = {
            name: String(data.get('projectName') ?? ''),
            minecraftVersion: String(data.get('minecraftVersion') ?? '1.21.1'),
            loader: String(data.get('loader') ?? 'paper'),
            description: String(data.get('description') ?? ''),
          }

          if (!payload.name) {
            setError('Project name is required')
            setStatus('error')
            return
          }

          try {
            setStatus('saving')
            setError(null)
            await createProject(payload)
            setStatus('success')
            form.reset()
          } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Failed to create project')
          }
        }}
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
          <button
            type="button"
            className="ghost"
            onClick={() => {
              formRef.current?.reset()
              setStatus('idle')
              setError(null)
              navigate('/projects')
            }}
          >
            Cancel
          </button>
          <button type="submit" className="primary">
            {status === 'saving' ? 'Creating…' : 'Continue'}
          </button>
        </div>
        {status === 'success' && <p className="success-text">Project queued successfully.</p>}
        {status === 'error' && error && <p className="error-text">{error}</p>}
      </form>
    </section>
  )
}

export default NewProject

