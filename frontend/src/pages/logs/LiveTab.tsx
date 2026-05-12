import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core'
import { Eye } from '@phosphor-icons/react'
import { Button } from '../../components/ui'
import { fetchLivePreview, type LivePreview } from '../../lib/api'

const POLL_INTERVAL_MS = 30_000

const ENTITY_COLORS: Record<string, string> = {
  region: 'blue',
  structure: 'violet',
  village: 'teal',
  heart: 'pink',
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.replace('T', ' ')
}

export interface LiveTabProps {
  serverId: string
}

export default function LiveTab({ serverId }: LiveTabProps) {
  const [preview, setPreview] = useState<LivePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchLivePreview(serverId)
      setPreview(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (autoRefresh) {
      timerRef.current = window.setInterval(() => {
        void refresh()
      }, POLL_INTERVAL_MS)
    }
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [autoRefresh, refresh])

  const recent = useMemo(() => {
    if (!preview) return []
    return [...preview.events].reverse().slice(0, 100)
  }, [preview])

  return (
    <Stack gap="md">
      <Alert color="gray" variant="light" icon={<Eye size={18} />}>
        Preview only — events from <Text span ff="monospace">latest.log</Text> are not persisted.
        Once the server rotates the log into a <Text span ff="monospace">.log.gz</Text>, ingest it
        from the Files tab to make it queryable.
      </Alert>

      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="md" wrap="wrap">
          {preview && (
            <>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  File size
                </Text>
                <Text size="sm" fw={500}>
                  {formatBytes(preview.fileSize)}
                </Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  Fetched
                </Text>
                <Text size="sm" fw={500}>
                  {formatBytes(preview.fetchedBytes)}
                </Text>
              </Stack>
              {preview.truncated && (
                <Badge color="yellow" variant="light">
                  Tailed
                </Badge>
              )}
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  Fetched at
                </Text>
                <Text size="sm">{formatTs(preview.fetchedAt)}</Text>
              </Stack>
            </>
          )}
        </Group>
        <Group gap="sm">
          <Switch
            label="Auto-refresh (30s)"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
          />
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Failed to load latest.log">
          {error}
        </Alert>
      )}

      {!preview && loading && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm">Reading latest.log…</Text>
        </Group>
      )}

      {preview && preview.summary.expmetricCount === 0 && !loading && (
        <Alert color="blue">
          No <Text span ff="monospace">[EXPMETRIC]</Text> lines found in the current{' '}
          <Text span ff="monospace">latest.log</Text>.
        </Alert>
      )}

      {preview && preview.summary.expmetricCount > 0 && (
        <>
          <Group gap="md" grow wrap="wrap">
            <KpiCard label="EXPMETRIC events" value={preview.summary.expmetricCount.toLocaleString()} />
            <KpiCard label="Joins" value={preview.summary.joins.toLocaleString()} />
            <KpiCard label="Leaves" value={preview.summary.leaves.toLocaleString()} />
            <KpiCard label="Discoveries" value={preview.summary.discoveries.toLocaleString()} />
            <KpiCard label="Unique players" value={preview.summary.uniquePlayers.toLocaleString()} />
            <KpiCard label="Currently online" value={preview.summary.currentlyOnline.length.toString()} />
          </Group>

          <Card withBorder padding="md">
            <Title order={4} mb="sm">
              Currently online
            </Title>
            {preview.summary.currentlyOnline.length === 0 ? (
              <Text size="sm" c="dimmed">
                No players online (last join/leave for every player was a leave).
              </Text>
            ) : (
              <Group gap="xs" wrap="wrap">
                {preview.summary.currentlyOnline.map((p) => (
                  <Badge key={p.uuid} variant="light" color="green" size="md">
                    {p.player} · since {p.since.slice(11, 19)}
                  </Badge>
                ))}
              </Group>
            )}
          </Card>

          <Card withBorder padding="md">
            <Group justify="space-between" mb="sm">
              <Title order={4}>Recent events</Title>
              <Badge variant="light" color="gray">
                showing {recent.length} of {preview.summary.expmetricCount}
              </Badge>
            </Group>
            <Stack gap={2}>
              {recent.map((ev) => (
                <Group key={`${ev.ts}-${ev.lineNo}`} gap="sm" wrap="nowrap">
                  <Text size="xs" c="dimmed" ff="monospace" style={{ width: 80 }}>
                    {ev.ts.slice(11, 19)}
                  </Text>
                  <Badge
                    variant="light"
                    color={
                      ev.type === 'join'
                        ? 'green'
                        : ev.type === 'leave'
                          ? 'orange'
                          : ev.entity
                            ? (ENTITY_COLORS[ev.entity] ?? 'blue')
                            : 'gray'
                    }
                    size="sm"
                  >
                    {ev.type}
                    {ev.entity ? ` · ${ev.entity}` : ''}
                  </Badge>
                  <Text size="sm" fw={500}>
                    {ev.player ?? '—'}
                  </Text>
                  {ev.region && (
                    <Text size="sm" c="dimmed" style={{ flex: 1 }} truncate>
                      {ev.region}
                    </Text>
                  )}
                  {ev.diff !== null && (
                    <Text size="xs" c="dimmed">
                      diff {ev.diff}
                    </Text>
                  )}
                </Group>
              ))}
            </Stack>
          </Card>
        </>
      )}
    </Stack>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder padding="md">
      <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase">
          {label}
        </Text>
        <Text size="xl" fw={700}>
          {value}
        </Text>
      </Stack>
    </Card>
  )
}
