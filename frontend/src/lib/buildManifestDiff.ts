/** Subset of persisted manifest JSON used to diff two builds. */

export interface ManifestForDiff {
  plugins?: Array<{ id: string; version?: string; sha256?: string }>
  configs?: Array<{ path: string; sha256?: string }>
  minecraft?: { loader?: string; version?: string }
  artifact?: { sha256?: string; size?: number }
  repository?: { commit?: string; url?: string; fullName?: string }
}

export interface BuildManifestDiff {
  configs: {
    added: string[]
    removed: string[]
    changed: Array<{ path: string; oldSha: string; newSha: string }>
  }
  plugins: {
    added: Array<{ id: string; version?: string }>
    removed: Array<{ id: string; version?: string }>
    changed: Array<{
      id: string
      oldVersion?: string
      newVersion?: string
      oldSha?: string
      newSha?: string
    }>
  }
  minecraftChanged: boolean
  artifactChanged: boolean
  oldCommit?: string
  newCommit?: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return null
  }
  return v as Record<string, unknown>
}

export function parseManifestForDiff(raw: unknown): ManifestForDiff {
  const m = asRecord(raw)
  if (!m) {
    return {}
  }

  const pluginsRaw = m.plugins
  const plugins = Array.isArray(pluginsRaw)
    ? pluginsRaw
        .map((p) => asRecord(p))
        .filter(Boolean)
        .map((p) => ({
          id: String(p!.id ?? ''),
          version: p!.version != null ? String(p!.version) : undefined,
          sha256: p!.sha256 != null ? String(p!.sha256) : undefined,
        }))
        .filter((p) => p.id.length > 0)
    : undefined

  const configsRaw = m.configs
  const configs = Array.isArray(configsRaw)
    ? configsRaw
        .map((c) => asRecord(c))
        .filter(Boolean)
        .map((c) => ({
          path: String(c!.path ?? ''),
          sha256: c!.sha256 != null ? String(c!.sha256) : undefined,
        }))
        .filter((c) => c.path.length > 0)
    : undefined

  const minecraft = asRecord(m.minecraft)
  const artifact = asRecord(m.artifact)
  const repository = asRecord(m.repository)

  return {
    plugins,
    configs,
    minecraft: minecraft
      ? {
          loader: minecraft.loader != null ? String(minecraft.loader) : undefined,
          version: minecraft.version != null ? String(minecraft.version) : undefined,
        }
      : undefined,
    artifact: artifact
      ? {
          sha256: artifact.sha256 != null ? String(artifact.sha256) : undefined,
          size: typeof artifact.size === 'number' ? artifact.size : undefined,
        }
      : undefined,
    repository: repository
      ? {
          commit: repository.commit != null ? String(repository.commit) : undefined,
          url: repository.url != null ? String(repository.url) : undefined,
          fullName: repository.fullName != null ? String(repository.fullName) : undefined,
        }
      : undefined,
  }
}

function minecraftEqual(a: ManifestForDiff['minecraft'], b: ManifestForDiff['minecraft']): boolean {
  return (a?.loader ?? '') === (b?.loader ?? '') && (a?.version ?? '') === (b?.version ?? '')
}

function artifactEqual(a: ManifestForDiff['artifact'], b: ManifestForDiff['artifact']): boolean {
  return (a?.sha256 ?? '') === (b?.sha256 ?? '') && (a?.size ?? -1) === (b?.size ?? -1)
}

export function diffBuildManifests(older: ManifestForDiff, newer: ManifestForDiff): BuildManifestDiff {
  const oldConfigs = new Map((older.configs ?? []).map((c) => [c.path, c.sha256 ?? '']))
  const newConfigs = new Map((newer.configs ?? []).map((c) => [c.path, c.sha256 ?? '']))

  const configs = {
    added: [] as string[],
    removed: [] as string[],
    changed: [] as Array<{ path: string; oldSha: string; newSha: string }>,
  }

  for (const [path, newSha] of newConfigs) {
    if (!oldConfigs.has(path)) {
      configs.added.push(path)
    } else {
      const oldSha = oldConfigs.get(path) ?? ''
      if (oldSha !== newSha) {
        configs.changed.push({ path, oldSha, newSha })
      }
    }
  }
  for (const path of oldConfigs.keys()) {
    if (!newConfigs.has(path)) {
      configs.removed.push(path)
    }
  }
  configs.added.sort()
  configs.removed.sort()
  configs.changed.sort((a, b) => a.path.localeCompare(b.path))

  const oldPlugins = new Map((older.plugins ?? []).map((p) => [p.id, p]))
  const newPlugins = new Map((newer.plugins ?? []).map((p) => [p.id, p]))

  const plugins = {
    added: [] as Array<{ id: string; version?: string }>,
    removed: [] as Array<{ id: string; version?: string }>,
    changed: [] as BuildManifestDiff['plugins']['changed'],
  }

  for (const [id, np] of newPlugins) {
    const op = oldPlugins.get(id)
    if (!op) {
      plugins.added.push({ id, version: np.version })
    } else {
      const sameVersion = (op.version ?? '') === (np.version ?? '')
      const sameSha = (op.sha256 ?? '') === (np.sha256 ?? '')
      if (!sameVersion || !sameSha) {
        plugins.changed.push({
          id,
          oldVersion: op.version,
          newVersion: np.version,
          oldSha: op.sha256,
          newSha: np.sha256,
        })
      }
    }
  }
  for (const [id, op] of oldPlugins) {
    if (!newPlugins.has(id)) {
      plugins.removed.push({ id, version: op.version })
    }
  }
  plugins.added.sort((a, b) => a.id.localeCompare(b.id))
  plugins.removed.sort((a, b) => a.id.localeCompare(b.id))
  plugins.changed.sort((a, b) => a.id.localeCompare(b.id))

  const oldCommit = older.repository?.commit?.trim()
  const newCommit = newer.repository?.commit?.trim()
  const validOld = oldCommit && !oldCommit.startsWith('<') && oldCommit.length > 6
  const validNew = newCommit && !newCommit.startsWith('<') && newCommit.length > 6

  return {
    configs,
    plugins,
    minecraftChanged: !minecraftEqual(older.minecraft, newer.minecraft),
    artifactChanged: !artifactEqual(older.artifact, newer.artifact),
    oldCommit: validOld ? oldCommit : undefined,
    newCommit: validNew ? newCommit : undefined,
  }
}

export function countDiffEntries(d: BuildManifestDiff): number {
  return (
    d.configs.added.length +
    d.configs.removed.length +
    d.configs.changed.length +
    d.plugins.added.length +
    d.plugins.removed.length +
    d.plugins.changed.length +
    (d.minecraftChanged ? 1 : 0) +
    (d.artifactChanged ? 1 : 0)
  )
}
