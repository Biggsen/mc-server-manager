import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createGitHubRepo,
  createProject,
  fetchGitHubRepos,
  type GitHubRepo,
} from '../lib/api'

function NewProject() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [repoLoading, setRepoLoading] = useState<boolean>(true)
  const [creatingRepo, setCreatingRepo] = useState<boolean>(false)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [owners, setOwners] = useState<Array<{ key: string; label: string }>>([])
  const [selectedOwner, setSelectedOwner] = useState<string>('self')
  const [selectedRepoId, setSelectedRepoId] = useState<number | ''>('')
  const [newRepoName, setNewRepoName] = useState<string>('')
  const [newRepoPrivate, setNewRepoPrivate] = useState<boolean>(true)
  const formRef = useRef<HTMLFormElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setRepoLoading(true)
    fetchGitHubRepos()
      .then((data) => {
        if (cancelled) return
        const personalLabel = data.owner?.login
          ? `${data.owner.login} (personal)`
          : 'Personal account'
        const ownerOptions = [
          { key: 'self', label: personalLabel },
          ...data.orgs.map((org) => ({ key: org.login, label: org.login })),
        ]
        setOwners(ownerOptions)
        setRepos(data.repos)
        setSelectedOwner((prev) =>
          prev && ownerOptions.some((option) => option.key === prev) ? prev : ownerOptions[0]?.key ?? 'self',
        )
        setSelectedRepoId((prev) => {
          if (typeof prev === 'number' && data.repos.some((repo) => repo.id === prev)) {
            return prev
          }
          return data.repos[0]?.id ?? ''
        })
        setRepoError(null)
      })
      .catch((err: Error) => {
        if (cancelled) return
        const message = err.message.includes('GitHub authentication required')
          ? 'Sign in with GitHub to link a repository.'
          : err.message
        setRepoError(message)
        setRepos([])
      })
      .finally(() => {
        if (!cancelled) {
          setRepoLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sortedRepos = useMemo(
    () => [...repos].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [repos],
  )

  const selectedRepo =
    typeof selectedRepoId === 'number'
      ? sortedRepos.find((repo) => repo.id === selectedRepoId)
      : undefined

  const handleCreateRepo = async () => {
    if (!selectedOwner) {
      setRepoError('Select a repository owner before creating a repo.')
      return
    }
    if (!newRepoName.trim()) {
      setRepoError('Repository name is required.')
      return
    }

    try {
      setCreatingRepo(true)
      setRepoError(null)
      const repo = await createGitHubRepo(selectedOwner, {
        name: newRepoName.trim(),
        private: newRepoPrivate,
      })
      setRepos((prev) => {
        const filtered = prev.filter((item) => item.id !== repo.id)
        return [repo, ...filtered]
      })
      setSelectedRepoId(repo.id)
      setNewRepoName('')
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : 'Failed to create repository.')
    } finally {
      setCreatingRepo(false)
    }
  }

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

          const profilePath = String(data.get('profilePath') ?? 'profiles/base.yml').trim()

          const payload = {
            name: String(data.get('projectName') ?? ''),
            minecraftVersion: String(data.get('minecraftVersion') ?? '1.21.1'),
            loader: String(data.get('loader') ?? 'paper'),
            description: String(data.get('description') ?? ''),
            profilePath: profilePath || 'profiles/base.yml',
          }

          if (!payload.name) {
            setError('Project name is required.')
            setStatus('error')
            return
          }

          if (!selectedRepo && !repoError) {
            setError('Select or create a GitHub repository for this project.')
            setStatus('error')
            return
          }

          const repoMetadata = selectedRepo
            ? (() => {
                const [owner, repoName] = selectedRepo.fullName.split('/')
                return {
                  id: selectedRepo.id,
                  owner,
                  name: repoName ?? selectedRepo.name,
                  fullName: selectedRepo.fullName,
                  htmlUrl: selectedRepo.htmlUrl,
                  defaultBranch: selectedRepo.defaultBranch ?? 'main',
                }
              })()
            : undefined

          try {
            setStatus('saving')
            setError(null)
            await createProject({
              ...payload,
              ...(repoMetadata ? { repo: repoMetadata } : {}),
            })
            setStatus('success')
            form.reset()
          } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Failed to create project.')
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
              <option value="1.21.8">1.21.8</option>
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

          <div className="field">
            <label htmlFor="profile-path">Profile path</label>
            <input
              id="profile-path"
              name="profilePath"
              defaultValue="profiles/base.yml"
              placeholder="profiles/base.yml"
            />
          </div>

          <div className="field span-2">
            <label htmlFor="repo-select">GitHub repository</label>
            <select
              id="repo-select"
              value={selectedRepoId === '' ? '' : String(selectedRepoId)}
              onChange={(event) => {
                setSelectedRepoId(event.target.value ? Number(event.target.value) : '')
                setRepoError(null)
              }}
              disabled={repoLoading || sortedRepos.length === 0}
            >
              <option value="">{repoLoading ? 'Loading repositories…' : 'Select a repository'}</option>
              {sortedRepos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName}
                </option>
              ))}
            </select>
            {!repoLoading && sortedRepos.length === 0 && (
              <p className="muted">No repositories found. Create one below.</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="owner-select">Repository owner</label>
            <select
              id="owner-select"
              value={selectedOwner}
              onChange={(event) => setSelectedOwner(event.target.value)}
              disabled={repoLoading || owners.length === 0}
            >
              {owners.map((owner) => (
                <option key={owner.key} value={owner.key}>
                  {owner.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={newRepoPrivate}
                onChange={(event) => setNewRepoPrivate(event.target.checked)}
              />
              Private repo
            </label>
          </div>

          <div className="field span-2">
            <label htmlFor="new-repo-name">Create new repository</label>
            <input
              id="new-repo-name"
              value={newRepoName}
              placeholder="my-server-manager"
              onChange={(event) => setNewRepoName(event.target.value)}
              disabled={repoLoading}
            />
            <button
              type="button"
              className="ghost"
              onClick={handleCreateRepo}
              disabled={repoLoading || creatingRepo}
            >
              {creatingRepo ? 'Creating…' : 'Create & Select'}
            </button>
          </div>
        </div>

        {repoError && <p className="error-text">{repoError}</p>}

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
          <button type="submit" className="primary" disabled={status === 'saving'}>
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

