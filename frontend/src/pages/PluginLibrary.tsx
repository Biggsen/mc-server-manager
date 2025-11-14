import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plug, Plus } from '@phosphor-icons/react'
import {
  fetchPluginLibrary,
  deleteLibraryPlugin,
  fetchProjects,
  updateLibraryPluginConfigs,
  type StoredPluginRecord,
  type ProjectSummary,
  type PluginConfigDefinition,
  type PluginConfigRequirement,
} from '../lib/api'
import {
  Anchor,
  Badge,
  Group,
  Loader,
  NativeSelect,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { Button, Card, CardContent } from '../components/ui'
import { ContentSection } from '../components/layout'

type SourceFilter = 'all' | 'download' | 'upload'

function getPluginSourceKind(plugin: StoredPluginRecord): 'download' | 'upload' {
  if (plugin.source?.uploadPath) {
    return 'upload'
  }
  return 'download'
}

type ConfigDefinitionDraft = {
  key: string
  id: string
  path: string
  requirement: PluginConfigRequirement
  label: string
  description: string
}

const requirementOptions: { value: PluginConfigRequirement; label: string }[] = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'generated', label: 'Generated' },
]

function definitionToDraft(definition: PluginConfigDefinition, index: number): ConfigDefinitionDraft {
  return {
    key: `${definition.id ?? 'definition'}-${index}-${Math.random().toString(36).slice(2)}`,
    id: definition.id ?? '',
    path: definition.path ?? '',
    label: definition.label ?? '',
    description: definition.description ?? '',
    requirement: definition.requirement ?? 'optional',
  }
}

function createEmptyDraft(): ConfigDefinitionDraft {
  return {
    key: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: '',
    path: '',
    label: '',
    description: '',
    requirement: 'optional',
  }
}

const sourceLabel: Record<'download' | 'upload', string> = {
  download: 'Download URL',
  upload: 'Uploaded jar',
}

function PluginLibrary() {
  const navigate = useNavigate()
  const [plugins, setPlugins] = useState<StoredPluginRecord[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [projectFilter, setProjectFilter] = useState<'all' | string>('all')
  const [configEditor, setConfigEditor] = useState<{
    plugin: StoredPluginRecord
    drafts: ConfigDefinitionDraft[]
    busy: boolean
    error: string | null
    touched: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const [library, projectList] = await Promise.all([
          fetchPluginLibrary(),
          fetchProjects(),
        ])
        if (cancelled) return
        setPlugins(library)
        setProjects(projectList)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load plugin library.')
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
  }, [])

  const usageMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const project of projects) {
      for (const plugin of project.plugins ?? []) {
        if (!plugin.version) continue
        const key = `${plugin.id}:${plugin.version}`
        const list = map.get(key)
        if (list) {
          list.push(project.id)
        } else {
          map.set(key, [project.id])
        }
      }
    }
    return map
  }, [projects])

  const projectLookup = useMemo(() => {
    const map = new Map<string, ProjectSummary>()
    projects.forEach((project) => {
      map.set(project.id, project)
    })
    return map
  }, [projects])

  const filteredPlugins = useMemo(() => {
    const term = query.trim().toLowerCase()
    return plugins.filter((plugin) => {
      const kind = getPluginSourceKind(plugin)
      if (sourceFilter !== 'all' && kind !== sourceFilter) {
        return false
      }

      if (term) {
        const haystack = [
          plugin.id,
          plugin.version,
          plugin.provider,
          plugin.source?.slug,
          plugin.source?.projectUrl,
          plugin.source?.downloadUrl,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(term)) {
          return false
        }
      }

      if (projectFilter !== 'all') {
        const key = `${plugin.id}:${plugin.version}`
        const usage = usageMap.get(key) ?? []
        if (!usage.includes(projectFilter)) {
          return false
        }
      }

      return true
    })
  }, [plugins, sourceFilter, query, projectFilter, usageMap])

  return (
    <ContentSection as="section" padding="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="flex-start">
          <Group gap="sm">
            <Plug size={24} weight="fill" aria-hidden="true" />
            <Stack gap={2}>
              <Title order={2}>Plugin Library</Title>
              <Text size="sm" c="dimmed">
                Manage saved plugin binaries and config path definitions.
              </Text>
            </Stack>
          </Group>
          <Button
            variant="primary"
            icon={<Plus size={18} weight="fill" aria-hidden="true" />}
            onClick={() => navigate('/plugins/add')}
          >
            Add plugin
          </Button>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          <Stack gap={4}>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              Search
            </Text>
            <TextInput
              id="plugin-library-search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search by plugin id, version, or source"
            />
          </Stack>
          <Stack gap={4}>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              Source
            </Text>
            <NativeSelect
              id="plugin-library-source"
              value={sourceFilter}
              onChange={(event) => setSourceFilter((event.currentTarget.value || 'all') as SourceFilter)}
              data={[
                { value: 'all', label: 'All sources' },
                { value: 'download', label: 'Download URL' },
                { value: 'upload', label: 'Uploaded jar' },
              ]}
            />
          </Stack>
          <Stack gap={4}>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              Project usage
            </Text>
            <NativeSelect
              id="plugin-library-project"
              value={projectFilter}
              onChange={(event) =>
                setProjectFilter(event.currentTarget.value ? event.currentTarget.value : 'all')
              }
              data={[
                { value: 'all', label: 'All projects' },
                ...projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
              ]}
            />
          </Stack>
        </SimpleGrid>

        {loading && (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading library…
            </Text>
          </Group>
        )}
        {error && (
          <Text size="sm" c="red.4">
            {error}
          </Text>
        )}
        {!loading && !error && filteredPlugins.length === 0 && (
          <Text size="sm" c="dimmed">
            {query || projectFilter !== 'all' || sourceFilter !== 'all'
              ? 'No plugins match your filters.'
              : 'No saved plugins yet. Click “Add plugin” to capture a plugin for reuse.'}
          </Text>
        )}

        {!loading && !error && filteredPlugins.length > 0 && (
          <ScrollArea>
            <Table verticalSpacing="sm" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Plugin</Table.Th>
                  <Table.Th>Version</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th>Minecraft</Table.Th>
                  <Table.Th>Cache</Table.Th>
                  <Table.Th>Projects</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredPlugins.map((plugin) => {
                  const key = `${plugin.id}:${plugin.version}`
                  const kind = getPluginSourceKind(plugin)
                  const usageIds = usageMap.get(key) ?? []
                  const usages = usageIds
                    .map((projectId) => projectLookup.get(projectId))
                    .filter((project): project is ProjectSummary => Boolean(project))

                  const supportRange = (() => {
                    if (plugin.minecraftVersionMin && plugin.minecraftVersionMax) {
                      return plugin.minecraftVersionMin === plugin.minecraftVersionMax
                        ? plugin.minecraftVersionMin
                        : `${plugin.minecraftVersionMin} – ${plugin.minecraftVersionMax}`
                    }
                    if (plugin.minecraftVersionMin) return plugin.minecraftVersionMin
                    if (plugin.minecraftVersionMax) return plugin.minecraftVersionMax
                    return null
                  })()

                  return (
                    <Table.Tr key={key}>
                      <Table.Td>
                        <Stack gap={4}>
                          <Text fw={600}>{plugin.id}</Text>
                          {plugin.source?.projectUrl && (
                            <Anchor href={plugin.source.projectUrl} target="_blank" rel="noreferrer" size="sm">
                              View project
                            </Anchor>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>{plugin.version}</Table.Td>
                      <Table.Td>
                        <Badge variant="light">{sourceLabel[kind]}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="sm">{supportRange ?? '—'}</Text>
                          {plugin.source?.loader && (
                            <Text size="xs" c="dimmed">
                              Loader: {plugin.source.loader}
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          {plugin.cachePath ? (
                            <>
                              <Text size="sm">
                                <code>{plugin.cachePath}</code>
                              </Text>
                              {plugin.cachedAt && (
                                <Text size="xs" c="dimmed">
                                  Cached {new Date(plugin.cachedAt).toLocaleString()}
                                </Text>
                              )}
                              {plugin.lastUsedAt && (
                                <Text size="xs" c="dimmed">
                                  Last used {new Date(plugin.lastUsedAt).toLocaleString()}
                                </Text>
                              )}
                            </>
                          ) : (
                            <Text size="sm" c="dimmed">
                              Pending
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        {usages.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            Unused
                          </Text>
                        ) : (
                          <Stack gap={4}>
                            {usages.map((project) => (
                              <Anchor key={project.id} component={Link} to={`/projects/${project.id}`} size="sm">
                                {project.name}
                              </Anchor>
                            ))}
                          </Stack>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="wrap" justify="flex-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `Remove ${plugin.id} ${plugin.version} from library? This does not affect existing projects.`,
                                )
                              ) {
                                return
                              }
                              try {
                                const remaining = await deleteLibraryPlugin(plugin.id, plugin.version)
                                setPlugins(remaining)
                              } catch (err) {
                                setError(err instanceof Error ? err.message : 'Failed to delete plugin.')
                              }
                            }}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const drafts: ConfigDefinitionDraft[] = (plugin.configDefinitions ?? []).map(
                                (definition, index) => definitionToDraft(definition, index),
                              )
                              setConfigEditor({
                                plugin,
                                drafts,
                                busy: false,
                                error: null,
                                touched: false,
                              })
                            }}
                          >
                            Manage config paths
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}

        {configEditor && (
          <ContentSection as="article" padding="xl">
            <Stack gap="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Title order={3}>
                    Manage Config Paths · {configEditor.plugin.id} {configEditor.plugin.version}
                  </Title>
                  <Text size="sm" c="dimmed">
                    Define expected config files for this plugin. Paths are relative to the project root.
                  </Text>
                </Stack>
                <Button variant="ghost" onClick={() => setConfigEditor(null)} disabled={configEditor.busy}>
                  Close
                </Button>
              </Group>

              {configEditor.error && (
                <Text size="sm" c="red.4">
                  {configEditor.error}
                </Text>
              )}

              <Stack gap="md">
                {configEditor.drafts.length === 0 && (
                  <Text size="sm" c="dimmed">
                    No config paths defined yet. Add one to get started.
                  </Text>
                )}
                {configEditor.drafts.map((draft, index) => (
                  <Card key={draft.key}>
                    <CardContent>
                      <Stack gap="md">
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                          <Stack gap={4}>
                            <Text size="xs" fw={600} c="dimmed">
                              Label
                            </Text>
                            <TextInput
                              id={`config-label-${draft.key}`}
                              value={draft.label}
                              onChange={(event) => {
                                const value = event.currentTarget.value
                                setConfigEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        touched: true,
                                        drafts: prev.drafts.map((item) =>
                                          item.key === draft.key ? { ...item, label: value } : item,
                                        ),
                                      }
                                    : prev,
                                )
                              }}
                              placeholder="WorldGuard regions"
                            />
                          </Stack>
                          <Stack gap={4}>
                            <Text size="xs" fw={600} c="dimmed">
                              Relative path
                            </Text>
                            <TextInput
                              id={`config-path-${draft.key}`}
                              value={draft.path}
                              onChange={(event) => {
                                const value = event.currentTarget.value
                                setConfigEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        touched: true,
                                        drafts: prev.drafts.map((item) =>
                                          item.key === draft.key ? { ...item, path: value } : item,
                                        ),
                                      }
                                    : prev,
                                )
                              }}
                              placeholder="plugins/WorldGuard/worlds/world/regions.yml"
                              required
                            />
                          </Stack>
                          <Stack gap={4}>
                            <Text size="xs" fw={600} c="dimmed">
                              Requirement
                            </Text>
                            <NativeSelect
                              id={`config-requirement-${draft.key}`}
                              value={draft.requirement}
                              onChange={(event) => {
                                const value = event.currentTarget.value as PluginConfigRequirement
                                setConfigEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        touched: true,
                                        drafts: prev.drafts.map((item) =>
                                          item.key === draft.key ? { ...item, requirement: value } : item,
                                        ),
                                      }
                                    : prev,
                                )
                              }}
                              data={requirementOptions.map((option) => ({
                                value: option.value,
                                label: option.label,
                              }))}
                            />
                          </Stack>
                          <Stack gap={4}>
                            <Text size="xs" fw={600} c="dimmed">
                              Description
                            </Text>
                            <TextInput
                              id={`config-description-${draft.key}`}
                              value={draft.description}
                              onChange={(event) => {
                                const value = event.currentTarget.value
                                setConfigEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        touched: true,
                                        drafts: prev.drafts.map((item) =>
                                          item.key === draft.key ? { ...item, description: value } : item,
                                        ),
                                      }
                                    : prev,
                                )
                              }}
                              placeholder="Optional details for teammates"
                            />
                          </Stack>
                        </SimpleGrid>

                        <Group justify="space-between" align="center">
                          <Text size="sm" c="dimmed">
                            #{index + 1}
                          </Text>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setConfigEditor((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      touched: true,
                                      drafts: prev.drafts.filter((item) => item.key !== draft.key),
                                    }
                                  : prev,
                              )
                            }
                            disabled={configEditor.busy}
                          >
                            Remove
                          </Button>
                        </Group>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>

              <Group>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setConfigEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            touched: true,
                            drafts: [...prev.drafts, createEmptyDraft()],
                          }
                        : prev,
                    )
                  }
                  disabled={configEditor.busy}
                >
                  Add config path
                </Button>
              </Group>

              <Group gap="sm">
                <Button
                  type="button"
                  variant="primary"
                  disabled={configEditor.busy}
                  onClick={async () => {
                    if (!configEditor) return
                    const sanitized: PluginConfigDefinition[] = []
                    for (const draft of configEditor.drafts) {
                      const path = draft.path.trim()
                      if (!path) {
                        setConfigEditor((prev) =>
                          prev ? { ...prev, error: 'Each config must include a relative path.' } : prev,
                        )
                        return
                      }
                      sanitized.push({
                        id: draft.id.trim(),
                        path,
                        label: draft.label.trim() || undefined,
                        description: draft.description.trim() || undefined,
                        requirement: draft.requirement,
                      })
                    }
                    try {
                      setConfigEditor((prev) => (prev ? { ...prev, busy: true, error: null } : prev))
                      const updated = await updateLibraryPluginConfigs(
                        configEditor.plugin.id,
                        configEditor.plugin.version,
                        {
                          configDefinitions: sanitized,
                        },
                      )
                      setPlugins((prev) =>
                        prev.map((plugin) =>
                          plugin.id === updated.id && plugin.version === updated.version ? { ...updated } : plugin,
                        ),
                      )
                      setConfigEditor({
                        plugin: updated,
                        drafts: (updated.configDefinitions ?? []).map((definition, index) =>
                          definitionToDraft(definition, index),
                        ),
                        busy: false,
                        error: null,
                        touched: false,
                      })
                    } catch (err) {
                      setConfigEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              busy: false,
                              error: err instanceof Error ? err.message : 'Failed to save config paths.',
                            }
                          : prev,
                      )
                    }
                  }}
                >
                  {configEditor.busy ? 'Saving…' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={configEditor.busy}
                  onClick={() => {
                    const plugin = configEditor.plugin
                    setConfigEditor({
                      plugin,
                      drafts: (plugin.configDefinitions ?? []).map((definition, index) =>
                        definitionToDraft(definition, index),
                      ),
                      busy: false,
                      error: null,
                      touched: false,
                    })
                  }}
                >
                  Reset
                </Button>
              </Group>
            </Stack>
          </ContentSection>
        )}
      </Stack>
    </ContentSection>
  )
}

export default PluginLibrary

