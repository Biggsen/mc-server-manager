import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowClockwise,
  Cloud,
  Play,
  Stop,
} from '@phosphor-icons/react'
import {
  Badge,
  Code,
  Group,
  Loader,
  NativeSelect,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { Button } from '../components/ui'
import { ContentSection } from '../components/layout'
import {
  fetchTeledosiLogs,
  fetchTeledosiStatus,
  getTeledosiLogsStreamUrl,
  teledosiRestart,
  teledosiSendCommand,
  teledosiStart,
  teledosiStop,
  type TeledosiServiceState,
} from '../lib/api'

const LOG_AREA_HEIGHT = 520
const RECENT_LINES = 200
const LIVE_BUFFER_MAX_CHARS = 512_000
const JOURNAL_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}\s+\S+\s+java\[\d+\]:\s*/

function stateBadgeColor(state: TeledosiServiceState): string {
  if (state === 'running') return 'green'
  if (state === 'failed') return 'red'
  return 'gray'
}

function stateLabel(state: TeledosiServiceState): string {
  if (state === 'running') return 'Online'
  if (state === 'failed') return 'Failed'
  return 'Stopped'
}

function stripJournalPrefix(line: string): string {
  return line.replace(JOURNAL_PREFIX_RE, '')
}

function normalizeLogText(text: string): string {
  return text
    .split(/\r?\n/)
    .map(stripJournalPrefix)
    .join('\n')
}

function formatRconPrefix(): string {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `[${hh}:${mm}:${ss} RCON]`
}

type BroadcastType = 'general' | 'maintenance' | 'warning' | 'alert' | 'success'

function getBroadcastStyle(kind: BroadcastType): { prefix: string; prefixColor: string; messageColor: string } {
  if (kind === 'maintenance') return { prefix: '[Maintenance] ', prefixColor: 'gray', messageColor: 'gold' }
  if (kind === 'warning') return { prefix: '[Warning] ', prefixColor: 'gray', messageColor: 'yellow' }
  if (kind === 'alert') return { prefix: '[Alert] ', prefixColor: 'dark_red', messageColor: 'red' }
  if (kind === 'success') return { prefix: '[Server] ', prefixColor: 'gray', messageColor: 'green' }
  return { prefix: '[Server] ', prefixColor: 'gray', messageColor: 'white' }
}

function buildBroadcastTellraw(message: string, kind: BroadcastType): string {
  const style = getBroadcastStyle(kind)
  const payload = {
    text: style.prefix,
    color: style.prefixColor,
    extra: [
      {
        text: message,
        color: style.messageColor,
      },
    ],
  }
  return `tellraw @a ${JSON.stringify(payload)}`
}

export default function TeledosiServer() {
  const navigate = useNavigate()
  const [configured, setConfigured] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<TeledosiServiceState | null>(null)
  const [statusRaw, setStatusRaw] = useState<string>('')
  const [logText, setLogText] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(true)
  const [controlBusy, setControlBusy] = useState(false)
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandValue, setCommandValue] = useState('')
  const [broadcastBusy, setBroadcastBusy] = useState(false)
  const [broadcastValue, setBroadcastValue] = useState('')
  const [broadcastType, setBroadcastType] = useState<BroadcastType>('general')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [historyDraft, setHistoryDraft] = useState('')
  const [liveTail, setLiveTail] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const refreshSnapshot = useCallback(async () => {
    setLogsLoading(true)
    setLoadError(null)
    try {
      const [st, lg] = await Promise.all([
        fetchTeledosiStatus(),
        fetchTeledosiLogs(RECENT_LINES),
      ])
      setConfigured(true)
      setStatus(st.state)
      setStatusRaw(st.raw)
      setLogText(normalizeLogText(lg.text))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/503|not configured/i.test(msg)) {
        setConfigured(false)
        setLoadError(null)
      } else {
        setLoadError(msg)
      }
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSnapshot()
  }, [refreshSnapshot])

  useEffect(() => {
    scrollToBottom()
  }, [logText, scrollToBottom])

  useEffect(() => {
    if (!liveTail) {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      return
    }

    const url = getTeledosiLogsStreamUrl()
    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('log', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { line?: string }
        if (typeof data.line === 'string' && data.line.length > 0) {
          const line = stripJournalPrefix(data.line)
          setLogText((prev) => {
            const next: string = prev ? `${prev}\n${line}` : line
            if (next.length > LIVE_BUFFER_MAX_CHARS) {
              return next.slice(next.length - LIVE_BUFFER_MAX_CHARS)
            }
            return next
          })
        }
      } catch {
        /* ignore malformed chunks */
      }
    })

    es.addEventListener('streamerror', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { message?: string }
        if (data.message) {
          setLoadError(data.message)
        }
      } catch {
        /* ignore */
      }
      es.close()
      esRef.current = null
      setLiveTail(false)
    })

    es.onerror = () => {
      es.close()
      esRef.current = null
      setLiveTail(false)
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [liveTail])

  const runControl = async (action: 'start' | 'stop' | 'restart') => {
    setControlBusy(true)
    setLoadError(null)
    try {
      if (action === 'start') await teledosiStart()
      else if (action === 'stop') await teledosiStop()
      else await teledosiRestart()
      const st = await fetchTeledosiStatus()
      setStatus(st.state)
      setStatusRaw(st.raw)
      if (!liveTail) {
        const lg = await fetchTeledosiLogs(RECENT_LINES)
        setLogText(normalizeLogText(lg.text))
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setControlBusy(false)
    }
  }

  const runCommand = async () => {
    const command = commandValue.trim()
    if (!command) return
    setCommandBusy(true)
    setLoadError(null)
    try {
      const result = await teledosiSendCommand(command)
      const response = result.response?.trim()
      setLogText((prev) => {
        const lines = [`${formatRconPrefix()} > ${command}`]
        if (response) {
          lines.push(`${formatRconPrefix()} ${response}`)
        }
        const appended = lines.join('\n')
        const next: string = prev ? `${prev}\n${appended}` : appended
        if (next.length > LIVE_BUFFER_MAX_CHARS) {
          return next.slice(next.length - LIVE_BUFFER_MAX_CHARS)
        }
        return next
      })
      setCommandHistory((prev) => [...prev, command])
      setHistoryIndex(null)
      setHistoryDraft('')
      setCommandValue('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setCommandBusy(false)
    }
  }

  const runBroadcast = async () => {
    const message = broadcastValue.trim()
    if (!message) return
    const tellraw = buildBroadcastTellraw(message, broadcastType)
    setBroadcastBusy(true)
    setLoadError(null)
    try {
      const result = await teledosiSendCommand(tellraw)
      const response = result.response?.trim()
      const style = getBroadcastStyle(broadcastType)
      setLogText((prev) => {
        const lines = [`${formatRconPrefix()} ${style.prefix}${message}`]
        if (response) {
          lines.push(`${formatRconPrefix()} ${response}`)
        }
        const appended = lines.join('\n')
        const next: string = prev ? `${prev}\n${appended}` : appended
        if (next.length > LIVE_BUFFER_MAX_CHARS) {
          return next.slice(next.length - LIVE_BUFFER_MAX_CHARS)
        }
        return next
      })
      setBroadcastValue('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setBroadcastBusy(false)
    }
  }

  const handleCommandHistory = (direction: 'up' | 'down') => {
    if (commandHistory.length === 0) return

    if (direction === 'up') {
      if (historyIndex === null) {
        setHistoryDraft(commandValue)
        const next = commandHistory.length - 1
        setHistoryIndex(next)
        setCommandValue(commandHistory[next])
        return
      }
      const next = Math.max(0, historyIndex - 1)
      setHistoryIndex(next)
      setCommandValue(commandHistory[next])
      return
    }

    if (historyIndex === null) return
    if (historyIndex >= commandHistory.length - 1) {
      setHistoryIndex(null)
      setCommandValue(historyDraft)
      return
    }
    const next = historyIndex + 1
    setHistoryIndex(next)
    setCommandValue(commandHistory[next])
  }

  return (
    <Stack gap="xl" pb="xl">
      <ContentSection as="article" padding="xl">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Group gap="sm">
              <Cloud size={28} weight="duotone" aria-hidden />
              <Title order={2}>Teledosi Server</Title>
            </Group>
            {status && (
              <Badge size="lg" variant="light" color={stateBadgeColor(status)} tt="none">
                {stateLabel(status)}
              </Badge>
            )}
          </Group>
          {configured && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/teledosi/files')}
              styles={{ root: { alignSelf: 'flex-start', width: 'fit-content' } }}
            >
              Edit files
            </Button>
          )}
          {statusRaw && (
            <Text size="xs" c="dimmed" ff="monospace">
              systemctl: {statusRaw}
            </Text>
          )}
        </Stack>

        {!configured && (
          <Text mt="md" c="yellow.4" size="sm">
            Teledosi remote control is not configured on the backend. Set TELEDOSI_SSH_HOST,
            TELEDOSI_SSH_USER, and TELEDOSI_SSH_PASSWORD or a private key, then restart the
            backend. RCON commands also require TELEDOSI_RCON_WRAPPER_BIN (default: teledosi-rcon).
          </Text>
        )}

        {loadError && (
          <Text mt="md" c="red.4" size="sm">
            {loadError}
          </Text>
        )}

        {configured && (
          <>
            <Paper withBorder radius="md" p={0} mt="md" bg="dark.9">
              <div
                ref={scrollRef}
                style={{
                  height: LOG_AREA_HEIGHT,
                  overflow: 'auto',
                }}
              >
                <Code
                  block
                  component="pre"
                  p="md"
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    margin: 0,
                    minHeight: LOG_AREA_HEIGHT,
                  }}
                >
                  {logsLoading && !logText ? (
                    <Group gap="xs">
                      <Loader size="sm" />
                      <span>Loading logs…</span>
                    </Group>
                  ) : (
                    logText || 'No log lines yet.'
                  )}
                </Code>
              </div>
            </Paper>

            <Group justify="space-between" align="center" mt="md" wrap="wrap">
              <Switch
                label="Live tail (journalctl -f)"
                checked={liveTail}
                onChange={(e) => setLiveTail(e.currentTarget.checked)}
                disabled={!configured}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refreshSnapshot()}
                disabled={logsLoading || liveTail}
              >
                Refresh logs
              </Button>
            </Group>

            <Group align="flex-end" mt="md" wrap="nowrap">
              <TextInput
                label="Admin command"
                value={commandValue}
                onChange={(e) => {
                  setCommandValue(e.currentTarget.value)
                  if (historyIndex !== null) {
                    setHistoryIndex(null)
                    setHistoryDraft('')
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void runCommand()
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    handleCommandHistory('up')
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    handleCommandHistory('down')
                  }
                }}
                disabled={!configured || commandBusy}
                style={{ flex: 1 }}
              />
              <Button
                variant="primary"
                onClick={() => void runCommand()}
                disabled={!configured || commandBusy || !commandValue.trim()}
                loading={commandBusy}
              >
                Send
              </Button>
            </Group>

            <Group align="flex-end" mt="sm" wrap="nowrap">
              <NativeSelect
                label="Broadcast type"
                value={broadcastType}
                onChange={(e) => setBroadcastType(e.currentTarget.value as BroadcastType)}
                data={[
                  { value: 'general', label: 'General' },
                  { value: 'maintenance', label: 'Maintenance' },
                  { value: 'warning', label: 'Warning' },
                  { value: 'alert', label: 'Alert' },
                  { value: 'success', label: 'Success' },
                ]}
                disabled={!configured || broadcastBusy}
                style={{ width: 180 }}
              />
              <TextInput
                label="Broadcast message"
                value={broadcastValue}
                onChange={(e) => setBroadcastValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void runBroadcast()
                  }
                }}
                disabled={!configured || broadcastBusy}
                style={{ flex: 1 }}
              />
              <Button
                variant="secondary"
                onClick={() => void runBroadcast()}
                disabled={!configured || broadcastBusy || !broadcastValue.trim()}
                loading={broadcastBusy}
              >
                Broadcast
              </Button>
            </Group>

            <Group justify="flex-end" gap="sm" mt="lg" wrap="wrap">
              <Button
                variant="primary"
                color="green"
                icon={<Play size={18} weight="fill" />}
                onClick={() => void runControl('start')}
                disabled={controlBusy || !configured}
                loading={controlBusy}
              >
                Start
              </Button>
              <Button
                variant="danger"
                icon={<Stop size={18} weight="fill" />}
                onClick={() => void runControl('stop')}
                disabled={controlBusy || !configured}
                loading={controlBusy}
              >
                Stop
              </Button>
              <Button
                variant="secondary"
                icon={<ArrowClockwise size={18} weight="bold" />}
                onClick={() => void runControl('restart')}
                disabled={controlBusy || !configured}
                loading={controlBusy}
              >
                Restart
              </Button>
            </Group>
          </>
        )}
      </ContentSection>
    </Stack>
  )
}
