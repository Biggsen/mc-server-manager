import { Books, HouseLine } from '@phosphor-icons/react'
import { Stack, Text } from '@mantine/core'
import { Button } from './ui/button'
import { Modal } from './ui/modal'

export interface AddConfigPathChoicePayload {
  pluginId: string
  path: string
  labelSuggestion: string
}

interface AddConfigPathChoiceModalProps {
  payload: AddConfigPathChoicePayload | null
  onClose: () => void
  onChooseCustom: (payload: AddConfigPathChoicePayload) => void
  onChooseLibrary: (payload: AddConfigPathChoicePayload) => void
  libraryBusy: boolean
}

export function AddConfigPathChoiceModal({
  payload,
  onClose,
  onChooseCustom,
  onChooseLibrary,
  libraryBusy,
}: AddConfigPathChoiceModalProps) {
  const opened = payload !== null

  return (
    <Modal opened={opened} onClose={onClose} title="Add as config path" size="md" centered>
      {payload && (
        <Stack gap="md">
          <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
            {payload.path}
          </Text>
          <Stack gap="xs">
            <Button
              type="button"
              variant="secondary"
              style={{ width: '100%', height: 'auto', padding: '12px 14px' }}
              styles={{
                root: { whiteSpace: 'normal' },
                inner: { alignItems: 'flex-start', justifyContent: 'flex-start' },
                label: { flex: 1, minWidth: 0, whiteSpace: 'normal', textAlign: 'left' },
              }}
              disabled={libraryBusy}
              icon={<HouseLine size={20} weight="fill" aria-hidden="true" />}
              onClick={() => onChooseCustom(payload)}
            >
              <Stack gap={4} align="flex-start" w="100%" style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  Custom project config
                </Text>
                <Text size="xs" c="dimmed" style={{ fontWeight: 400, whiteSpace: 'normal' }}>
                  Track this file only on this project. You can edit the label before saving.
                </Text>
              </Stack>
            </Button>
            <Button
              type="button"
              variant="secondary"
              style={{ width: '100%', height: 'auto', padding: '12px 14px' }}
              styles={{
                root: { whiteSpace: 'normal' },
                inner: { alignItems: 'flex-start', justifyContent: 'flex-start' },
                label: { flex: 1, minWidth: 0, whiteSpace: 'normal', textAlign: 'left' },
              }}
              loading={libraryBusy}
              disabled={libraryBusy}
              icon={<Books size={20} weight="fill" aria-hidden="true" />}
              onClick={() => onChooseLibrary(payload)}
            >
              <Stack gap={4} align="flex-start" w="100%" style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  Library template
                </Text>
                <Text size="xs" c="dimmed" style={{ fontWeight: 400, whiteSpace: 'normal' }}>
                  Add this path to the plugin in your library (for all projects), then link it here.
                </Text>
              </Stack>
            </Button>
          </Stack>
          <Button type="button" variant="ghost" onClick={onClose} disabled={libraryBusy} style={{ alignSelf: 'flex-end' }}>
            Cancel
          </Button>
        </Stack>
      )}
    </Modal>
  )
}
