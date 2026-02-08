import type { FormEvent } from 'react'
import { Code, Group, ScrollArea, Stack, Text, TextInput } from '@mantine/core'
import { Button } from './ui'
import type { RunJob, RunLogEntry } from '../lib/api'

function formatLogLine(entry: RunLogEntry): string {
  return `[${new Date(entry.timestamp).toLocaleTimeString()}][${entry.stream}] ${entry.message}`
}

export interface RunLogsAndConsoleProps {
  run: Pick<RunJob, 'id' | 'logs' | 'status' | 'consoleAvailable'>
  registerLogRef: (runId: string, element: HTMLDivElement | null) => void
  commandValue: string
  onCommandChange: (value: string) => void
  onSubmit: () => void
  onSendCommand: (command: string) => void
  commandBusy: boolean
}

export function RunLogsAndConsole({
  run,
  registerLogRef,
  commandValue,
  onCommandChange,
  onSubmit,
  onSendCommand,
  commandBusy,
}: RunLogsAndConsoleProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Stack gap="md">
      <ScrollArea h={200} type="auto">
        <div
          ref={(element) => registerLogRef(run.id, element)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            minHeight: '200px',
          }}
        >
          <Code
            block
            component="pre"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}
          >
            {run.logs.length > 0
              ? run.logs.map(formatLogLine).join('\n')
              : 'No log entries yet.'}
          </Code>
        </div>
      </ScrollArea>

      {run.status === 'running' ? (
        run.consoleAvailable ? (
          <Stack gap="sm">
            <Group
              component="form"
              align="flex-end"
              onSubmit={handleSubmit}
            >
              <TextInput
                label="Console command"
                placeholder="/say Hello"
                value={commandValue}
                onChange={(event) => onCommandChange(event.currentTarget.value)}
                disabled={commandBusy}
                flex={1}
              />
              <Button
                type="submit"
                disabled={commandBusy || !commandValue.trim()}
              >
                {commandBusy ? 'Sending…' : 'Send'}
              </Button>
            </Group>
            <Group align="flex-start">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={commandBusy}
                onClick={() => onSendCommand('/op verzion')}
              >
                op verzion
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed" size="sm">
            Console not available yet.
          </Text>
        )
      ) : null}
    </Stack>
  )
}
