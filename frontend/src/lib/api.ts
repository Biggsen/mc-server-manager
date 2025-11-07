import { emitProjectsUpdated } from './events'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

interface ApiOptions extends RequestInit {
  parseJson?: boolean
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { parseJson = true, headers, ...rest } = options
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
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

export interface ProjectPayload {
  name: string
  description?: string
  minecraftVersion: string
  loader: string
}

export interface ImportPayload {
  repoUrl: string
  defaultBranch: string
  profilePath: string
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
  }
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

