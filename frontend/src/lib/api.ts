// Type definition for Electron API exposed via preload script
declare global {
  interface Window {
    electronAPI?: {
      isElectron?: boolean;
      startGitHubAuth?: (returnTo?: string) => Promise<void>;
      onAuthComplete?: (callback: () => void) => void;
      onAuthError?: (callback: (error: { error: string }) => void) => void;
    };
  }
}

import { logger } from './logger';

export interface PluginSearchResult {
  provider: 'hangar' | 'modrinth' | 'spiget'
  id: string
  slug: string
  name: string
  summary?: string
  projectUrl?: string
}

export type PluginConfigRequirement = 'required' | 'optional' | 'generated'

export interface PluginConfigDefinition {
  id: string
  path: string
  label?: string
  requirement?: PluginConfigRequirement
  description?: string
  tags?: string[]
}

export interface ProjectPluginConfigMapping {
  definitionId: string
  label?: string
  path?: string
  requirement?: PluginConfigRequirement
  notes?: string
}

export interface StoredPluginRecord {
  id: string
  version: string
  provider?: 'hangar' | 'modrinth' | 'spiget' | 'github' | 'custom'
  sha256?: string
  minecraftVersionMin?: string
  minecraftVersionMax?: string
  cachePath?: string
  artifactFileName?: string
  cachedAt?: string
  lastUsedAt?: string
  source?: {
    provider: 'hangar' | 'modrinth' | 'spiget' | 'github' | 'custom'
    slug: string
    projectUrl?: string
    versionId?: string
    downloadUrl?: string
    loader?: string
    minecraftVersion?: string
    minecraftVersionMin?: string
    minecraftVersionMax?: string
    uploadPath?: string
    sha256?: string
    cachePath?: string
  }
  createdAt: string
  updatedAt: string
  configDefinitions?: PluginConfigDefinition[]
}

export async function searchPlugins(
  query: string,
  loader: string,
  minecraftVersion: string,
): Promise<PluginSearchResult[]> {
  const params = new URLSearchParams({
    query,
    loader,
    minecraftVersion,
    fallback: '1',
  })
  const data = await request<{ results: PluginSearchResult[] }>(`/plugins/search?${params.toString()}`)
  return data.results
}

export interface PluginVersionInfo {
  versionId: string
  name: string
  downloadUrl?: string
  releasedAt?: string
  supports: Array<{ loader: string; minecraftVersions: string[] }>
}

export async function fetchPluginVersions(
  provider: 'hangar' | 'modrinth' | 'spiget',
  slug: string,
  loader: string,
  minecraftVersion: string,
): Promise<PluginVersionInfo[]> {
  const params = new URLSearchParams({
    loader,
    minecraftVersion,
  })
  const data = await request<{ provider: string; versions: PluginVersionInfo[] }>(
    `/plugins/${provider}/${encodeURIComponent(slug)}/versions?${params.toString()}`,
  )
  return data.versions
}

import { emitProjectsUpdated } from './events'

// In Electron production (file:// protocol), use localhost
// In development or web mode, use relative path or env variable
export function getApiBase(): string {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  // Check if we're in Electron (via preload script or file:// protocol)
  if (typeof window !== 'undefined') {
    const isElectron = (window as any).electronAPI?.isElectron || window.location.protocol === 'file:';
    if (isElectron) {
      console.log('[API] Detected Electron mode, using http://localhost:4000/api');
      return 'http://localhost:4000/api';
    }
  }
  console.log('[API] Using relative API path /api');
  return '/api';
}

const API_BASE = getApiBase()

interface ApiOptions extends RequestInit {
  parseJson?: boolean
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { parseJson = true, headers, ...rest } = options
  const url = `${API_BASE}${path}`
  
  logger.debug('api-request', {
    method: rest.method || 'GET',
    path,
    url,
    hasCredentials: true,
  });
  
  try {
    const response = await fetch(url, {
      ...rest,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
    })

    logger.debug('api-response', {
      method: rest.method || 'GET',
      path,
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      const message = await response.text()
      logger.error('api-error', {
        method: rest.method || 'GET',
        path,
        status: response.status,
        message: message.substring(0, 200), // Limit message length
      }, message || `Request failed with status ${response.status}`);
      throw new Error(message || `Request failed with status ${response.status}`)
    }

    if (!parseJson) {
      return undefined as unknown as T
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      logger.error('api-error', {
        method: rest.method || 'GET',
        path,
        reason: 'Failed to fetch',
        url,
      }, `Failed to fetch from ${url}. Is the backend running on ${API_BASE}?`);
      throw new Error(`Failed to connect to backend at ${API_BASE}. Make sure the backend server is running.`)
    }
    throw error
  }
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
    provider?: 'hangar' | 'modrinth' | 'spiget' | 'github' | 'custom'
    minecraftVersionMin?: string
    minecraftVersionMax?: string
    cachePath?: string
    source?: {
      provider: 'hangar' | 'modrinth' | 'spiget' | 'github' | 'custom'
      slug: string
      projectUrl?: string
      versionId?: string
      downloadUrl?: string
      loader?: string
      minecraftVersion?: string
      minecraftVersionMin?: string
      minecraftVersionMax?: string
      uploadPath?: string
      sha256?: string
      cachePath?: string
    }
    configMappings?: ProjectPluginConfigMapping[]
  }>
  configs?: Array<{
    path: string
    sha256?: string
    pluginId?: string
    definitionId?: string
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
  artifactPath?: string
  artifactSha?: string
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

export async function fetchBuildManifest(buildId: string): Promise<unknown> {
  const data = await request<{ manifest: unknown }>(`/builds/${buildId}/manifest`)
  return data.manifest
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

export async function fetchProjectProfile(
  projectId: string,
): Promise<{ path: string; yaml: string } | null> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/profile`, {
    credentials: 'include',
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  const data = (await response.json()) as {
    profile: { path: string; yaml: string }
  }

  return data.profile
}

export async function saveProjectProfile(
  projectId: string,
  payload: { yaml: string },
): Promise<{
  path: string
  plugins: NonNullable<ProjectSummary['plugins']>
  configs: NonNullable<ProjectSummary['configs']>
}> {
  const data = await request<{
    profile: { path: string }
    project: {
      plugins: NonNullable<ProjectSummary['plugins']>
      configs: NonNullable<ProjectSummary['configs']>
    }
  }>(`/projects/${projectId}/profile`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  emitProjectsUpdated()
  return {
    path: data.profile.path,
    plugins: data.project.plugins,
    configs: data.project.configs,
  }
}

export type RunStatus =
  | 'pending'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'succeeded'
  | 'failed'

export interface RunLogEntry {
  timestamp: string
  stream: 'stdout' | 'stderr' | 'system'
  message: string
}

export interface RunJob {
  id: string
  projectId: string
  buildId: string
  artifactPath: string
  status: RunStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
  logs: RunLogEntry[]
  containerName?: string
  port?: number
  workspacePath?: string
  consoleAvailable?: boolean
  workspaceStatus?: RunWorkspaceStatus
}

export interface RunWorkspaceStatus {
  lastBuildId?: string
  lastSyncedAt?: string
  dirtyPaths: string[]
}

export async function runProjectLocally(projectId: string): Promise<RunJob> {
  const data = await request<{ run: RunJob }>(`/projects/${projectId}/run`, {
    method: 'POST',
  })
  return data.run
}

export async function fetchProjectRuns(projectId: string): Promise<RunJob[]> {
  const data = await request<{ runs: RunJob[] }>(`/projects/${projectId}/runs`)
  return data.runs
}

export async function fetchRuns(status?: RunStatus): Promise<RunJob[]> {
  const params = new URLSearchParams()
  if (status) {
    params.set('status', status)
  }
  const query = params.toString()
  const path = query ? `/runs?${query}` : '/runs'
  const data = await request<{ runs: RunJob[] }>(path)
  return data.runs
}

export async function stopRunJob(runId: string): Promise<RunJob> {
  const data = await request<{ run: RunJob }>(`/runs/${runId}/stop`, {
    method: 'POST',
  })
  return data.run
}

export async function sendRunCommand(runId: string, command: string): Promise<void> {
  await request<{ ok: boolean }>(`/runs/${runId}/command`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  })
}

export async function resetProjectWorkspace(
  projectId: string,
): Promise<{ workspacePath: string }> {
  const data = await request<{ workspace: { workspacePath: string } }>(
    `/projects/${projectId}/run/reset-workspace`,
    {
      method: 'POST',
    },
  )
  return data.workspace
}

export async function fetchProject(projectId: string): Promise<ProjectSummary> {
  const data = await request<{ project: ProjectSummary }>(`/projects/${projectId}`)
  return data.project
}

export async function updateProject(
  projectId: string,
  payload: {
    name?: string
    minecraftVersion?: string
    loader?: string
    description?: string
  },
): Promise<ProjectSummary> {
  const data = await request<{ project: ProjectSummary }>(`/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  emitProjectsUpdated()
  return data.project
}

export interface ProjectConfigSummary {
  path: string
  size: number
  modifiedAt: string
  sha256?: string
  pluginId?: string
  definitionId?: string
}

export interface PluginConfigDefinitionView {
  id: string
  source: 'library' | 'custom'
  label?: string
  description?: string
  tags?: string[]
  defaultPath: string
  resolvedPath: string
  requirement: PluginConfigRequirement
  notes?: string
  mapping?: ProjectPluginConfigMapping
  uploaded?: ProjectConfigSummary
  missing: boolean
}

export interface ProjectPluginConfigsResponse {
  plugin: { id: string; version: string }
  libraryDefinitions: PluginConfigDefinition[]
  mappings: ProjectPluginConfigMapping[]
  definitions: PluginConfigDefinitionView[]
  uploads: ProjectConfigSummary[]
}

export async function fetchProjectConfigs(projectId: string): Promise<ProjectConfigSummary[]> {
  const data = await request<{ configs: ProjectConfigSummary[] }>(`/projects/${projectId}/configs`)
  return data.configs
}

export async function uploadProjectConfig(
  projectId: string,
  payload: { path: string; file: File; pluginId?: string; definitionId?: string },
): Promise<ProjectConfigSummary[]> {
  const form = new FormData()
  form.append('relativePath', payload.path)
  form.append('file', payload.file)
  if (payload.pluginId) {
    form.append('pluginId', payload.pluginId)
  }
  if (payload.definitionId) {
    form.append('definitionId', payload.definitionId)
  }
  const response = await fetch(`${API_BASE}/projects/${projectId}/configs/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Upload failed with status ${response.status}`)
  }
  const data = (await response.json()) as { configs: ProjectConfigSummary[] }
  emitProjectsUpdated()
  return data.configs
}

export async function fetchProjectConfigFile(
  projectId: string,
  path: string,
): Promise<{ path: string; content: string; sha256: string }> {
  const params = new URLSearchParams({ path })
  const data = await request<{ file: { path: string; content: string; sha256: string } }>(
    `/projects/${projectId}/configs/file?${params.toString()}`,
  )
  return data.file
}

export async function updateProjectConfigFile(
  projectId: string,
  payload: { path: string; content: string; pluginId?: string; definitionId?: string },
): Promise<void> {
  await request(`/projects/${projectId}/configs/file`, {
    method: 'PUT',
    body: JSON.stringify({
      path: payload.path,
      content: payload.content,
      pluginId: payload.pluginId,
      definitionId: payload.definitionId,
    }),
  })
  emitProjectsUpdated()
}

export async function fetchProjectPluginConfigs(
  projectId: string,
  pluginId: string,
): Promise<ProjectPluginConfigsResponse> {
  return request<ProjectPluginConfigsResponse>(
    `/projects/${projectId}/plugins/${encodeURIComponent(pluginId)}/configs`,
  )
}

export async function updateProjectPluginConfigs(
  projectId: string,
  pluginId: string,
  payload: { mappings: ProjectPluginConfigMapping[] },
): Promise<ProjectPluginConfigsResponse> {
  const data = await request<ProjectPluginConfigsResponse>(
    `/projects/${projectId}/plugins/${encodeURIComponent(pluginId)}/configs`,
    {
      method: 'PUT',
      body: JSON.stringify({ mappings: payload.mappings }),
    },
  )
  emitProjectsUpdated()
  return data
}

export async function deleteProjectConfigFile(
  projectId: string,
  path: string,
): Promise<ProjectConfigSummary[]> {
  const params = new URLSearchParams({ path })
  const data = await request<{ configs: ProjectConfigSummary[] }>(
    `/projects/${projectId}/configs/file?${params.toString()}`,
    {
      method: 'DELETE',
    },
  )
  emitProjectsUpdated()
  return data.configs
}

export async function deleteProject(
  projectId: string,
  options?: { deleteRepo?: boolean },
): Promise<void> {
  await request(`/projects/${projectId}`, {
    method: 'DELETE',
    body: JSON.stringify({ deleteRepo: Boolean(options?.deleteRepo) }),
    parseJson: false,
  })
  emitProjectsUpdated()
}

export async function addProjectPlugin(
  projectId: string,
  payload: {
    pluginId: string
    version: string
    provider?: string
    downloadUrl?: string
    minecraftVersionMin?: string
    minecraftVersionMax?: string
    cachePath?: string
    source?: Record<string, unknown>
  },
): Promise<ProjectSummary['plugins']> {
  const data = await request<{ project: { plugins: ProjectSummary['plugins'] } }>(
    `/projects/${projectId}/plugins`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
  emitProjectsUpdated()
  return data.project.plugins
}

export async function uploadProjectPlugin(
  projectId: string,
  payload: {
    pluginId: string
    version: string
    file: File
    minecraftVersionMin?: string
    minecraftVersionMax?: string
  },
): Promise<ProjectSummary['plugins']> {
  const formData = new FormData()
  formData.append('pluginId', payload.pluginId)
  formData.append('version', payload.version)
  formData.append('file', payload.file)
  if (payload.minecraftVersionMin) {
    formData.append('minecraftVersionMin', payload.minecraftVersionMin)
  }
  if (payload.minecraftVersionMax) {
    formData.append('minecraftVersionMax', payload.minecraftVersionMax)
  }

  const response = await fetch(
    `${API_BASE}/projects/${projectId}/plugins/upload`,
    {
      method: 'POST',
      body: formData,
      credentials: 'include',
    },
  )

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Upload failed with status ${response.status}`)
  }

  const data = (await response.json()) as {
    project: { plugins: ProjectSummary['plugins'] }
  }
  emitProjectsUpdated()
  return data.project.plugins
}

export async function fetchPluginLibrary(): Promise<StoredPluginRecord[]> {
  const data = await request<{ plugins: StoredPluginRecord[] }>('/plugins/library')
  return data.plugins
}

export async function addLibraryPlugin(payload: {
  pluginId: string
  version: string
  provider?: string
  downloadUrl?: string
  minecraftVersionMin?: string
  minecraftVersionMax?: string
  cachePath?: string
  source?: Record<string, unknown>
  hash?: string
}): Promise<StoredPluginRecord> {
  const data = await request<{ plugin: StoredPluginRecord; plugins: StoredPluginRecord[] }>(
    '/plugins/library',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
  return data.plugin
}

export async function uploadLibraryPlugin(payload: {
  pluginId: string
  version: string
  file: File
  minecraftVersionMin: string
  minecraftVersionMax: string
}): Promise<StoredPluginRecord> {
  const formData = new FormData()
  formData.append('pluginId', payload.pluginId)
  formData.append('version', payload.version)
  formData.append('file', payload.file)
  formData.append('minecraftVersionMin', payload.minecraftVersionMin)
  formData.append('minecraftVersionMax', payload.minecraftVersionMax)

  const response = await fetch(`${API_BASE}/plugins/library/upload`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Upload failed with status ${response.status}`)
  }

  const data = (await response.json()) as {
    plugin: StoredPluginRecord
    plugins: StoredPluginRecord[]
  }
  return data.plugin
}

export async function updateLibraryPluginConfigs(
  pluginId: string,
  version: string,
  payload: { configDefinitions: PluginConfigDefinition[] },
): Promise<StoredPluginRecord> {
  const data = await request<{ plugin: StoredPluginRecord }>(
    `/plugins/library/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/configs`,
    {
      method: 'PUT',
      body: JSON.stringify({ configDefinitions: payload.configDefinitions }),
    },
  )
  return data.plugin
}

export async function deleteLibraryPlugin(
  id: string,
  version: string,
): Promise<StoredPluginRecord[]> {
  const data = await request<{ plugins: StoredPluginRecord[] }>(
    `/plugins/library/${encodeURIComponent(id)}/${encodeURIComponent(version)}`,
    {
      method: 'DELETE',
    },
  )
  return data.plugins
}

export async function deleteProjectPlugin(
  projectId: string,
  pluginId: string,
): Promise<ProjectSummary['plugins']> {
  const data = await request<{ project: { plugins: ProjectSummary['plugins'] } }>(
    `/projects/${projectId}/plugins/${encodeURIComponent(pluginId)}`,
    {
      method: 'DELETE',
    },
  )
  emitProjectsUpdated()
  return data.project.plugins
}

export type DeploymentType = 'folder' | 'sftp'

export interface DeploymentTarget {
  id: string
  name: string
  type: DeploymentType
  notes?: string
  createdAt: string
  updatedAt: string
  path?: string
  host?: string
  port?: number
  username?: string
  remotePath?: string
}

export async function fetchDeploymentTargets(): Promise<DeploymentTarget[]> {
  const data = await request<{ targets: DeploymentTarget[] }>('/deployments')
  return data.targets
}

export async function createDeploymentTarget(payload: {
  name: string
  type: DeploymentType
  notes?: string
  folder?: { path: string }
  sftp?: { host: string; port?: number; username: string; remotePath: string }
}): Promise<DeploymentTarget> {
  const data = await request<{ target: DeploymentTarget }>('/deployments', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.target
}

export async function publishDeployment(
  targetId: string,
  buildId: string,
): Promise<{ deployment: { status: string } }> {
  return request<{ deployment: { status: string } }>(`/deployments/${targetId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ buildId }),
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
  logger.debug('auth-status-request', {});
  const status = await request<AuthStatus>('/auth/status');
  logger.info('auth-status-received', {
    configured: status.configured,
    authenticated: status.authenticated,
    login: status.login,
  });
  return status;
}

export function startGitHubLogin(returnTo?: string): void {
  const isElectron = window.electronAPI?.isElectron || window.location.protocol === 'file:';
  
  logger.info('oauth-initiation', {
    isElectron,
    returnTo,
    protocol: window.location.protocol,
    origin: window.location.origin,
    method: isElectron ? 'IPC' : 'navigation',
  });
  
  // In Electron, use IPC (required - window.location.origin is file:// in production)
  if (isElectron) {
    if (window.electronAPI?.startGitHubAuth) {
      logger.debug('oauth-initiation-ipc', {
        returnTo,
      });
      window.electronAPI.startGitHubAuth(returnTo).catch((error: Error) => {
        logger.error('oauth-initiation-failed', {
          reason: 'IPC call failed',
        }, error.message);
      });
      return;
    } else {
      logger.error('oauth-initiation-failed', {
        reason: 'IPC method not available',
      }, 'startGitHubAuth not found on electronAPI');
    }
  }
  
  // Fallback to window navigation (web mode or Electron without IPC)
  logger.debug('oauth-initiation-navigation', {
    returnTo,
  });
  const url = new URL(`${API_BASE}/auth/github`, window.location.origin)
  if (returnTo) {
    url.searchParams.set('returnTo', returnTo)
  }
  window.location.href = url.toString()
}

export async function logout(): Promise<void> {
  logger.info('logout-start', {});
  await request('/auth/logout', { method: 'POST', parseJson: false });
  logger.info('logout-complete', {});
}

