import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createGitHubRepo,
  fetchGitHubRepos,
  importProjectRepo,
  type GitHubRepo,
} from '../lib/api'
import {
  Button,
  Checkbox,
  Group,
  Loader,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
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
    <ContentSection as="section" padding="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Title order={2}>Import Existing Repo</Title>
          <Text size="sm" c="dimmed">
            Link an existing Git repository that already follows the manager structure.
          </Text>
        </Stack>

        <form
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
          <Stack gap="md">
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">
                GitHub repository
              </Text>
              <NativeSelect
                id="repo-select"
                value={selectedRepoId === '' ? '' : String(selectedRepoId)}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  const repo = value ? sortedRepos.find((item) => item.id === Number(value)) : undefined
                  setSelectedRepoId(value ? Number(value) : '')
                  if (repo) {
                    setRepoUrl(repo.htmlUrl)
                    setDefaultBranch(repo.defaultBranch ?? 'main')
                  }
                  setRepoError(null)
                }}
                data={[
                  {
                    value: '',
                    label: repoLoading ? 'Loading repositories…' : 'Select a repository',
                  },
                  ...sortedRepos.map((repo) => ({ value: String(repo.id), label: repo.fullName })),
                ]}
                disabled={repoLoading || sortedRepos.length === 0}
              />
              {!repoLoading && sortedRepos.length === 0 && (
                <Text size="sm" c="dimmed">
                  No repositories found. Create one below or enter details manually.
                </Text>
              )}
            </Stack>

            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">
                Repository URL
              </Text>
              <TextInput
                id="repo-url"
                name="repoUrl"
                type="url"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.currentTarget.value)}
                placeholder="https://github.com/username/server-project"
              />
            </Stack>

            <Group grow>
              <Stack gap={4}>
                <Text size="xs" fw={600} c="dimmed">
                  Default branch
                </Text>
                <TextInput
                  id="default-branch"
                  name="defaultBranch"
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.currentTarget.value)}
                  placeholder="main"
                />
              </Stack>
              <Stack gap={4}>
                <Text size="xs" fw={600} c="dimmed">
                  Profile path
                </Text>
                <TextInput
                  id="profile-path"
                  name="profilePath"
                  value={profilePath}
                  onChange={(event) => setProfilePath(event.currentTarget.value)}
                  placeholder="profiles/base.yml"
                />
              </Stack>
            </Group>

            <Group grow align="flex-start">
              <Stack gap={4}>
                <Text size="xs" fw={600} c="dimmed">
                  Repository owner
                </Text>
                <NativeSelect
                  id="owner-select"
                  value={selectedOwner}
                  onChange={(event) => setSelectedOwner(event.currentTarget.value)}
                  disabled={repoLoading || owners.length === 0}
                  data={owners.map((owner) => ({ value: owner.key, label: owner.label }))}
                />
              </Stack>
              <Checkbox
                label="Private repo"
                checked={newRepoPrivate}
                onChange={(event) => setNewRepoPrivate(event.currentTarget.checked)}
              />
            </Group>

            <Stack gap={8}>
              <Text size="xs" fw={600} c="dimmed">
                Create new repository
              </Text>
              <Group align="flex-end" gap="sm">
                <TextInput
                  id="new-repo-name"
                  value={newRepoName}
                  placeholder="existing-server-template"
                  onChange={(event) => setNewRepoName(event.currentTarget.value)}
                  disabled={repoLoading}
                />
                <Button type="button" variant="ghost" onClick={handleCreateRepo} disabled={repoLoading || creatingRepo}>
                  {creatingRepo ? 'Creating…' : 'Create & Select'}
                </Button>
              </Group>
            </Stack>

            {repoLoading && (
              <Group gap="xs">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  Fetching repositories from GitHub…
                </Text>
              </Group>
            )}

            {repoError && (
              <Text size="sm" c="red.4">
                {repoError}
              </Text>
            )}

            <Group justify="space-between" mt="md">
              <Button
                variant="ghost"
                onClick={() => {
                  formRef.current?.reset()
                  setStatus('idle')
                  setError(null)
                  setRepoError(null)
                  navigate('/projects')
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={status === 'saving'}>
                {status === 'saving' ? 'Connecting…' : 'Connect repo'}
              </Button>
            </Group>

            {status === 'success' && (
              <Text size="sm" c="green.6">
                Repository linked successfully.
              </Text>
            )}
            {status === 'error' && error && (
              <Text size="sm" c="red.5">
                {error}
              </Text>
            )}
          </Stack>
        </form>
      </Stack>
    </ContentSection>
  )
}

export default ImportProject

