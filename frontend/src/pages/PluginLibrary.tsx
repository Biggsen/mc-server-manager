import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PencilSimple, Plug, Plus, Trash } from '@phosphor-icons/react'
import {
  fetchPluginLibrary,
  deleteLibraryPlugin,
  fetchProjects,
  updateLibraryPluginConfigs,
  patchLibraryPluginDataFolder,
  type StoredPluginRecord,
  type ProjectSummary,
  type PluginConfigDefinition,
} from '../lib/api'
import {
  ActionIcon,
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
import { Button, Card, CardContent, Modal } from '../components/ui'
import { ContentSection } from '../components/layout'

type SourceFilter = 'all' | 'download' | 'upload'

function getPluginSourceKind(plugin: StoredPluginRecord): 'download' | 'upload' {
  if (plugin.source?.uploadPath) {
    return 'upload'
  }
  if (plugin.source?.downloadUrl) {
    return 'download'
  }
  // If neither exists, likely an uploaded plugin missing uploadPath in source
  // (older data or edge case) - default to 'upload' to avoid misleading "DL" badge
  return 'upload'
}

type ConfigDefinitionDraft = {
  key: string
  id: string
  path: string
  label: string
  description: string
}

function definitionToDraft(definition: PluginConfigDefinition, index: number): ConfigDefinitionDraft {
  return {
    key: `${definition.id ?? 'definition'}-${index}-${Math.random().toString(36).slice(2)}`,
    id: definition.id ?? '',
    path: definition.path ?? '',
    label: definition.label ?? '',
    description: definition.description ?? '',
  }
}

function createEmptyDraft(): ConfigDefinitionDraft {
  return {
    key: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: '',
    path: '',
    label: '',
    description: '',
  }
}

const sourceLabel: Record<'download' | 'upload', string> = {
  download: 'DL',
  upload: 'UL',
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
    dataFolderInput: string
    busy: boolean
    error: string | null
    touched: boolean
  } | null>(null)
  const [copyFromVersion, setCopyFromVersion] = useState('')

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
          plugin.dataFolder,
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
                { value: 'download', label: 'DL' },
                { value: 'upload', label: 'UL' },
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
                  <Table.Th>Data folder</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th>Minecraft</Table.Th>
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
                        <Text size="sm" ff="monospace">
                          {plugin.dataFolder?.trim() || plugin.id}
                        </Text>
                        {plugin.dataFolder?.trim() ? (
                          <Text size="xs" c="dimmed">
                            plugin id: {plugin.id}
                          </Text>
                        ) : null}
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          <Badge variant="light">{sourceLabel[kind]}</Badge>
                          {plugin.source?.uploadPath && (
                            <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all', overflowWrap: 'break-word' }}>
                              {plugin.source.uploadPath}
                            </Text>
                          )}
                        </Stack>
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
                        <Group gap="xs" wrap="nowrap" justify="flex-end">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label={`Edit ${plugin.id} ${plugin.version}`}
                            title={`Edit ${plugin.id} ${plugin.version}`}
                            onClick={() => {
                              const drafts: ConfigDefinitionDraft[] = (plugin.configDefinitions ?? []).map(
                                (definition, index) => definitionToDraft(definition, index),
                              )
                              setConfigEditor({
                                plugin,
                                drafts,
                                dataFolderInput: plugin.dataFolder ?? '',
                                busy: false,
                                error: null,
                                touched: false,
                              })
                            }}
                          >
                            <PencilSimple size={18} weight="bold" aria-hidden="true" />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Delete ${plugin.id} ${plugin.version}`}
                            title={`Delete ${plugin.id} ${plugin.version}`}
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
                            <Trash size={18} weight="bold" aria-hidden="true" />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}

        <Modal
          opened={Boolean(configEditor)}
          onClose={() => {
            if (configEditor?.busy) return
            setCopyFromVersion('')
            setConfigEditor(null)
          }}
          title={
            configEditor
              ? `Edit — ${configEditor.plugin.id} ${configEditor.plugin.version}`
              : 'Edit'
          }
          size="xl"
          centered
        >
          {configEditor && (
            <ScrollArea h={560} type="scroll" offsetScrollbars>
              <Stack gap="lg" pr="xs">
              <Text size="sm" c="dimmed">
                Define expected config files for this plugin. Paths are relative to the project root.
              </Text>

              {configEditor.error && (
                <Text size="sm" c="red.4">
                  {configEditor.error}
                </Text>
              )}

              <Stack gap={4}>
                <Text size="xs" fw={600} c="dimmed">
                  Data folder under plugins/
                </Text>
                <Text size="xs" c="dimmed">
                  Folder the server uses for this plugin&apos;s files (often differs from plugin id, e.g.
                  EssentialsX → Essentials). Leave empty to use the plugin id.
                </Text>
                <Group align="flex-end" gap="sm" wrap="wrap">
                  <TextInput
                    style={{ flex: 1, minWidth: 200 }}
                    value={configEditor.dataFolderInput}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setConfigEditor((prev) =>
                        prev ? { ...prev, dataFolderInput: value, touched: true } : prev,
                      )
                    }}
                    placeholder={configEditor.plugin.id}
                    disabled={configEditor.busy}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={configEditor.busy}
                    onClick={async () => {
                      if (!configEditor) return
                      const next = configEditor.dataFolderInput.trim()
                      const prev = configEditor.plugin.dataFolder?.trim() ?? ''
                      if (next === prev) return
                      try {
                        setConfigEditor((p) => (p ? { ...p, busy: true, error: null } : p))
                        const updated = await patchLibraryPluginDataFolder(
                          configEditor.plugin.id,
                          configEditor.plugin.version,
                          next.length > 0 ? next : null,
                        )
                        setPlugins((list) =>
                          list.map((pl) =>
                            pl.id === updated.id && pl.version === updated.version ? updated : pl,
                          ),
                        )
                        setConfigEditor((p) =>
                          p
                            ? {
                                ...p,
                                plugin: updated,
                                dataFolderInput: updated.dataFolder ?? '',
                                busy: false,
                                error: null,
                              }
                            : p,
                        )
                      } catch (err) {
                        setConfigEditor((p) =>
                          p
                            ? {
                                ...p,
                                busy: false,
                                error: err instanceof Error ? err.message : 'Failed to save data folder.',
                              }
                            : p,
                        )
                      }
                    }}
                  >
                    Save data folder
                  </Button>
                </Group>
              </Stack>

              {(() => {
                const otherVersions = plugins.filter(
                  (p) =>
                    p.id.toLowerCase() === configEditor.plugin.id.toLowerCase() &&
                    p.version !== configEditor.plugin.version,
                )
                if (otherVersions.length === 0) return null
                return (
                  <Group align="flex-end" gap="sm">
                    <NativeSelect
                      label="Copy from another version"
                      description="Replace current drafts with config paths from the selected version. Save to keep."
                      value={copyFromVersion}
                      onChange={(e) => {
                        const version = e.currentTarget.value
                        setCopyFromVersion('')
                        if (!version) return
                        const source = plugins.find(
                          (p) =>
                            p.id.toLowerCase() === configEditor.plugin.id.toLowerCase() &&
                            p.version === version,
                        )
                        if (!source) return
                        const definitions = source.configDefinitions ?? []
                        setConfigEditor((prev) =>
                          prev
                            ? {
                                ...prev,
                                touched: true,
                                drafts: definitions.map((def, i) => definitionToDraft(def, i)),
                              }
                            : prev,
                        )
                      }}
                      data={[
                        { value: '', label: 'Select version…' },
                        ...otherVersions
                          .slice()
                          .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
                          .map((p) => ({ value: p.version, label: `v${p.version}` })),
                      ]}
                      style={{ maxWidth: 220 }}
                    />
                  </Group>
                )
              })()}

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
                              required
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
                        dataFolderInput: updated.dataFolder ?? '',
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
                      dataFolderInput: plugin.dataFolder ?? '',
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
            </ScrollArea>
          )}
        </Modal>
      </Stack>
    </ContentSection>
  )
}

export default PluginLibrary

