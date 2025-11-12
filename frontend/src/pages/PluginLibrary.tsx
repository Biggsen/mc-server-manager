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
import { Button } from '../components/ui'
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
    <ContentSection as="section">
      <header>
        <h2>
          <span className="title-icon" aria-hidden="true">
            <Plug size={22} weight="fill" />
          </span>
          Plugin Library
        </h2>
        <Button
          variant="primary"
          icon={<Plus size={18} weight="fill" aria-hidden="true" />}
          onClick={() => navigate('/plugins/add')}
        >
          Add Plugin
        </Button>
      </header>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="plugin-library-search">Search</label>
          <input
            id="plugin-library-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by plugin id, version, or source"
          />
        </div>
        <div className="field">
          <label htmlFor="plugin-library-source">Source</label>
          <select
            id="plugin-library-source"
            value={sourceFilter}
            onChange={(event) =>
              setSourceFilter((event.target.value || 'all') as SourceFilter)
            }
          >
            <option value="all">All sources</option>
            <option value="download">Download URL</option>
            <option value="upload">Uploaded jar</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="plugin-library-project">Project usage</label>
          <select
            id="plugin-library-project"
            value={projectFilter}
            onChange={(event) =>
              setProjectFilter(event.target.value ? event.target.value : 'all')
            }
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="muted">Loading library…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && filteredPlugins.length === 0 && (
        <p className="empty-state">
          {query || projectFilter !== 'all' || sourceFilter !== 'all'
            ? 'No plugins match your filters.'
            : 'No saved plugins yet. Click "Add Plugin" to add plugins to the library.'}
        </p>
      )}

      {!loading && !error && filteredPlugins.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Version</th>
              <th>Source</th>
              <th>Minecraft</th>
              <th>Cache</th>
              <th>Projects</th>
              <th />
            </tr>
          </thead>
          <tbody>
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
                <tr key={key}>
                  <td>
                    <strong>{plugin.id}</strong>
                    {plugin.source?.projectUrl && (
                      <div>
                        <a href={plugin.source.projectUrl} target="_blank" rel="noreferrer">
                          View project
                        </a>
                      </div>
                    )}
                  </td>
                  <td>{plugin.version}</td>
                  <td>{sourceLabel[kind]}</td>
                  <td>
                    {supportRange ?? '—'}
                    {plugin.source?.loader && <span className="muted"> ({plugin.source.loader})</span>}
                  </td>
                  <td>
                    {plugin.cachePath ? (
                      <>
                        <code>{plugin.cachePath}</code>
                        <br />
                        {plugin.cachedAt && (
                          <span className="muted">
                            Cached {new Date(plugin.cachedAt).toLocaleString()}
                          </span>
                        )}
                        {plugin.lastUsedAt && (
                          <span className="muted">
                            <br />
                            Last used {new Date(plugin.lastUsedAt).toLocaleString()}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="muted">Pending</span>
                    )}
                  </td>
                  <td>
                    {usages.length === 0 && <span className="muted">Unused</span>}
                    {usages.length > 0 && (
                      <ul className="inline-list">
                        {usages.map((project) => (
                          <li key={project.id}>
                            <Link to={`/projects/${project.id}`}>{project.name}</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="dev-buttons">
                    <button
                      type="button"
                      className="ghost"
                      onClick={async () => {
                        if (!window.confirm(`Remove ${plugin.id} ${plugin.version} from library?`)) {
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
                    </button>
                    <button
                      type="button"
                      className="ghost"
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
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {configEditor && (
        <div className="library-config-editor">
          <ContentSection as="article">
            <header>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3>
                    Manage Config Paths · {configEditor.plugin.id} {configEditor.plugin.version}
                  </h3>
                  <p className="muted">
                    Define expected config files for this plugin. Paths are relative to project root.
                  </p>
                </div>
                <div className="dev-buttons">
                  <Button
                    variant="ghost"
                    onClick={() => setConfigEditor(null)}
                    disabled={configEditor.busy}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </header>

            {configEditor.error && <p className="error-text">{configEditor.error}</p>}

            <div className="config-definition-list">
              {configEditor.drafts.length === 0 && (
                <p className="muted">No config paths defined yet. Add one to get started.</p>
              )}
              {configEditor.drafts.map((draft, index) => (
                <div key={draft.key} className="config-definition-card">
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor={`config-label-${draft.key}`}>Label</label>
                      <input
                        id={`config-label-${draft.key}`}
                        value={draft.label}
                        onChange={(event) => {
                          const value = event.target.value
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
                    </div>
                    <div className="field">
                      <label htmlFor={`config-path-${draft.key}`}>Relative path</label>
                      <input
                        id={`config-path-${draft.key}`}
                        value={draft.path}
                        onChange={(event) => {
                          const value = event.target.value
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
                    </div>
                    <div className="field">
                      <label htmlFor={`config-requirement-${draft.key}`}>Requirement</label>
                      <select
                        id={`config-requirement-${draft.key}`}
                        value={draft.requirement}
                        onChange={(event) => {
                          const value = event.target.value as PluginConfigRequirement
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
                      >
                        {requirementOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`config-description-${draft.key}`}>Description</label>
                      <input
                        id={`config-description-${draft.key}`}
                        value={draft.description}
                        onChange={(event) => {
                          const value = event.target.value
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
                    </div>
                  </div>
                  <div className="config-definition-actions">
                    <span className="muted">#{index + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
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
                  </div>
                </div>
              ))}
            </div>

            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setConfigEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          touched: true,
                          drafts: [
                            ...prev.drafts,
                            createEmptyDraft(),
                          ],
                        }
                      : prev,
                  )
                }
                disabled={configEditor.busy}
              >
                Add config path
              </Button>
            </div>

            <div className="form-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
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
                    const updated = await updateLibraryPluginConfigs(configEditor.plugin.id, configEditor.plugin.version, {
                      configDefinitions: sanitized,
                    })
                    setPlugins((prev) =>
                      prev.map((plugin) =>
                        plugin.id === updated.id && plugin.version === updated.version
                          ? { ...updated }
                          : plugin,
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
            </div>
          </ContentSection>
        </div>
      )}
    </ContentSection>
  )
}

export default PluginLibrary

