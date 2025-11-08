import { emitProjectsUpdated } from './events'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

interface ApiOptions extends RequestInit {
  parseJson?: boolean
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { parseJson = true, headers, ...rest } = options
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (!parseJson) {
    return undefined as unknown as T
  }

  return (await response.json()) as T
}

export interface RepoMetadata {
  id?: number
  owner: string
  name: string
  fullName: string
  htmlUrl: string
  defaultBranch: string
}

export interface ProjectPayload {
  name: string
  description?: string
  minecraftVersion: string
  loader: string
  profilePath?: string
  repo?: RepoMetadata
}

export interface ImportPayload {
  repoUrl?: string
  defaultBranch?: string
  profilePath: string
  name?: string
  repo?: RepoMetadata
}

export interface ProjectSummary {
  id: string
  name: string
  description?: string
  minecraftVersion: string
  loader: string
  updatedAt: string
  source?: 'created' | 'imported'
  manifest?: {
    lastBuildId: string
    manifestPath: string
    generatedAt: string
    commitSha?: string
  }
  plugins?: Array<{
    id: string
    version: string
    sha256?: string
  }>
  configs?: Array<{
    path: string
    sha256?: string
  }>
  repo?: RepoMetadata
}

export type BuildStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface BuildJob {
  id: string
  projectId: string
  status: BuildStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  manifestBuildId?: string
  manifestPath?: string
  error?: string
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const data = await request<{ projects: ProjectSummary[] }>('/projects')
  return data.projects
}

export async function createProject(payload: ProjectPayload): Promise<ProjectSummary> {
  const data = await request<{ project: ProjectSummary }>('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  emitProjectsUpdated()
  return data.project
}

export async function importProjectRepo(payload: ImportPayload): Promise<ProjectSummary> {
  const data = await request<{ project: ProjectSummary }>('/projects/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  emitProjectsUpdated()
  return data.project
}

export interface ManifestOverrides {
  minecraft?: {
    loader?: string
    version?: string
  }
  world?: {
    mode?: string
    seed?: string
    name?: string
  }
  plugins?: Array<{ id: string; version: string; sha256: string }>
  configs?: Array<{ path: string; sha256: string }>
  artifact?: {
    zipPath?: string
    sha256?: string
    size?: number
  }
}

export async function triggerManifest(
  projectId: string,
  overrides?: ManifestOverrides,
): Promise<{
  manifest: ProjectSummary['manifest']
  content: unknown
}> {
  const data = await request<{ manifest: ProjectSummary['manifest']; content: unknown }>(
    `/projects/${projectId}/manifest`,
    {
      method: 'POST',
      body: overrides ? JSON.stringify(overrides) : undefined,
    },
  )
  emitProjectsUpdated()
  return data
}

export async function triggerBuild(projectId: string, overrides?: ManifestOverrides) {
  const data = await request<{ build: BuildJob }>(`/projects/${projectId}/build`, {
    method: 'POST',
    body: overrides ? JSON.stringify(overrides) : undefined,
  })
  emitProjectsUpdated()
  return data.build
}

export async function fetchBuilds(projectId?: string): Promise<BuildJob[]> {
  const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const data = await request<{ builds: BuildJob[] }>(`/builds${params}`)
  return data.builds
}

export async function fetchBuild(buildId: string): Promise<BuildJob> {
  const data = await request<{ build: BuildJob }>(`/builds/${buildId}`)
  return data.build
}

export async function updateProjectAssets(projectId: string, payload: {
  plugins?: ProjectSummary['plugins']
  configs?: ProjectSummary['configs']
}): Promise<void> {
  await request(`/projects/${projectId}/assets`, {
    method: 'POST',
    body: JSON.stringify(payload),
    parseJson: false,
  })
  emitProjectsUpdated()
}

export async function scanProjectAssets(projectId: string): Promise<{
  plugins: NonNullable<ProjectSummary['plugins']>
  configs: NonNullable<ProjectSummary['configs']>
}> {
  const data = await request<{ project: { plugins: NonNullable<ProjectSummary['plugins']>; configs: NonNullable<ProjectSummary['configs']> } }>(
    `/projects/${projectId}/scan`,
    {
      method: 'POST',
    },
  )
  emitProjectsUpdated()
  return data.project
}

export async function runProjectLocally(
  projectId: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(`/projects/${projectId}/run`, {
    method: 'POST',
  })
}

export interface GitHubRepo {
  id: number
  name: string
  fullName: string
  private: boolean
  htmlUrl: string
  defaultBranch: string
}

export interface GitHubOwnerInfo {
  owner: {
    login: string
    avatarUrl: string
    htmlUrl: string
  }
  orgs: Array<{
    login: string
    avatarUrl: string
    htmlUrl: string
  }>
  repos: GitHubRepo[]
}

export async function fetchGitHubRepos(): Promise<GitHubOwnerInfo> {
  return request<GitHubOwnerInfo>('/github/repos')
}

export async function createGitHubRepo(
  org: string,
  payload: { name: string; description?: string; private?: boolean },
): Promise<GitHubRepo> {
  const data = await request<{
    id: number
    name: string
    fullName: string
    htmlUrl: string
    defaultBranch: string
  }>(`/github/orgs/${org}/repos`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return {
    id: data.id,
    name: data.name,
    fullName: data.fullName,
    private: payload.private ?? false,
    htmlUrl: data.htmlUrl,
    defaultBranch: data.defaultBranch,
  }
}

export interface AuthStatus {
  provider: string
  configured: boolean
  authenticated: boolean
  login: string | null
  authorizeUrl: string | null
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>('/auth/status')
}

export function startGitHubLogin(returnTo?: string): void {
  const url = new URL(`${API_BASE}/auth/github`, window.location.origin)
  if (returnTo) {
    url.searchParams.set('returnTo', returnTo)
  }
  window.location.href = url.toString()
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST', parseJson: false })
}

