import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import {
  fetchPromotePreview,
  promoteProjectConfigs,
  type PromotePluginCompareRow,
  type PromotePreviewRow,
} from '../lib/api'
import { ContentSection } from '../components/layout'
import { Anchor, Checkbox, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import { Button, Card, CardContent } from '../components/ui'
import { useToast } from '../components/ui/toast'

function formatGen(v?: string): string {
  const t = (v ?? '').trim()
  return t || '—'
}

function isPluginCompareMismatch(row: PromotePluginCompareRow): boolean {
  const { source, target } = row
  if (!source || !target) {
    return true
  }
  return source.version !== target.version || source.enabled !== target.enabled
}

function PluginVersionCell({
  entry,
  emphasize,
}: {
  entry: { version: string; enabled: boolean } | null
  emphasize?: boolean
}) {
  if (!entry) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    )
  }
  return (
    <Stack gap={2}>
      <Text size="sm" c={emphasize ? 'orange' : undefined}>
        v{entry.version}
      </Text>
      {!entry.enabled ? (
        <Text size="xs" c="dimmed">
          Disabled
        </Text>
      ) : null}
    </Stack>
  )
}

export default function PromoteConfigs() {
  const { id } = useParams<{ id: string }>()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [targetName, setTargetName] = useState('')
  const [targetProjectId, setTargetProjectId] = useState('')
  const [rows, setRows] = useState<PromotePreviewRow[]>([])
  const [missingDownstreamPluginIds, setMissingDownstreamPluginIds] = useState<string[]>([])
  const [pluginCompareRows, setPluginCompareRows] = useState<PromotePluginCompareRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [promoting, setPromoting] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setPreviewError(null)
    try {
      const data = await fetchPromotePreview(id)
      setSourceName(data.sourceProjectName)
      setTargetName(data.targetProjectName)
      setTargetProjectId(data.targetProjectId)
      setRows(data.rows)
      setMissingDownstreamPluginIds(data.missingDownstreamPluginIds ?? [])
      setPluginCompareRows(data.pluginCompareRows ?? [])
      setSelected(new Set(data.rows.map((r) => r.path)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load promote preview'
      setPreviewError(message)
      setRows([])
      setMissingDownstreamPluginIds([])
      setPluginCompareRows([])
      setTargetProjectId('')
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const allSelected = rows.length > 0 && selected.size === rows.length
  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((r) => r.path)))
    }
  }, [allSelected, rows])

  const toggleOne = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handlePromote = async () => {
    if (!id || selected.size === 0) return
    setPromoting(true)
    try {
      const { promoted } = await promoteProjectConfigs(id, [...selected])
      toast({
        variant: 'success',
        title: 'Configs promoted',
        description: `${promoted.length} file(s) copied to ${targetName}. Run a build on the downstream project when ready.`,
      })
      await load()
    } catch (err) {
      toast({
        variant: 'danger',
        title: 'Promote failed',
        description: err instanceof Error ? err.message : 'Failed to promote configs',
      })
    } finally {
      setPromoting(false)
    }
  }

  const backHref = id ? `/projects/${id}` : '/projects'

  const mismatchedPluginRows = useMemo(
    () => pluginCompareRows.filter(isPluginCompareMismatch),
    [pluginCompareRows],
  )

  const pluginTableBody = useMemo(() => {
    return mismatchedPluginRows.map((row) => (
      <Table.Tr key={row.id}>
        <Table.Td>
          <Text size="sm" fw={600}>
            {row.id}
          </Text>
        </Table.Td>
        <Table.Td>
          <PluginVersionCell entry={row.source} emphasize />
        </Table.Td>
        <Table.Td>
          <PluginVersionCell entry={row.target} emphasize />
        </Table.Td>
      </Table.Tr>
    ))
  }, [mismatchedPluginRows])

  const tableBody = useMemo(() => {
    return rows.map((row) => (
      <Table.Tr key={row.path}>
        <Table.Td>
          <Checkbox
            checked={selected.has(row.path)}
            onChange={() => toggleOne(row.path)}
            aria-label={`Include ${row.path}`}
          />
        </Table.Td>
        <Table.Td>
          <Text size="sm" fw={600}>
            {row.path}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{formatGen(row.source.generatorVersion)}</Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{row.target ? formatGen(row.target.generatorVersion) : '—'}</Text>
        </Table.Td>
      </Table.Tr>
    ))
  }, [rows, selected, toggleOne])

  if (!id) {
    return (
      <ContentSection padding="xl">
        <Text>Invalid project.</Text>
      </ContentSection>
    )
  }

  return (
    <ContentSection padding="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Anchor component={Link} to={backHref} size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowLeft size={16} weight="bold" aria-hidden />
              Back to project
            </Anchor>
            <Title order={2} mt="sm">
              Promote configs
            </Title>
            {sourceName && targetName && targetProjectId && (
              <Text size="sm" c="dimmed" mt={4}>
                From{' '}
                <Anchor component={Link} to={`/projects/${encodeURIComponent(id)}`} inherit fw={600}>
                  {sourceName}
                </Anchor>{' '}
                to{' '}
                <Anchor
                  component={Link}
                  to={`/projects/${encodeURIComponent(targetProjectId)}`}
                  inherit
                  fw={600}
                >
                  {targetName}
                </Anchor>
              </Text>
            )}
          </div>
        </Group>

        {loading && (
          <Group>
            <Loader size="sm" />
            <Text size="sm">Loading comparison…</Text>
          </Group>
        )}

        {!loading && previewError && (
          <Card>
            <CardContent>
              <Text size="sm" c="red">
                {previewError}
              </Text>
              <Text size="sm" c="dimmed" mt="sm">
                Set &quot;Promote to project&quot; in this project&apos;s Settings, then return here.
              </Text>
            </CardContent>
          </Card>
        )}

        {!loading && !previewError && (
          <Stack gap="lg">
            {rows.length === 0 ? (
              <Card>
                <CardContent>
                  {missingDownstreamPluginIds.length > 0 ? (
                    <Stack gap={6}>
                      <Text size="sm" fw={600}>
                        Missing downstream:
                      </Text>
                      {missingDownstreamPluginIds.map((pid) => (
                        <Text key={pid} size="sm" c="dimmed">
                          {pid} plugin
                        </Text>
                      ))}
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Nothing to promote — every path matches downstream.
                    </Text>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent>
                  <Stack gap="md">
                    {missingDownstreamPluginIds.length > 0 ? (
                      <Stack gap={6}>
                        <Text size="sm" fw={600}>
                          Missing downstream:
                        </Text>
                        {missingDownstreamPluginIds.map((pid) => (
                          <Text key={pid} size="sm" c="dimmed">
                            {pid} plugin
                          </Text>
                        ))}
                      </Stack>
                    ) : null}
                    <Table striped highlightOnHover withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th style={{ width: 48 }}>
                            <Checkbox
                              checked={allSelected}
                              indeterminate={selected.size > 0 && !allSelected}
                              onChange={toggleAll}
                              aria-label="Select all"
                            />
                          </Table.Th>
                          <Table.Th>Path</Table.Th>
                          <Table.Th>This project (gen)</Table.Th>
                          <Table.Th>Downstream (gen)</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>{tableBody}</Table.Tbody>
                    </Table>
                    <Group>
                      <Button
                        variant="primary"
                        loading={promoting}
                        disabled={selected.size === 0}
                        onClick={() => void handlePromote()}
                      >
                        Promote selected
                      </Button>
                      <Text size="sm" c="dimmed">
                        {selected.size} of {rows.length} selected
                      </Text>
                    </Group>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {mismatchedPluginRows.length > 0 ? (
              <Card>
                <CardContent>
                  <Stack gap="sm">
                    <Title order={4}>Plugin mismatches</Title>
                    <Text size="sm" c="dimmed">
                      Only plugins that differ in version, exist on one side only, or have different
                      enabled/disabled settings.
                    </Text>
                    <Table striped highlightOnHover withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Plugin</Table.Th>
                          <Table.Th>This project</Table.Th>
                          <Table.Th>Downstream</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>{pluginTableBody}</Table.Tbody>
                    </Table>
                  </Stack>
                </CardContent>
              </Card>
            ) : null}
          </Stack>
        )}
      </Stack>
    </ContentSection>
  )
}
