import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Badge,
  Box,
  Card,
  Chip,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { LineChart } from '@mantine/charts'
import { Button } from '../../components/ui'
import {
  fetchPlayerCounters,
  fetchPlayerDiscoveries,
  fetchPlayerSessions,
  fetchPlayerStateSeries,
  fetchPlayerSummary,
  fetchPlayersList,
  type PlayerDiscoveryRow,
  type PlayerSessionRow,
  type PlayerStateSeriesRow,
  type PlayerSummary,
} from '../../lib/api'

export interface PlayerTabProps {
  serverId: string
  initialPlayer: string | null
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return '—'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 48) return m ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.replace('T', ' ')
}

function bucketByDay(items: { ts: string }[]): Map<string, { ts: string }[]> {
  const out = new Map<string, { ts: string }[]>()
  for (const it of items) {
    const day = it.ts.slice(0, 10)
    const bucket = out.get(day) ?? []
    bucket.push(it)
    out.set(day, bucket)
  }
  return out
}

const ENTITY_COLORS: Record<string, string> = {
  region: 'blue',
  structure: 'violet',
  village: 'teal',
  heart: 'pink',
}

export default function PlayerTab({ serverId, initialPlayer }: PlayerTabProps) {
  const [pickerValue, setPickerValue] = useState(initialPlayer ?? '')
  const [activePlayer, setActivePlayer] = useState<string | null>(initialPlayer)
  const [suggestions, setSuggestions] = useState<string[]>([])

  const [summary, setSummary] = useState<PlayerSummary | null>(null)
  const [sessions, setSessions] = useState<PlayerSessionRow[]>([])
  const [discoveries, setDiscoveries] = useState<PlayerDiscoveryRow[]>([])
  const [counters, setCounters] = useState<string[]>([])
  const [selectedCounters, setSelectedCounters] = useState<string[]>([])
  const [series, setSeries] = useState<Record<string, PlayerStateSeriesRow[]>>({})

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState<string | null>(null)

  useEffect(() => {
    setActivePlayer(initialPlayer)
    setPickerValue(initialPlayer ?? '')
  }, [initialPlayer])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      fetchPlayersList(serverId, pickerValue, 20)
        .then((r) => {
          if (cancelled) return
          setSuggestions(r.rows.map((row) => row.player))
        })
        .catch(() => {
          if (cancelled) return
          setSuggestions([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [serverId, pickerValue])

  const loadPlayer = useCallback(
    async (player: string) => {
      setLoading(true)
      setError(null)
      try {
        const [s, sess, disc, cnts] = await Promise.all([
          fetchPlayerSummary(serverId, player),
          fetchPlayerSessions(serverId, player),
          fetchPlayerDiscoveries(serverId, player, undefined, undefined, 500),
          fetchPlayerCounters(serverId, player),
        ])
        setSummary(s)
        setSessions(sess.rows)
        setDiscoveries(disc.rows)
        setCounters(cnts.counters)
        const defaults = cnts.counters
          .filter((c) => ['regions', 'villages', 'hearts', 'structures_found'].includes(c))
          .slice(0, 4)
        setSelectedCounters(defaults.length > 0 ? defaults : cnts.counters.slice(0, 1))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [serverId],
  )

  useEffect(() => {
    if (activePlayer) {
      void loadPlayer(activePlayer)
    } else {
      setSummary(null)
      setSessions([])
      setDiscoveries([])
      setCounters([])
      setSelectedCounters([])
      setSeries({})
    }
  }, [activePlayer, loadPlayer])

  useEffect(() => {
    if (!activePlayer || selectedCounters.length === 0) {
      setSeries({})
      return
    }
    let cancelled = false
    const player = activePlayer
    Promise.all(
      selectedCounters.map((c) =>
        fetchPlayerStateSeries(serverId, player, c).then((r) => [c, r.rows] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return
        const next: Record<string, PlayerStateSeriesRow[]> = {}
        for (const [c, rows] of entries) next[c] = rows
        setSeries(next)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [serverId, activePlayer, selectedCounters])

  const seriesData = useMemo(() => {
    const tsSet = new Set<string>()
    for (const rows of Object.values(series)) for (const r of rows) tsSet.add(r.ts)
    const tss = [...tsSet].sort()
    return tss.map((ts) => {
      const point: Record<string, number | string> = { ts: ts.replace('T', ' ').slice(5, 16) }
      for (const c of selectedCounters) {
        const row = series[c]?.find((r) => r.ts === ts)
        if (row) point[c] = row.value
      }
      return point
    })
  }, [series, selectedCounters])

  const filteredDiscoveries = useMemo(
    () => (entityFilter ? discoveries.filter((d) => d.entity === entityFilter) : discoveries),
    [discoveries, entityFilter],
  )

  const discoveriesByDay = useMemo(
    () => bucketByDay(filteredDiscoveries),
    [filteredDiscoveries],
  )

  const handlePick = (value: string) => {
    setPickerValue(value)
    if (value.length > 0) {
      setActivePlayer(value)
    }
  }

  const seriesColors: Record<string, string> = {
    regions: 'blue.6',
    villages: 'teal.6',
    hearts: 'pink.6',
    structures_found: 'violet.6',
    total: 'gray.6',
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Autocomplete
          label="Player"
          placeholder="Search by name…"
          data={suggestions}
          value={pickerValue}
          onChange={setPickerValue}
          onOptionSubmit={handlePick}
          style={{ minWidth: 280 }}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            if (pickerValue.trim().length > 0) setActivePlayer(pickerValue.trim())
          }}
          disabled={pickerValue.trim().length === 0}
        >
          Show
        </Button>
      </Group>

      {!activePlayer && (
        <Alert color="blue">Pick a player to see their full history.</Alert>
      )}

      {error && (
        <Alert color="red" title="Failed to load player data">
          {error}
        </Alert>
      )}

      {activePlayer && loading && !summary && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm">Loading {activePlayer}…</Text>
        </Group>
      )}

      {summary && (
        <Card withBorder padding="md">
          <Group justify="space-between" wrap="wrap">
            <Stack gap={2}>
              <Title order={3}>{summary.player}</Title>
              <Text size="xs" c="dimmed" ff="monospace">
                {summary.uuid}
              </Text>
            </Stack>
            <Group gap="lg">
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  First seen
                </Text>
                <Text size="sm">{formatTs(summary.firstSeen)}</Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  Last seen
                </Text>
                <Text size="sm">{formatTs(summary.lastSeen)}</Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  Sessions
                </Text>
                <Text size="sm" fw={600}>
                  {summary.totalSessions}
                </Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  Play time
                </Text>
                <Text size="sm" fw={600}>
                  {formatMinutes(summary.totalPlayMinutes)}
                </Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  Discoveries
                </Text>
                <Text size="sm" fw={600}>
                  {summary.totalDiscoveries}
                </Text>
              </Stack>
            </Group>
          </Group>
          {Object.keys(summary.latestState).length > 0 && (
            <>
              <Text size="xs" c="dimmed" mt="md" tt="uppercase">
                Latest state
              </Text>
              <Group gap="xs" mt={4} wrap="wrap">
                {Object.entries(summary.latestState)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => (
                    <Badge key={k} variant="light" color="gray">
                      {k}: {v}
                    </Badge>
                  ))}
              </Group>
            </>
          )}
        </Card>
      )}

      {summary && counters.length > 0 && (
        <Card withBorder padding="md">
          <Group justify="space-between" mb="sm">
            <Title order={4}>State progression</Title>
            <Text size="xs" c="dimmed">
              {seriesData.length} sample{seriesData.length === 1 ? '' : 's'}
            </Text>
          </Group>
          <Chip.Group multiple value={selectedCounters} onChange={setSelectedCounters}>
            <Group gap="xs" wrap="wrap" mb="md">
              {counters.map((c) => (
                <Chip key={c} value={c} size="xs">
                  {c}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          {seriesData.length === 0 || selectedCounters.length === 0 ? (
            <Text size="sm" c="dimmed">
              Pick one or more counters above.
            </Text>
          ) : (
            <Box style={{ height: 260 }}>
              <LineChart
                h={260}
                data={seriesData}
                dataKey="ts"
                series={selectedCounters.map((c) => ({
                  name: c,
                  color: seriesColors[c] ?? 'orange.6',
                }))}
                curveType="stepAfter"
                withTooltip
                withDots
              />
            </Box>
          )}
        </Card>
      )}

      {summary && (
        <Card withBorder padding="md">
          <Group justify="space-between" mb="sm">
            <Title order={4}>Sessions</Title>
            <Badge variant="light" color="gray">
              {sessions.length}
            </Badge>
          </Group>
          {sessions.length === 0 ? (
            <Text size="sm" c="dimmed">
              No paired join/leave events.
            </Text>
          ) : (
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Joined</Table.Th>
                  <Table.Th>Left</Table.Th>
                  <Table.Th>Duration</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sessions.map((s, i) => (
                  <Table.Tr key={`${s.joinTs}-${i}`}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {formatTs(s.joinTs)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {s.leaveTs ? (
                        <Text size="sm" ff="monospace">
                          {formatTs(s.leaveTs)}
                        </Text>
                      ) : (
                        <Badge color="green" variant="light" size="sm">
                          Open / unmatched
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatMinutes(s.durationMinutes)}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      )}

      {summary && (
        <Card withBorder padding="md">
          <Group justify="space-between" mb="sm">
            <Title order={4}>Discovery feed</Title>
            <Group gap="xs">
              <Chip
                size="xs"
                variant={entityFilter === null ? 'filled' : 'outline'}
                checked={entityFilter === null}
                onChange={() => setEntityFilter(null)}
              >
                All
              </Chip>
              {(['region', 'structure', 'village', 'heart'] as const).map((e) => (
                <Chip
                  key={e}
                  size="xs"
                  color={ENTITY_COLORS[e]}
                  variant={entityFilter === e ? 'filled' : 'outline'}
                  checked={entityFilter === e}
                  onChange={() => setEntityFilter(entityFilter === e ? null : e)}
                >
                  {e}
                </Chip>
              ))}
            </Group>
          </Group>
          {filteredDiscoveries.length === 0 ? (
            <Text size="sm" c="dimmed">
              No discoveries.
            </Text>
          ) : (
            <Stack gap="md">
              {[...discoveriesByDay.entries()].map(([day, items]) => (
                <Stack key={day} gap={4}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    {day}
                  </Text>
                  <Stack gap={2}>
                    {items.map((it, i) => {
                      const d = it as PlayerDiscoveryRow
                      return (
                        <Group key={`${d.ts}-${i}`} gap="sm" wrap="nowrap">
                          <Text size="xs" c="dimmed" ff="monospace" style={{ width: 70 }}>
                            {d.ts.slice(11, 19)}
                          </Text>
                          {d.entity && (
                            <Badge
                              variant="light"
                              color={ENTITY_COLORS[d.entity] ?? 'gray'}
                              size="sm"
                            >
                              {d.entity}
                            </Badge>
                          )}
                          <Text size="sm" style={{ flex: 1 }}>
                            {d.region ?? '—'}
                          </Text>
                          {d.diff !== null && (
                            <Text size="xs" c="dimmed">
                              diff {d.diff}
                            </Text>
                          )}
                        </Group>
                      )
                    })}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )}
        </Card>
      )}
    </Stack>
  )
}
