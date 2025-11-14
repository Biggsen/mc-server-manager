import { Loader, Badge, Group, Text } from '@mantine/core'
import { useActiveAsyncActions } from '../../lib/asyncActionsContext'

export function ActiveActionIndicator() {
  const activeActions = useActiveAsyncActions()
  const activeCount = activeActions.length
  const latest = activeCount > 0 ? activeActions[activeCount - 1] : null

  const label = latest?.label ?? 'Idle'
  const statusLabel =
    activeCount === 0
      ? 'No active actions'
      : activeCount === 1
        ? `1 action in progress: ${label}`
        : `${activeCount} actions in progress. Latest: ${label}`

  return (
    <Group
      gap="xs"
      align="center"
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
      px="sm"
      py={4}
      bg={activeCount > 0 ? 'blue.9' : 'dark.6'}
      bd="1px solid var(--mantine-color-dark-5)"
      style={{ borderRadius: 'var(--mantine-radius-md)' }}
    >
      <Loader size="sm" color={activeCount > 0 ? 'blue' : 'gray'} type="oval" />
      <Text size="sm" fw={500}>
        {label}
      </Text>
      {activeCount > 1 ? (
        <Badge size="xs" variant="filled" color="blue">
          +{activeCount - 1}
        </Badge>
      ) : null}
    </Group>
  )
}
