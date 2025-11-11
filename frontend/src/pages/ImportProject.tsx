import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createGitHubRepo,
  fetchGitHubRepos,
  importProjectRepo,
  type GitHubRepo,
} from '../lib/api'
import { ContentSection } from '../components/layout'

function ImportProject() {
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
  const [newRepoPrivate, setNewRepoPrivate] = useState<boolean>(false)
  const [repoUrl, setRepoUrl] = useState<string>('')
  const [defaultBranch, setDefaultBranch] = useState<string>('main')
  const [profilePath, setProfilePath] = useState<string>('profiles/base.yml')
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
        const firstRepo = data.repos[0]
        setSelectedRepoId(firstRepo ? firstRepo.id : '')
        if (firstRepo) {
          setRepoUrl(firstRepo.htmlUrl)
          setDefaultBranch(firstRepo.defaultBranch ?? 'main')
        }
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
      setRepoUrl(repo.htmlUrl)
      setDefaultBranch(repo.defaultBranch ?? 'main')
      setNewRepoName('')
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : 'Failed to create repository.')
    } finally {
      setCreatingRepo(false)
    }
  }

  return (
    <ContentSection as="section">
      <header>
        <h2>Import Existing Repo</h2>
        <p className="muted">
          Link an existing Git repository that already follows the manager structure.
        </p>
      </header>

      <form
        className="page-form"
        aria-label="Import project"
        ref={formRef}
        onSubmit={async (event) => {
          event.preventDefault()

          if (!repoUrl.trim() || !defaultBranch.trim() || !profilePath.trim()) {
            setStatus('error')
            setError('Repository URL, default branch, and profile path are required.')
            return
          }

          try {
            setStatus('saving')
            setError(null)
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
            await importProjectRepo({
              repoUrl: repoUrl.trim(),
              defaultBranch: defaultBranch.trim(),
              profilePath: profilePath.trim(),
              name: selectedRepo ? selectedRepo.name : undefined,
              ...(repoMetadata ? { repo: repoMetadata } : {}),
            })
            setStatus('success')
            formRef.current?.reset()
            setRepoUrl('')
            setDefaultBranch('main')
            setProfilePath('profiles/base.yml')
            setSelectedRepoId('')
          } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Failed to import project.')
          }
        }}
      >
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="repo-select">GitHub repository</label>
            <select
              id="repo-select"
              value={selectedRepoId === '' ? '' : String(selectedRepoId)}
              onChange={(event) => {
                const value = event.target.value
                const repo = value ? sortedRepos.find((item) => item.id === Number(value)) : undefined
                setSelectedRepoId(value ? Number(value) : '')
                if (repo) {
                  setRepoUrl(repo.htmlUrl)
                  setDefaultBranch(repo.defaultBranch ?? 'main')
                }
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
              <p className="muted">No repositories found. Create one below or enter details manually.</p>
            )}
          </div>

          <div className="field span-2">
            <label htmlFor="repo-url">Repository URL</label>
            <input
              id="repo-url"
              name="repoUrl"
              type="url"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/username/server-project"
            />
          </div>

          <div className="field">
            <label htmlFor="default-branch">Default branch</label>
            <input
              id="default-branch"
              name="defaultBranch"
              value={defaultBranch}
              onChange={(event) => setDefaultBranch(event.target.value)}
              placeholder="main"
            />
          </div>

          <div className="field">
            <label htmlFor="profile-path">Profile path</label>
            <input
              id="profile-path"
              name="profilePath"
              value={profilePath}
              onChange={(event) => setProfilePath(event.target.value)}
              placeholder="profiles/base.yml"
            />
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
              placeholder="existing-server-template"
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
              setRepoError(null)
              navigate('/projects')
            }}
          >
            Cancel
          </button>
          <button type="submit" className="primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'Connecting…' : 'Connect Repo'}
          </button>
        </div>
        {status === 'success' && <p className="success-text">Repository linked successfully.</p>}
        {status === 'error' && error && <p className="error-text">{error}</p>}
      </form>
    </ContentSection>
  )
}

export default ImportProject

