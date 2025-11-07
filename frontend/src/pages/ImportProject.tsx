import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { importProjectRepo } from '../lib/api'

function ImportProject() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const navigate = useNavigate()

  return (
    <section className="panel">
      <header>
        <h2>Import Existing Repo</h2>
        <p className="muted">Link an existing Git repository that already follows the manager structure.</p>
      </header>

      <form
        className="page-form"
        aria-label="Import project"
        ref={formRef}
        onSubmit={async (event) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)

          const payload = {
            repoUrl: String(data.get('repoUrl') ?? ''),
            defaultBranch: String(data.get('defaultBranch') ?? ''),
            profilePath: String(data.get('profilePath') ?? ''),
          }

          if (!payload.repoUrl || !payload.defaultBranch || !payload.profilePath) {
            setStatus('error')
            setError('Repository URL, default branch, and profile path are required')
            return
          }

          try {
            setStatus('saving')
            setError(null)
            await importProjectRepo(payload)
            setStatus('success')
            form.reset()
          } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Failed to import project')
          }
        }}
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
            {status === 'saving' ? 'Connecting…' : 'Connect Repo'}
          </button>
        </div>
        {status === 'success' && <p className="success-text">Repository linked successfully.</p>}
        {status === 'error' && error && <p className="error-text">{error}</p>}
      </form>
    </section>
  )
}

export default ImportProject

