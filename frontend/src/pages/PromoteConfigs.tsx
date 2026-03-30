import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import {
  fetchProject,
  fetchPromotePreview,
  promoteProjectConfigs,
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

export default function PromoteConfigs() {
  const { id } = useParams<{ id: string }>()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [targetName, setTargetName] = useState('')
  const [rows, setRows] = useState<PromotePreviewRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [promoting, setPromoting] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setPreviewError(null)
    try {
      const [proj, data] = await Promise.all([fetchProject(id), fetchPromotePreview(id)])
      setSourceName(proj.name)
      setTargetName(data.targetProjectName)
      setRows(data.rows)
      setSelected(new Set(data.rows.map((r) => r.path)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load promote preview'
      setPreviewError(message)
      setRows([])
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
            {sourceName && targetName && (
              <Text size="sm" c="dimmed" mt={4}>
                From <Text component="span" fw={600}>{sourceName}</Text> to{' '}
                <Text component="span" fw={600}>{targetName}</Text>
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

        {!loading && !previewError && rows.length === 0 && (
          <Card>
            <CardContent>
              <Text size="sm">No mismatched configs — source and downstream are in sync for every path.</Text>
            </CardContent>
          </Card>
        )}

        {!loading && !previewError && rows.length > 0 && (
          <Card>
            <CardContent>
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  Only paths where generator version or stored hash differs (or the file is new on this project) are listed.
                </Text>
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
      </Stack>
    </ContentSection>
  )
}
