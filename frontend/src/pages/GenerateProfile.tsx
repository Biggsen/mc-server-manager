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
import { Alert, Button, Card, Grid, Group, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core'
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
    files?: ProfileConfigFileEntry[]
  }
  overrides?: Array<{ path: string; value: unknown }>
  mergePolicy?: {
    arrays?: 'replace' | 'merge'
  }
}

type ProfileConfigFileEntry = {
  template?: string
  output?: string
  data?: unknown
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

  const configEntries: ProfileConfigFileEntry[] = []

  if (options.serverProperties.include) {
    configEntries.push({
      template: 'server.properties.hbs',
      output: 'server.properties',
      data: {
        motd: typeof options.serverProperties.motd === 'string' ? options.serverProperties.motd : '',
        maxPlayers: Number.parseInt(
          typeof options.serverProperties.maxPlayers === 'string' ? options.serverProperties.maxPlayers : '10',
          10,
        ) || 10,
        enforceSecureProfile: options.serverProperties.enforceSecureProfile,
        viewDistance: Number.parseInt(
          typeof options.serverProperties.viewDistance === 'string' ? options.serverProperties.viewDistance : '10',
          10,
        ) || 10,
        onlineMode: options.serverProperties.onlineMode,
        levelSeed: options.worldSeed.trim() ? options.worldSeed.trim() : undefined,
      },
    })
  }

  if (options.paperGlobal.include) {
    const distance = Number.parseInt(
      typeof options.paperGlobal.targetTickDistance === 'string' ? options.paperGlobal.targetTickDistance : '6',
      10,
    )
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
            value:
              Number.parseInt(
                typeof options.paperGlobal.targetTickDistance === 'string'
                  ? options.paperGlobal.targetTickDistance
                  : '6',
                10,
              ) || 6,
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

  const missingRequiredConfigs = useMemo((): Array<{ pluginId: string; definitionId: string; path: string }> => {
    // Note: Requirement field was removed in config system refactor
    // This feature is disabled until requirement checking is reimplemented
    // if needed (e.g., based on library definitions)
    return []
  }, [project?.plugins, configs])

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

    try {
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
    } catch (error) {
      console.error('Failed to build profile document:', error)
      return null
    }
  }, [project, worldMode, worldName, worldSeed, plugins, serverProperties, paperGlobal, configs])

  const yamlPreview = useMemo(() => {
    if (!profileDocument) {
      return ''
    }
    try {
      return YAML.stringify(profileDocument, { defaultStringType: 'QUOTE_DOUBLE' })
    } catch (error) {
      console.error('Failed to stringify profile document:', error)
      return '# Error: Failed to generate YAML preview'
    }
  }, [profileDocument])

  if (!id) {
    return (
      <ContentSection as="section" padding="xl">
        <Stack gap="sm">
          <Alert color="red" title="Project identifier missing">
            <Text size="sm">We need a project id to generate a profile.</Text>
          </Alert>
          <Button component={Link} to="/projects" variant="subtle">
            Back to projects
          </Button>
        </Stack>
      </ContentSection>
    )
  }

  if (loading) {
    return (
      <ContentSection as="section" padding="xl">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Loading project details…
          </Text>
        </Stack>
      </ContentSection>
    )
  }

  if (error) {
    return (
      <ContentSection as="section" padding="xl">
        <Stack gap="sm">
          <Alert color="red" title="Failed to load project">
            <Text size="sm">{error}</Text>
          </Alert>
          <Button component={Link} to={`/projects/${id}`} variant="subtle">
            Back to project
          </Button>
        </Stack>
      </ContentSection>
    )
  }

  if (!project || !profileDocument) {
    return (
      <ContentSection as="section" padding="xl">
        <Stack gap="sm">
          <Alert color="red" title="Project not found">
            <Text size="sm">We could not locate that project.</Text>
          </Alert>
          <Button component={Link} to="/projects" variant="subtle">
            Back to projects
          </Button>
        </Stack>
      </ContentSection>
    )
  }

  return (
    <ContentSection as="section" padding="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={2}>Generate profile for {project.name}</Title>
            <Text size="sm" c="dimmed">
              Prefill a <Text component="span" ff="monospace">profiles/base.yml</Text> using data already stored on this
              project.
            </Text>
          </Stack>
          <Button component={Link} to={`/projects/${project.id}`} variant="subtle">
            Back to project
          </Button>
        </Group>

        {missingRequiredConfigs.length > 0 && (
          <Alert color="yellow" title="Missing required plugin configs">
            <Stack gap={6}>
              <Text size="sm" c="dimmed">
                Upload these files before generating a profile to keep builds in sync.
              </Text>
              <Stack gap={4}>
                {missingRequiredConfigs.map((item) => (
                  <Text key={`${item.pluginId}:${item.definitionId}`} size="sm">
                    <Text component="span" ff="monospace" fw={600}>
                      {item.path}
                    </Text>{' '}
                    · {item.pluginId} ({item.definitionId})
                  </Text>
                ))}
              </Stack>
            </Stack>
          </Alert>
        )}

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
          }}
        >
          <Stack gap="lg">
            <Card withBorder p="lg" radius="md">
              <Stack gap="md">
                <Title order={3}>Project basics</Title>
                <Group gap="md" align="flex-end" wrap="nowrap">
                  <TextInput
                    label="Server name"
                    value={project.name}
                    readOnly
                    description="Uses the project display name."
                    style={{ flex: '2 1 0', minWidth: 0 }}
                  />
                  <TextInput label="Loader" value={project.loader} readOnly style={{ flex: '1 1 0', minWidth: 0 }} />
                  <TextInput label="Minecraft version" value={project.minecraftVersion} readOnly style={{ flex: '1 1 0', minWidth: 0 }} />
                </Group>
              </Stack>
            </Card>

            <Card withBorder p="lg" radius="md">
              <Stack gap="md">
                <Title order={3}>World</Title>
                <Grid gutter="md">
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <TextInput
                      label="World mode"
                      value={worldMode}
                      onChange={(event) => setWorldMode(event.currentTarget.value)}
                      placeholder="generated"
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <TextInput
                      label="World folder"
                      value={worldName}
                      onChange={(event) => setWorldName(event.currentTarget.value)}
                      placeholder="world"
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <TextInput
                      label="Seed (optional)"
                      value={worldSeed}
                      onChange={(event) => setWorldSeed(event.currentTarget.value)}
                      placeholder="Leave blank for random seed"
                    />
                  </Grid.Col>
                </Grid>
              </Stack>
            </Card>

            <Card withBorder p="lg" radius="md">
              <Stack gap="md">
                <Stack gap={4}>
                  <Title order={3}>Plugins</Title>
                  <Text size="sm" c="dimmed">
                    Pre-filled from the project&apos;s plugin list. Adjust versions or remove entries you
                    don&apos;t want in the generated profile.
                  </Text>
                </Stack>

                <Stack gap="sm">
                  {plugins.length === 0 && (
                    <Text size="sm" c="dimmed">
                      No plugins associated with this project yet.
                    </Text>
                  )}

                  {plugins.map((plugin, index) => (
                    <Card key={`${plugin.id}:${index}`} withBorder p="md" radius="md">
                      <Stack gap="sm">
                        <Grid gutter="md">
                          <Grid.Col span={{ base: 12, sm: 6 }}>
                            <TextInput
                              label="Plugin ID"
                              value={plugin.id}
                              onChange={(event) => {
                                const next = plugins.slice()
                                next[index] = { ...next[index], id: event.currentTarget.value }
                                setPlugins(next)
                              }}
                              placeholder="luckperms"
                            />
                          </Grid.Col>
                          <Grid.Col span={{ base: 12, sm: 6 }}>
                            <TextInput
                              label="Version"
                              value={plugin.version}
                              onChange={(event) => {
                                const next = plugins.slice()
                                next[index] = { ...next[index], version: event.currentTarget.value }
                                setPlugins(next)
                              }}
                              placeholder="5.4.123"
                            />
                          </Grid.Col>
                        </Grid>
                        <Group justify="flex-end">
                          <Button
                            type="button"
                            variant="subtle"
                            color="red"
                            size="xs"
                            onClick={() => {
                              setPlugins((prev) => prev.filter((_, idx) => idx !== index))
                            }}
                          >
                            Remove
                          </Button>
                        </Group>
                      </Stack>
                    </Card>
                  ))}
                </Stack>

                <Button
                  type="button"
                  variant="subtle"
                  onClick={() => setPlugins((prev) => [...prev, { id: '', version: '' }])}
                >
                  Add plugin entry
                </Button>
              </Stack>
            </Card>

            <Grid gutter="lg">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder p="lg" radius="md">
                  <Stack gap="md">
                    <Title order={3}>Server properties</Title>
                    <Switch
                      label="Include server.properties"
                      checked={serverProperties.include}
                      onChange={(event) =>
                        setServerProperties((prev) => ({ ...prev, include: event.currentTarget.checked }))
                      }
                    />
                    {serverProperties.include && (
                      <Grid gutter="md">
                        <Grid.Col span={12}>
                          <TextInput
                            label="MOTD"
                            value={typeof serverProperties.motd === 'string' ? serverProperties.motd : ''}
                            onChange={(event) => {
                              try {
                                const newValue = String(event.currentTarget?.value ?? '')
                                setServerProperties((prev) => ({
                                  ...prev,
                                  motd: newValue,
                                }))
                              } catch (error) {
                                console.error('Error updating MOTD:', error)
                              }
                            }}
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <TextInput
                            label="Max players"
                            value={typeof serverProperties.maxPlayers === 'string' ? serverProperties.maxPlayers : ''}
                            onChange={(event) => {
                              try {
                                const newValue = String(event.currentTarget?.value ?? '')
                                setServerProperties((prev) => ({
                                  ...prev,
                                  maxPlayers: newValue,
                                }))
                              } catch (error) {
                                console.error('Error updating max players:', error)
                              }
                            }}
                            type="number"
                            min={1}
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <TextInput
                            label="View distance"
                            value={typeof serverProperties.viewDistance === 'string' ? serverProperties.viewDistance : ''}
                            onChange={(event) => {
                              try {
                                const newValue = String(event.currentTarget?.value ?? '')
                                setServerProperties((prev) => ({
                                  ...prev,
                                  viewDistance: newValue,
                                }))
                              } catch (error) {
                                console.error('Error updating view distance:', error)
                              }
                            }}
                            type="number"
                            min={2}
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Switch
                            label="Online mode"
                            checked={serverProperties.onlineMode}
                            onChange={(event) =>
                              setServerProperties((prev) => ({
                                ...prev,
                                onlineMode: event.currentTarget.checked,
                              }))
                            }
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Switch
                            label="Enforce secure profile"
                            checked={serverProperties.enforceSecureProfile}
                            onChange={(event) =>
                              setServerProperties((prev) => ({
                                ...prev,
                                enforceSecureProfile: event.currentTarget.checked,
                              }))
                            }
                          />
                        </Grid.Col>
                      </Grid>
                    )}
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Card withBorder p="lg" radius="md">
                  <Stack gap="md">
                    <Title order={3}>Paper global config</Title>
                    <Switch
                      label="Include config/paper-global.yml"
                      checked={paperGlobal.include}
                      onChange={(event) =>
                        setPaperGlobal((prev) => ({ ...prev, include: event.currentTarget.checked }))
                      }
                    />
                    {paperGlobal.include && (
                      <TextInput
                        label="Target tick distance"
                        value={typeof paperGlobal.targetTickDistance === 'string' ? paperGlobal.targetTickDistance : ''}
                        onChange={(event) => {
                          try {
                            const newValue = String(event.currentTarget?.value ?? '')
                            setPaperGlobal((prev) => ({
                              ...prev,
                              targetTickDistance: newValue,
                            }))
                          } catch (error) {
                            console.error('Error updating target tick distance:', error)
                          }
                        }}
                        type="number"
                        min={1}
                      />
                    )}
                  </Stack>
                </Card>
              </Grid.Col>
            </Grid>

            {configs.length > 0 && (
              <Card withBorder p="lg" radius="md">
                <Stack gap="md">
                  <Title order={3}>Detected config files</Title>
                  <Text size="sm" c="dimmed">
                    Files discovered in this project&apos;s config uploads are added to the profile with
                    unknown templates so you can wire them manually later.
                  </Text>
                  <Stack gap="sm">
                    {configs.map((config) => (
                      <Card key={config.path} withBorder p="md" radius="md">
                        <Stack gap={2}>
                          <Text fw={600}>{config.path}</Text>
                          <Text size="xs" c="dimmed">
                            Updated {new Date(config.modifiedAt).toLocaleString()} · {config.size} bytes
                          </Text>
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                </Stack>
              </Card>
            )}
          </Stack>
        </form>

        <Card withBorder p="lg" radius="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Title order={3}>Export preview</Title>
              <Group gap="sm">
                <Button
                  type="button"
                  variant="subtle"
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
                </Button>
                <Button
                  type="button"
                  disabled={saveBusy}
                  onClick={async () => {
                    if (!profileDocument) {
                      setSaveError('Nothing to save; profile is empty.')
                      return
                    }
                    try {
                      setSaveBusy(true)
                      setSaveError(null)
                      
                      // Fetch existing profile to preserve fields this page doesn't manage
                      // (e.g., initCommands, gamerules, overrides, mergePolicy)
                      const existingProfile = await fetchProjectProfile(project.id)
                      const existingParsed = existingProfile
                        ? (YAML.parse(existingProfile.yaml) as Record<string, unknown>)
                        : {}
                      
                      // Merge: existing fields are preserved, generated fields take precedence
                      const merged = {
                        ...existingParsed,
                        ...profileDocument,
                      }
                      
                      const yamlToSave = YAML.stringify(merged, { defaultStringType: 'QUOTE_DOUBLE' })
                      const result = await saveProjectProfile(project.id, { yaml: yamlToSave })
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
                </Button>
              </Group>
            </Group>
            {saveMessage && (
              <Alert color="green" title="Profile saved">
                <Text size="sm">{saveMessage}</Text>
              </Alert>
            )}
            {saveError && (
              <Alert color="red" title="Save failed">
                <Text size="sm">{saveError}</Text>
              </Alert>
            )}
            {clipboardStatus && (
              <Text size="sm" c="dimmed">
                {clipboardStatus}
              </Text>
            )}
            <Textarea
              value={yamlPreview}
              minRows={18}
              autosize
              readOnly
              spellCheck={false}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
          </Stack>
        </Card>
      </Stack>
    </ContentSection>
  )
}

export default GenerateProfile

