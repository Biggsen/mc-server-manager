import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  fetchDeploymentTargets,
  createDeploymentTarget,
  type DeploymentTarget,
  type DeploymentType,
} from '../lib/api'

type FormState = {
  name: string
  type: DeploymentType
  notes: string
  path: string
  host: string
  port: string
  username: string
  remotePath: string
}

const INITIAL_FORM: FormState = {
  name: '',
  type: 'folder',
  notes: '',
  path: '',
  host: '',
  port: '22',
  username: '',
  remotePath: '',
}

function Deployments() {
  const [targets, setTargets] = useState<DeploymentTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const items = await fetchDeploymentTargets()
        if (cancelled) return
        setTargets(items)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const folderTargets = useMemo(
    () => targets.filter((target) => target.type === 'folder'),
    [targets],
  )
  const sftpTargets = useMemo(
    () => targets.filter((target) => target.type === 'sftp'),
    [targets],
  )

  const resetForm = () => {
    setForm(INITIAL_FORM)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)

    try {
      setSaving(true)
      if (!form.name.trim()) {
        setMessage('Name is required.')
        return
      }
      if (form.type === 'folder' && !form.path.trim()) {
        setMessage('Folder path is required.')
        return
      }
      if (form.type === 'sftp' && (!form.host.trim() || !form.username.trim() || !form.remotePath.trim())) {
        setMessage('SFTP host, username, and remote path are required.')
        return
      }

      const target = await createDeploymentTarget({
        name: form.name.trim(),
        type: form.type,
        notes: form.notes ? form.notes.trim() : undefined,
        folder:
          form.type === 'folder'
            ? {
                path: form.path.trim(),
              }
            : undefined,
        sftp:
          form.type === 'sftp'
            ? {
                host: form.host.trim(),
                port: Number(form.port) || 22,
                username: form.username.trim(),
                remotePath: form.remotePath.trim(),
              }
            : undefined,
      })

      setTargets((prev) => [target, ...prev.filter((item) => item.id !== target.id)])
      setMessage('Deployment target saved.')
      resetForm()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save deployment target.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel">
      <header>
        <h2>Deployment Targets</h2>
        <p className="muted">
          Configure destinations for build artifacts. Publish support is stubbed for now.
        </p>
      </header>

      {loading && <p className="muted">Loading deployment targets…</p>}
      {error && <p className="error-text">{error}</p>}

      <form className="page-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="deployment-name">Name</label>
            <input
              id="deployment-name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Production server"
            />
          </div>

          <div className="field">
            <label htmlFor="deployment-type">Type</label>
            <select
              id="deployment-type"
              value={form.type}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, type: event.target.value as DeploymentType }))
              }
            >
              <option value="folder">Local folder</option>
              <option value="sftp">SFTP server</option>
            </select>
          </div>

          <div className="field span-2">
            <label htmlFor="deployment-notes">Notes</label>
            <textarea
              id="deployment-notes"
              rows={2}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Optional description or credentials hint"
            />
          </div>

          {form.type === 'folder' && (
            <div className="field span-2">
              <label htmlFor="deployment-path">Folder path</label>
              <input
                id="deployment-path"
                value={form.path}
                onChange={(event) => setForm((prev) => ({ ...prev, path: event.target.value }))}
                placeholder="D:/minecraft/releases"
              />
            </div>
          )}

          {form.type === 'sftp' && (
            <>
              <div className="field">
                <label htmlFor="deployment-host">Host</label>
                <input
                  id="deployment-host"
                  value={form.host}
                  onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
                  placeholder="sftp.example.com"
                />
              </div>
              <div className="field">
                <label htmlFor="deployment-port">Port</label>
                <input
                  id="deployment-port"
                  value={form.port}
                  onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
                  placeholder="22"
                />
              </div>
              <div className="field">
                <label htmlFor="deployment-username">Username</label>
                <input
                  id="deployment-username"
                  value={form.username}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, username: event.target.value }))
                  }
                  placeholder="deploy"
                />
              </div>
              <div className="field">
                <label htmlFor="deployment-remote">Remote path</label>
                <input
                  id="deployment-remote"
                  value={form.remotePath}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, remotePath: event.target.value }))
                  }
                  placeholder="/srv/minecraft/releases"
                />
              </div>
            </>
          )}
        </div>
        <div className="form-actions">
          <button
            type="submit"
            className="primary"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Target'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={resetForm}
            disabled={saving}
          >
            Reset
          </button>
        </div>
        {message && <p className="muted">{message}</p>}
      </form>

      <article className="panel">
        <header>
          <h3>Configured Targets</h3>
        </header>
        {targets.length === 0 && <p className="muted">No deployment targets configured yet.</p>}
        {targets.length > 0 && (
          <div className="layout-grid">
            <section className="panel">
              <header>
                <h4>Local Folders</h4>
              </header>
              {folderTargets.length === 0 && <p className="muted">None configured.</p>}
              {folderTargets.length > 0 && (
                <ul className="project-list">
                  {folderTargets.map((target) => (
                    <li key={target.id}>
                      <strong>{target.name}</strong>
                      <p className="muted">{target.path}</p>
                      {target.notes && <p className="muted">{target.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="panel">
              <header>
                <h4>SFTP Servers</h4>
              </header>
              {sftpTargets.length === 0 && <p className="muted">None configured.</p>}
              {sftpTargets.length > 0 && (
                <ul className="project-list">
                  {sftpTargets.map((target) => (
                    <li key={target.id}>
                      <strong>{target.name}</strong>
                      <p className="muted">
                        {target.username}@{target.host}:{target.port ?? 22}
                      </p>
                      <p className="muted">{target.remotePath}</p>
                      {target.notes && <p className="muted">{target.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </article>
    </section>
  )
}

export default Deployments


