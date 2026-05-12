import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Card,
  Group,
  Loader,
  NativeSelect,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { BarChart, DonutChart } from '@mantine/charts'
import { Button } from '../../components/ui'
import {
  fetchDiscoveriesByEntity,
  fetchMetricsRange,
  fetchOverviewActivity,
  fetchOverviewKpis,
  fetchOverviewPlayers,
  fetchTopRegions,
  type ActivityRow,
  type DiscoveriesByEntityRow,
  type MetricsRange,
  type OverviewKpis,
  type OverviewPlayerRow,
  type TopRegionRow,
} from '../../lib/api'

type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all' | 'custom'

const PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${dd}T${hh}:${mm}:${ss}`
}

function presetToRange(
  preset: RangePreset,
  range: MetricsRange | null,
): { from: string; to: string } {
  const now = new Date()
  const todayStart = startOfDay(now)
  if (preset === 'today') {
    const tomorrow = new Date(todayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return { from: isoLocal(todayStart), to: isoLocal(tomorrow) }
  }
  if (preset === 'yesterday') {
    const y = new Date(todayStart)
    y.setDate(y.getDate() - 1)
    return { from: isoLocal(y), to: isoLocal(todayStart) }
  }
  if (preset === '7d') {
    const f = new Date(todayStart)
    f.setDate(f.getDate() - 6)
    const tomorrow = new Date(todayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return { from: isoLocal(f), to: isoLocal(tomorrow) }
  }
  if (preset === '30d') {
    const f = new Date(todayStart)
    f.setDate(f.getDate() - 29)
    const tomorrow = new Date(todayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return { from: isoLocal(f), to: isoLocal(tomorrow) }
  }
  if (preset === 'month') {
    const f = new Date(now.getFullYear(), now.getMonth(), 1)
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { from: isoLocal(f), to: isoLocal(next) }
  }
  return {
    from: range?.earliestTs ?? '0000-01-01T00:00:00',
    to: '9999-12-31T23:59:59',
  }
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 48) return remMins ? `${hours}h ${remMins}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours ? `${days}d ${remHours}h` : `${days}d`
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.replace('T', ' ')
}

function shortDate(bucket: string): string {
  if (bucket.length === 13) return `${bucket.slice(5, 10)} ${bucket.slice(11, 13)}h`
  if (bucket.length === 10) return bucket.slice(5)
  return bucket
}

const ENTITY_COLORS: Record<string, string> = {
  region: 'blue.6',
  structure: 'violet.6',
  village: 'teal.6',
  heart: 'pink.6',
}

export interface OverviewTabProps {
  serverId: string
  onPickPlayer: (player: string) => void
}

export default function OverviewTab({ serverId, onPickPlayer }: OverviewTabProps) {
  const [range, setRange] = useState<MetricsRange | null>(null)
  const [rangeLoading, setRangeLoading] = useState(true)
  const [preset, setPreset] = useState<RangePreset>('7d')

  const [kpis, setKpis] = useState<OverviewKpis | null>(null)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [activityBucket, setActivityBucket] = useState<'day' | 'hour'>('day')
  const [players, setPlayers] = useState<OverviewPlayerRow[]>([])
  const [byEntity, setByEntity] = useState<DiscoveriesByEntityRow[]>([])
  const [topRegions, setTopRegions] = useState<TopRegionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRangeLoading(true)
    fetchMetricsRange(serverId)
      .then((r) => {
        if (cancelled) return
        setRange(r)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serverId])

  const { from, to } = useMemo(() => presetToRange(preset, range), [preset, range])
  const bucket: 'day' | 'hour' = useMemo(() => {
    const fromMs = Date.parse(from)
    const toMs = Date.parse(to)
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs - fromMs <= 48 * 3600 * 1000) {
      return 'hour'
    }
    return 'day'
  }, [from, to])

  useEffect(() => {
    setActivityBucket(bucket)
  }, [bucket])

  const refresh = useCallback(async () => {
    if (rangeLoading) return
    setLoading(true)
    setError(null)
    try {
      const [k, a, p, e, t] = await Promise.all([
        fetchOverviewKpis(serverId, from, to),
        fetchOverviewActivity(serverId, bucket, from, to),
        fetchOverviewPlayers(serverId, from, to),
        fetchDiscoveriesByEntity(serverId, from, to),
        fetchTopRegions(serverId, 10, from, to),
      ])
      setKpis(k)
      setActivity(a.rows)
      setPlayers(p.rows)
      setByEntity(e.rows)
      setTopRegions(t.rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [serverId, from, to, bucket, rangeLoading])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (rangeLoading) {
    return (
      <Group gap="xs">
        <Loader size="sm" />
        <Text size="sm">Loading overview…</Text>
      </Group>
    )
  }

  if (range && range.totalEvents === 0) {
    return (
      <Alert color="blue" title="No imported data yet">
        Ingest one or more `.log.gz` files in the Files tab, then come back to see analytics.
      </Alert>
    )
  }

  const activityData = activity.map((r) => ({
    bucket: shortDate(r.bucket),
    Joins: r.joins,
    Leaves: r.leaves,
    Discoveries: r.discoveries,
  }))

  const donutData = byEntity.map((r) => ({
    name: r.entity,
    value: r.count,
    color: ENTITY_COLORS[r.entity] ?? 'gray.6',
  }))

  const topRegionsData = topRegions.map((r) => ({
    region: r.region,
    Discoveries: r.discoveries,
  }))

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="md" align="flex-end">
          <NativeSelect
            label="Date range"
            value={preset}
            onChange={(e) => setPreset(e.currentTarget.value as RangePreset)}
            data={PRESET_OPTIONS}
            style={{ minWidth: 180 }}
          />
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              From {formatTs(from)}
            </Text>
            <Text size="xs" c="dimmed">
              To {formatTs(to)}
            </Text>
          </Stack>
        </Group>
        <Group gap="sm">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Failed to load metrics">
          {error}
        </Alert>
      )}

      {kpis && (
        <Group gap="md" grow wrap="wrap">
          <KpiCard label="Unique players" value={kpis.uniquePlayers.toLocaleString()} />
          <KpiCard label="Sessions" value={kpis.totalSessions.toLocaleString()} />
          <KpiCard label="Joins" value={kpis.totalJoins.toLocaleString()} />
          <KpiCard label="Discoveries" value={kpis.totalDiscoveries.toLocaleString()} />
          <KpiCard label="Play time" value={formatMinutes(kpis.totalPlayMinutes)} />
          <KpiCard label="Days active" value={kpis.daysActive.toLocaleString()} />
        </Group>
      )}

      <Card withBorder padding="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Activity by {activityBucket}</Title>
          <Badge variant="light" color="gray">
            {activity.length} {activityBucket}s
          </Badge>
        </Group>
        {activityData.length === 0 ? (
          <Text size="sm" c="dimmed">
            No events in this window.
          </Text>
        ) : (
          <Box style={{ height: 240 }}>
            <BarChart
              h={240}
              data={activityData}
              dataKey="bucket"
              type="stacked"
              series={[
                { name: 'Joins', color: 'green.6' },
                { name: 'Leaves', color: 'orange.6' },
                { name: 'Discoveries', color: 'blue.6' },
              ]}
              tickLine="y"
              gridAxis="y"
              withTooltip
            />
          </Box>
        )}
      </Card>

      <Group gap="md" align="stretch" grow>
        <Card withBorder padding="md">
          <Title order={4} mb="sm">
            Discoveries by entity
          </Title>
          {donutData.length === 0 ? (
            <Text size="sm" c="dimmed">
              No discoveries in this window.
            </Text>
          ) : (
            <Group justify="center">
              <DonutChart data={donutData} withLabels withTooltip size={180} thickness={28} />
            </Group>
          )}
        </Card>
        <Card withBorder padding="md">
          <Title order={4} mb="sm">
            Top regions
          </Title>
          {topRegionsData.length === 0 ? (
            <Text size="sm" c="dimmed">
              No region discoveries in this window.
            </Text>
          ) : (
            (() => {
              const chartHeight = Math.max(180, topRegionsData.length * 32 + 40)
              return (
                <Box style={{ height: chartHeight }}>
                  <BarChart
                    h={chartHeight}
                    data={topRegionsData}
                    dataKey="region"
                    orientation="vertical"
                    yAxisProps={{ width: 140, interval: 0 }}
                    series={[{ name: 'Discoveries', color: 'blue.6' }]}
                    tickLine="x"
                    gridAxis="x"
                    withTooltip
                  />
                </Box>
              )
            })()
          )}
        </Card>
      </Group>

      <Card withBorder padding="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Players</Title>
          <Badge variant="light" color="gray">
            {players.length}
          </Badge>
        </Group>
        {players.length === 0 ? (
          <Text size="sm" c="dimmed">
            No player activity in this window.
          </Text>
        ) : (
          <Table withTableBorder striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Player</Table.Th>
                <Table.Th>Sessions</Table.Th>
                <Table.Th>Play time</Table.Th>
                <Table.Th>Joins</Table.Th>
                <Table.Th>Discoveries</Table.Th>
                <Table.Th>Last seen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {players.map((p) => (
                <Table.Tr
                  key={p.uuid}
                  onClick={() => onPickPlayer(p.player)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {p.player}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {p.uuid}
                    </Text>
                  </Table.Td>
                  <Table.Td>{p.sessions}</Table.Td>
                  <Table.Td>{formatMinutes(p.playMinutes)}</Table.Td>
                  <Table.Td>{p.joins}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <DiscoveryChip color="blue" label="R" count={p.discoveriesByEntity.region} />
                      <DiscoveryChip
                        color="violet"
                        label="S"
                        count={p.discoveriesByEntity.structure}
                      />
                      <DiscoveryChip color="teal" label="V" count={p.discoveriesByEntity.village} />
                      <DiscoveryChip color="pink" label="H" count={p.discoveriesByEntity.heart} />
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatTs(p.lastSeen)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
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

function DiscoveryChip({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: 'blue' | 'violet' | 'teal' | 'pink'
}) {
  if (count === 0) {
    return (
      <Badge variant="default" size="sm" radius="sm">
        {label} 0
      </Badge>
    )
  }
  return (
    <Badge variant="light" color={color} size="sm" radius="sm">
      {label} {count}
    </Badge>
  )
}
