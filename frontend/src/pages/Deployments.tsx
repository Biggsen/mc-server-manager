import { useEffect, useState } from 'react'
import {
  fetchDeploymentRecords,
  createDeployment,
  deleteDeployment,
  getDeploymentArtifactUrl,
  fetchProjects,
  fetchBuilds,
  type DeploymentRecord,
  type ProjectSummary,
  type BuildJob,
} from '../lib/api'
import { Alert, Checkbox, Grid, Group, Loader, NativeSelect, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core'
import { Button, Card, CardContent } from '../components/ui'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function shortDeploymentId(fullId: string): string {
  return fullId.includes(':') ? fullId.split(':')[1] ?? fullId : fullId
}

function Deployments() {
  const [records, setRecords] = useState<DeploymentRecord[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [builds, setBuilds] = useState<BuildJob[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [createProjectId, setCreateProjectId] = useState<string>('')
  const [createBuildId, setCreateBuildId] = useState<string>('')
  const [createDescription, setCreateDescription] = useState('')
  const [includeServerJar, setIncludeServerJar] = useState(false)
  const [includeWorlds, setIncludeWorlds] = useState(false)
  const [serverJarPath, setServerJarPath] = useState('')
  const [historyProjectFilter, setHistoryProjectFilter] = useState<string>('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const projectList = await fetchProjects()
        if (cancelled) return
        setProjects(projectList)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setRecordsLoading(true)
        const list = await fetchDeploymentRecords(historyProjectFilter || undefined)
        if (cancelled) return
        setRecords(list)
      } catch (err) {
        if (cancelled) return
        setRecords([])
      } finally {
        if (!cancelled) {
          setRecordsLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [historyProjectFilter])

  useEffect(() => {
    if (!createProjectId) {
      setBuilds([])
      setCreateBuildId('')
      return
    }
    let cancelled = false
    fetchBuilds(createProjectId).then((list) => {
      if (cancelled) return
      const succeeded = list.filter((b) => b.status === 'succeeded')
      setBuilds(succeeded)
      const latest = succeeded.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0]
      setCreateBuildId(latest?.id ?? '')
    }).catch(() => {
      if (!cancelled) setBuilds([])
    })
    return () => {
      cancelled = true
    }
  }, [createProjectId])

  return (
    <Stack gap="lg" p="lg">
      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Stack gap="md">
            <Stack gap={4}>
              <Title order={3}>Create deployment</Title>
              <Text size="sm" c="dimmed">
                Create a server deployment zip from a succeeded build. Optional short description.
              </Text>
            </Stack>
            <Stack gap="md">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <NativeSelect
                    label="Project"
                    value={createProjectId}
                    onChange={(e) => setCreateProjectId(e.target.value)}
                    data={[
                      { value: '', label: 'Select project' },
                      ...projects.map((p) => ({ value: p.id, label: p.name || p.id })),
                    ]}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <NativeSelect
                    label="Build"
                    value={createBuildId}
                    onChange={(e) => setCreateBuildId(e.target.value)}
                    data={[
                      { value: '', label: builds.length ? 'Select build' : (createProjectId ? 'No succeeded builds' : 'Select project first') },
                      ...builds.map((b) => ({
                        value: b.id,
                        label: `${b.id.slice(0, 8)} (${new Date(b.createdAt).toLocaleString()})`,
                      })),
                    ]}
                    disabled={!createProjectId || builds.length === 0}
                  />
                </Grid.Col>
                <Grid.Col span={12}>
                  <Textarea
                    label="Description (optional)"
                    placeholder="e.g. Production deploy before event"
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    rows={2}
                  />
                </Grid.Col>
                <Grid.Col span={12}>
                  <Stack gap="xs">
                    <Checkbox
                      label="Include server jar"
                      checked={includeServerJar}
                      onChange={(e) => setIncludeServerJar(e.currentTarget.checked)}
                    />
                    {includeServerJar && (
                      <TextInput
                        label="Server JAR path"
                        placeholder="e.g. C:\server\paper-1.21.1.jar"
                        value={serverJarPath}
                        onChange={(e) => setServerJarPath(e.currentTarget.value)}
                        description="Absolute path to the server JAR file"
                      />
                    )}
                    <Checkbox
                      label="Include worlds"
                      checked={includeWorlds}
                      onChange={(e) => setIncludeWorlds(e.currentTarget.checked)}
                      description="Include world/, world_nether/, world_the_end/ from the build if present"
                    />
                  </Stack>
                </Grid.Col>
              </Grid>
              <Button
                variant="primary"
                disabled={creating || !createProjectId || !createBuildId}
                onClick={async () => {
                  setMessage(null)
                  try {
                    setCreating(true)
                    const deployment = await createDeployment({
                      projectId: createProjectId,
                      buildId: createBuildId,
                      description: createDescription.trim() || undefined,
                      includeServerJar: includeServerJar || undefined,
                      includeWorlds: includeWorlds || undefined,
                      serverJarPath: includeServerJar && serverJarPath.trim() ? serverJarPath.trim() : undefined,
                    })
                    setRecords((prev) => [deployment, ...prev])
                    setMessage('Deployment created.')
                    setCreateDescription('')
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : 'Failed to create deployment.')
                  } finally {
                    setCreating(false)
                  }
                }}
              >
                {creating ? 'Creating…' : 'Create deployment'}
              </Button>
              {message && (
                <Alert
                  color={message.includes('Failed') || message.includes('required') ? 'red' : 'green'}
                  title={message.includes('Failed') || message.includes('required') ? 'Error' : 'Success'}
                >
                  {message}
                </Alert>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack gap="md">
            <Stack gap={4}>
              <Title order={3}>Deployment history</Title>
              <Text size="sm" c="dimmed">
                List deployments (server zips). Download or publish to a target when supported.
              </Text>
            </Stack>
            <NativeSelect
              label="Filter by project"
              value={historyProjectFilter}
              onChange={(e) => setHistoryProjectFilter(e.target.value)}
              data={[
                { value: '', label: 'All projects' },
                ...projects.map((p) => ({ value: p.id, label: p.name || p.id })),
              ]}
              style={{ maxWidth: 320 }}
            />
            {recordsLoading && (
              <Group>
                <Loader size="sm" />
                <Text size="sm" c="dimmed">Loading deployment history…</Text>
              </Group>
            )}
            {!recordsLoading && records.length === 0 && (
              <Text size="sm" c="dimmed">No deployments yet. Create one from a succeeded build above.</Text>
            )}
            {!recordsLoading && records.length > 0 && (
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Project</Table.Th>
                    <Table.Th>Version</Table.Th>
                    <Table.Th>Description</Table.Th>
                    <Table.Th>Build</Table.Th>
                    <Table.Th>Created</Table.Th>
                    <Table.Th>Size</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {records.map((r) => {
                    const shortId = shortDeploymentId(r.id)
                    const projectName = projects.find((p) => p.id === r.projectId)?.name
                    return (
                    <Table.Tr key={r.id}>
                      <Table.Td>
                        <Text size="sm" ff="monospace" title={projectName ?? undefined}>{r.projectId}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace" fw={600}>{shortId}</Text>
                      </Table.Td>
                      <Table.Td>{r.description || '—'}</Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace">{r.buildId.slice(0, 8)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{new Date(r.createdAt).toLocaleString()}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{r.artifactSize != null ? formatBytes(r.artifactSize) : '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <a
                            href={getDeploymentArtifactUrl(r.id)}
                            download={`${r.projectId}-${shortId}.zip`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download
                          </a>
                          <Button
                            variant="ghost"
                            size="sm"
                            color="red"
                            disabled={deletingId !== null}
                            onClick={async () => {
                              if (!confirm(`Delete deployment ${shortId}? The zip file will be removed.`)) return
                              try {
                                setDeletingId(r.id)
                                await deleteDeployment(r.id)
                                setRecords((prev) => prev.filter((rec) => rec.id !== r.id))
                              } finally {
                                setDeletingId(null)
                              }
                            }}
                          >
                            {deletingId === r.id ? 'Deleting…' : 'Delete'}
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )})}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}

export default Deployments


