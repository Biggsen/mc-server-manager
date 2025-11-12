import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import YAML from 'yaml'
import {
  fetchProject,
  fetchProjectConfigs,
  fetchProjectProfile,
  saveProjectProfile,
  type ProjectConfigSummary,
  type ProjectSummary,
} from '../lib/api'
import { ContentSection } from '../components/layout'

interface PluginFormEntry {
  id: string
  version: string
}

interface ServerPropertiesFields {
  include: boolean
  motd: string
  maxPlayers: string
  enforceSecureProfile: boolean
  viewDistance: string
  onlineMode: boolean
}

interface PaperGlobalFields {
  include: boolean
  targetTickDistance: string
}

function normalizeProjectPlugins(project: ProjectSummary | null): PluginFormEntry[] {
  if (!project?.plugins || project.plugins.length === 0) {
    return []
  }
  return project.plugins.map((plugin) => ({
    id: plugin.id,
    version: plugin.version,
  }))
}

function defaultServerProperties(project: ProjectSummary | null): ServerPropertiesFields {
  return {
    include: true,
    motd: project?.name ? `Welcome to ${project.name}` : 'New MC Server',
    maxPlayers: '20',
    enforceSecureProfile: false,
    viewDistance: '10',
    onlineMode: true,
  }
}

function defaultPaperConfig(): PaperGlobalFields {
  return {
    include: true,
    targetTickDistance: '6',
  }
}

interface ProfileDocument {
  name?: string
  minecraft?: {
    loader?: string
    version?: string
  }
  world?: {
    mode?: string
    seed?: string
    name?: string
  }
  plugins?: Array<{ id: string; version?: string }>
  configs?: {
    files?: Array<{
      template?: string
      output?: string
      data?: unknown
    }>
  }
  overrides?: Array<{ path: string; value: unknown }>
  mergePolicy?: {
    arrays?: 'replace' | 'merge'
  }
}

interface ExtractedServerProperties {
  fields: ServerPropertiesFields
  seed?: string
}

function coerceString(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return fallback
}

function coerceNumberString(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }
  return fallback
}

function extractServerPropertiesFromProfile(
  profile: ProfileDocument | null,
  project: ProjectSummary | null,
): ExtractedServerProperties {
  const defaults = defaultServerProperties(project)
  const result: ServerPropertiesFields = { ...defaults }

  const entry = profile?.configs?.files?.find(
    (file) =>
      file?.output === 'server.properties' || file?.template === 'server.properties.hbs',
  )

  if (!entry) {
    result.include = false
    return { fields: result }
  }

  result.include = true
  const data = (entry.data ?? {}) as Record<string, unknown>
  result.motd = coerceString(data.motd, defaults.motd)
  result.maxPlayers = coerceNumberString(data.maxPlayers, defaults.maxPlayers)
  result.enforceSecureProfile = coerceBoolean(
    data.enforceSecureProfile ?? data['enforce-secure-profile'],
    defaults.enforceSecureProfile,
  )
  result.viewDistance = coerceNumberString(
    data.viewDistance ?? data['view-distance'],
    defaults.viewDistance,
  )
  result.onlineMode = coerceBoolean(
    data.onlineMode ?? data['online-mode'],
    defaults.onlineMode,
  )
  const seedFromConfig = coerceString(
    data.levelSeed ?? data.seed ?? data['level-seed'] ?? data['world-seed'],
    '',
  )

  return {
    fields: result,
    seed: seedFromConfig?.trim() ? seedFromConfig : undefined,
  }
}

function extractPaperGlobalFromProfile(profile: ProfileDocument | null): PaperGlobalFields {
  const defaults = defaultPaperConfig()
  const result: PaperGlobalFields = { ...defaults }

  const entry = profile?.configs?.files?.find(
    (file) =>
      file?.output === 'config/paper-global.yml' ||
      file?.template === 'paper-global.yml.hbs',
  )

  if (!entry) {
    result.include = false
    return result
  }

  result.include = true
  const data = (entry.data ?? {}) as Record<string, unknown>
  const chunkSystem = (data?.chunkSystem ?? {}) as Record<string, unknown>
  result.targetTickDistance = coerceNumberString(
    chunkSystem.targetTickDistance ?? chunkSystem['target-tick-distance'],
    defaults.targetTickDistance,
  )

  return result
}

function normalizePluginsFromProfile(profile: ProfileDocument | null): PluginFormEntry[] {
  if (!profile?.plugins?.length) {
    return []
  }
  return profile.plugins
    .map((plugin) => ({
      id: plugin.id?.trim() ?? '',
      version: plugin.version?.trim() ?? '',
    }))
    .filter((entry) => entry.id.length > 0)
}

function buildProfileDocument(options: {
  project: ProjectSummary
  worldMode: string
  worldName: string
  worldSeed: string
  plugins: PluginFormEntry[]
  serverProperties: ServerPropertiesFields
  paperGlobal: PaperGlobalFields
  additionalConfigs: ProjectConfigSummary[]
}): ProfileDocument {
  const pluginEntries = options.plugins
    .filter((entry) => entry.id.trim() && entry.version.trim())
    .map((entry) => ({
      id: entry.id.trim(),
      version: entry.version.trim(),
    }))

  const configEntries: ProfileDocument['configs']['files'] = []

  if (options.serverProperties.include) {
    configEntries.push({
      template: 'server.properties.hbs',
      output: 'server.properties',
      data: {
        motd: options.serverProperties.motd,
        maxPlayers: Number.parseInt(options.serverProperties.maxPlayers, 10) || 10,
        enforceSecureProfile: options.serverProperties.enforceSecureProfile,
        viewDistance: Number.parseInt(options.serverProperties.viewDistance, 10) || 10,
        onlineMode: options.serverProperties.onlineMode,
        levelSeed: options.worldSeed.trim() ? options.worldSeed.trim() : undefined,
      },
    })
  }

  if (options.paperGlobal.include) {
    const distance = Number.parseInt(options.paperGlobal.targetTickDistance, 10)
    configEntries.push({
      template: 'paper-global.yml.hbs',
      output: 'config/paper-global.yml',
      data: {
        chunkSystem: {
          targetTickDistance: Number.isFinite(distance) ? distance : 6,
        },
      },
    })
  }

  const knownOutputs = new Set(configEntries.map((entry) => entry.output))
  for (const config of options.additionalConfigs) {
    if (!knownOutputs.has(config.path)) {
      configEntries.push({
        template: '',
        output: config.path,
      })
    }
  }

  return {
    name: options.project.name,
    minecraft: {
      loader: options.project.loader,
      version: options.project.minecraftVersion,
    },
    world: {
      mode: options.worldMode || 'generated',
      seed: options.worldSeed || undefined,
      name: options.worldName || 'world',
    },
    plugins: pluginEntries,
    configs: {
      files: configEntries,
    },
    overrides: options.paperGlobal.include
      ? [
          {
            path: 'paper-global.yml:chunk-system.target-tick-distance',
            value: Number.parseInt(options.paperGlobal.targetTickDistance, 10) || 6,
          },
        ]
      : undefined,
    mergePolicy: {
      arrays: 'replace',
    },
  }
}

function GenerateProfile() {
  const { id } = useParams<{ id: string }>()

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [configs, setConfigs] = useState<ProjectConfigSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [worldMode, setWorldMode] = useState('generated')
  const [worldName, setWorldName] = useState('world')
  const [worldSeed, setWorldSeed] = useState('')
  const [plugins, setPlugins] = useState<PluginFormEntry[]>([])
  const [serverProperties, setServerProperties] = useState<ServerPropertiesFields>(
    defaultServerProperties(null),
  )
  const [paperGlobal, setPaperGlobal] = useState<PaperGlobalFields>(defaultPaperConfig())
  const [profileSource, setProfileSource] = useState<'new' | 'existing'>('new')
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setError('Project identifier missing')
      setLoading(false)
      return
    }

    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        const [projectData, configData, profileData] = await Promise.all([
          fetchProject(id!),
          fetchProjectConfigs(id!).catch(() => []),
          fetchProjectProfile(id!),
        ])
        if (cancelled) {
          return
        }
        setProject(projectData)
        setConfigs(configData)
        setSaveMessage(null)
        setSaveError(null)
        setError(null)

        let parsedProfile: ProfileDocument | null = null
        if (profileData?.yaml) {
          try {
            parsedProfile = YAML.parse(profileData.yaml) as ProfileDocument
          } catch (parseError) {
            console.error('Failed to parse project profile YAML', parseError)
            setError('Failed to parse existing profile YAML. Please fix the file and retry.')
            return
          }
        }

        if (parsedProfile) {
          setProfileSource('existing')
          const pluginEntries = normalizePluginsFromProfile(parsedProfile)
          setPlugins(pluginEntries.length > 0 ? pluginEntries : [])

          const { fields: extractedServerProps, seed: configSeed } =
            extractServerPropertiesFromProfile(parsedProfile, projectData)
          setServerProperties(extractedServerProps)

          const extractedPaperGlobal = extractPaperGlobalFromProfile(parsedProfile)
          setPaperGlobal(extractedPaperGlobal)

          const normalizedWorldMode = parsedProfile.world?.mode?.trim() || 'generated'
          const normalizedWorldName = parsedProfile.world?.name?.trim() || 'world'
          const worldSeedValue =
            parsedProfile.world?.seed?.trim() || configSeed || ''

          setWorldMode(normalizedWorldMode)
          setWorldName(normalizedWorldName)
          setWorldSeed(worldSeedValue)
        } else {
          setProfileSource('new')
          setPlugins(normalizeProjectPlugins(projectData))
          setServerProperties(defaultServerProperties(projectData))
          setWorldName('world')
          setWorldMode('generated')
          setWorldSeed('')
          setPaperGlobal(defaultPaperConfig())
        }

      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load project')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!project || profileSource !== 'new') return
    setServerProperties((prev) => ({
      ...prev,
      motd: `Welcome to ${project.name}`,
    }))
  }, [project, profileSource])

  const profileDocument = useMemo(() => {
    if (!project) {
      return null
    }

    return buildProfileDocument({
      project,
      worldMode,
      worldName,
      worldSeed,
      plugins,
      serverProperties,
      paperGlobal,
      additionalConfigs: configs,
    })
  }, [project, worldMode, worldName, worldSeed, plugins, serverProperties, paperGlobal, configs])

  const yamlPreview = useMemo(() => {
    if (!profileDocument) {
      return ''
    }
    return YAML.stringify(profileDocument, { defaultStringType: 'QUOTE_DOUBLE' })
  }, [profileDocument])

  if (!id) {
    return (
      <ContentSection as="section">
        <p className="error-text">Project identifier missing.</p>
        <Link className="ghost" to="/projects">
          Back to Projects
        </Link>
      </ContentSection>
    )
  }

  if (loading) {
    return (
      <ContentSection as="section">
        <p className="muted">Loading project details…</p>
      </ContentSection>
    )
  }

  if (error) {
    return (
      <ContentSection as="section">
        <p className="error-text">{error}</p>
        <Link className="ghost" to={`/projects/${id}`}>
          Back to project
        </Link>
      </ContentSection>
    )
  }

  if (!project || !profileDocument) {
    return (
      <ContentSection as="section">
        <p className="error-text">Project not found.</p>
        <Link className="ghost" to="/projects">
          Back to Projects
        </Link>
      </ContentSection>
    )
  }

  return (
    <ContentSection as="section">
      <header>
        <h2>Generate profile for {project.name}</h2>
        <p className="muted">
          Prefill a `profiles/base.yml` using the data you&apos;ve already entered for this project.
        </p>
        <div className="dev-buttons">
          <Link className="ghost" to={`/projects/${project.id}`}>
            ← Back to Project
          </Link>
        </div>
      </header>

      <form
        className="page-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
        }}
      >
        <div className="layout-grid">
          <ContentSection as="section">
            <header>
              <h3>Project Basics</h3>
            </header>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="profile-name">Server name</label>
                <input
                  id="profile-name"
                  value={project.name}
                  readOnly
                />
                <p className="muted">Uses the project display name.</p>
              </div>
              <div className="field">
                <label htmlFor="minecraft-loader">Loader</label>
                <input
                  id="minecraft-loader"
                  value={project.loader}
                  readOnly
                />
              </div>
              <div className="field">
                <label htmlFor="minecraft-version">Minecraft version</label>
                <input
                  id="minecraft-version"
                  value={project.minecraftVersion}
                  readOnly
                />
              </div>
            </div>
          </ContentSection>

          <ContentSection as="section">
            <header>
              <h3>World</h3>
            </header>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="world-mode">World mode</label>
                <input
                  id="world-mode"
                  value={worldMode}
                  onChange={(event) => setWorldMode(event.target.value)}
                  placeholder="generated"
                />
              </div>
              <div className="field">
                <label htmlFor="world-name">World folder</label>
                <input
                  id="world-name"
                  value={worldName}
                  onChange={(event) => setWorldName(event.target.value)}
                  placeholder="world"
                />
              </div>
              <div className="field">
                <label htmlFor="world-seed">Seed (optional)</label>
                <input
                  id="world-seed"
                  value={worldSeed}
                  onChange={(event) => setWorldSeed(event.target.value)}
                  placeholder="Leave blank for random seed"
                />
              </div>
            </div>
          </ContentSection>
        </div>

        <ContentSection as="section">
          <header>
            <h3>Plugins</h3>
          </header>
          <p className="muted">
            These entries are pre-filled from the project&apos;s plugin list. Update the versions if
            needed or remove entries you don&apos;t want in the generated profile.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Plugin ID</th>
                <th>Version</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plugins.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <p className="muted">No plugins associated with this project yet.</p>
                  </td>
                </tr>
              )}
              {plugins.map((plugin, index) => (
                <tr key={`${plugin.id}:${index}`}>
                  <td>
                    <input
                      value={plugin.id}
                      onChange={(event) => {
                        const next = plugins.slice()
                        next[index] = { ...next[index], id: event.target.value }
                        setPlugins(next)
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={plugin.version}
                      onChange={(event) => {
                        const next = plugins.slice()
                        next[index] = { ...next[index], version: event.target.value }
                        setPlugins(next)
                      }}
                    />
                  </td>
                  <td className="dev-buttons">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setPlugins((prev) => prev.filter((_, idx) => idx !== index))
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setPlugins((prev) => [...prev, { id: '', version: '' }])}
            >
              Add plugin entry
            </button>
          </div>
        </ContentSection>

        <div className="layout-grid">
          <ContentSection as="section">
            <header>
              <h3>Server Properties</h3>
            </header>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={serverProperties.include}
                onChange={(event) =>
                  setServerProperties((prev) => ({ ...prev, include: event.target.checked }))
                }
              />
              Include `server.properties`
            </label>
            {serverProperties.include && (
              <div className="form-grid">
                <div className="field span-2">
                  <label htmlFor="motd">MOTD</label>
                  <input
                    id="motd"
                    value={serverProperties.motd}
                    onChange={(event) =>
                      setServerProperties((prev) => ({ ...prev, motd: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="max-players">Max players</label>
                  <input
                    id="max-players"
                    value={serverProperties.maxPlayers}
                    onChange={(event) =>
                      setServerProperties((prev) => ({ ...prev, maxPlayers: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="view-distance">View distance</label>
                  <input
                    id="view-distance"
                    value={serverProperties.viewDistance}
                    onChange={(event) =>
                      setServerProperties((prev) => ({ ...prev, viewDistance: event.target.value }))
                    }
                  />
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={serverProperties.onlineMode}
                    onChange={(event) =>
                      setServerProperties((prev) => ({ ...prev, onlineMode: event.target.checked }))
                    }
                  />
                  Online mode
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={serverProperties.enforceSecureProfile}
                    onChange={(event) =>
                      setServerProperties((prev) => ({
                        ...prev,
                        enforceSecureProfile: event.target.checked,
                      }))
                    }
                  />
                  Enforce secure profile
                </label>
              </div>
            )}
          </ContentSection>

          <ContentSection as="section">
            <header>
              <h3>Paper Global Config</h3>
            </header>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={paperGlobal.include}
                onChange={(event) =>
                  setPaperGlobal((prev) => ({ ...prev, include: event.target.checked }))
                }
              />
              Include `config/paper-global.yml`
            </label>
            {paperGlobal.include && (
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="target-tick-distance">Target Tick Distance</label>
                  <input
                    id="target-tick-distance"
                    value={paperGlobal.targetTickDistance}
                    onChange={(event) =>
                      setPaperGlobal((prev) => ({ ...prev, targetTickDistance: event.target.value }))
                    }
                  />
                </div>
              </div>
            )}
          </ContentSection>
        </div>

        {configs.length > 0 && (
          <ContentSection as="section">
            <header>
              <h3>Detected Config Files</h3>
            </header>
            <p className="muted">
              These files are in the project&apos;s config uploads. They are added to the profile with
              unknown templates so you can wire them manually later.
            </p>
            <ul className="project-list">
              {configs.map((config) => (
                <li key={config.path}>
                  <div>
                    <strong>{config.path}</strong>
                    <p className="muted">
                      Updated {new Date(config.modifiedAt).toLocaleString()} · {config.size} bytes
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </ContentSection>
        )}
      </form>

      <ContentSection as="article">
        <header>
          <h3>Export Preview</h3>
          <div className="dev-buttons">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(yamlPreview)
                  setClipboardStatus('Copied to clipboard.')
                  window.setTimeout(() => setClipboardStatus(null), 2000)
                } catch (err) {
                  setClipboardStatus(
                    err instanceof Error ? err.message : 'Clipboard copy failed.',
                  )
                }
              }}
            >
              Copy YAML
            </button>
            <button
              type="button"
              className="primary"
              disabled={saveBusy}
              onClick={async () => {
                if (!yamlPreview.trim()) {
                  setSaveError('Nothing to save; YAML is empty.')
                  return
                }
                try {
                  setSaveBusy(true)
                  setSaveError(null)
                  const result = await saveProjectProfile(project.id, { yaml: yamlPreview })
                  setProject((prev) =>
                    prev
                      ? {
                          ...prev,
                          plugins: result.plugins ?? prev.plugins,
                          configs: result.configs ?? prev.configs,
                        }
                      : prev,
                  )
                  setProfileSource('existing')
                  setSaveMessage(`Profile saved to ${result.path}`)
                } catch (err) {
                  setSaveError(err instanceof Error ? err.message : 'Failed to save profile.')
                  setSaveMessage(null)
                } finally {
                  setSaveBusy(false)
                }
              }}
            >
              Save profile to project
            </button>
          </div>
        </header>
        {saveMessage && <p className="success-text">{saveMessage}</p>}
        {saveError && <p className="error-text">{saveError}</p>}
        {clipboardStatus && <p className="muted">{clipboardStatus}</p>}
        <textarea
          value={yamlPreview}
          readOnly
          rows={24}
          spellCheck={false}
          style={{ width: '100%', fontFamily: 'monospace' }}
        />
      </ContentSection>
    </ContentSection>
  )
}

export default GenerateProfile

