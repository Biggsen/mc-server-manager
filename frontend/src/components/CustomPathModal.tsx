import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { Stack, Group, TextInput, NativeSelect } from '@mantine/core'
import { FloppyDisk, Plus } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { Modal } from './ui/modal'
import { useToast } from './ui/toast'
import type { PluginConfigRequirement } from '../lib/api'

export interface CustomPathModalState {
  opened: boolean
  pluginId: string
  definitionId?: string
  label: string
  path: string
  requirement: PluginConfigRequirement
  notes: string
}

interface CustomPathModalProps {
  modal: CustomPathModalState | null
  onClose: () => void
  onSubmit: (data: Omit<CustomPathModalState, 'opened'>) => Promise<void>
}

export function CustomPathModal({ modal, onClose, onSubmit }: CustomPathModalProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [formState, setFormState] = useState<Omit<CustomPathModalState, 'opened'> | null>(null)
  const lastOpenedRef = useRef(false)

  // Memoize the modal title to avoid recalculating on every keystroke
  const modalTitle = useMemo(
    () => (modal?.definitionId ? 'Edit Custom Config Path' : 'Add Custom Config Path'),
    [modal?.definitionId],
  )

  // Update form state only when modal opens/closes, not on every keystroke
  useEffect(() => {
    const isOpened = modal?.opened ?? false
    if (isOpened && !lastOpenedRef.current && modal) {
      // Only initialize form state when modal first opens
      setFormState({
        pluginId: modal.pluginId,
        definitionId: modal.definitionId,
        label: modal.label,
        path: modal.path,
        requirement: modal.requirement,
        notes: modal.notes,
      })
      lastOpenedRef.current = true
    } else if (!isOpened && lastOpenedRef.current) {
      // Clear form state when modal closes
      setFormState(null)
      lastOpenedRef.current = false
    }
  }, [modal?.opened, modal]) // Depend on opened state and modal object

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!formState) return
    if (!formState.path.trim()) {
      toast({
        title: 'Path required',
        description: 'Config path is required.',
        variant: 'danger',
      })
      return
    }
    setSaving(true)
    try {
      await onSubmit(formState)
      onClose()
    } catch (err) {
      // Error handling is done in the parent
    } finally {
      setSaving(false)
    }
  }

  if (!modal?.opened || !formState) {
    return null
  }

  return (
    <Modal opened={modal.opened} onClose={onClose} title={modalTitle} size="md" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Label"
            id="custom-path-label"
            value={formState.label}
            onChange={(event) =>
              setFormState((prev) => (prev ? { ...prev, label: event.target.value } : null))
            }
            placeholder="My Custom Config"
            disabled={saving}
          />
          <TextInput
            label="Path"
            id="custom-path-path"
            value={formState.path}
            onChange={(event) =>
              setFormState((prev) => (prev ? { ...prev, path: event.target.value } : null))
            }
            placeholder="plugins/example/config.yml"
            required
            disabled={saving}
          />
          <NativeSelect
            label="Requirement"
            id="custom-path-requirement"
            value={formState.requirement}
            onChange={(event) =>
              setFormState((prev) =>
                prev ? { ...prev, requirement: event.target.value as PluginConfigRequirement } : null,
              )
            }
            data={[
              { value: 'required', label: 'Required' },
              { value: 'optional', label: 'Optional' },
              { value: 'generated', label: 'Generated' },
            ]}
            disabled={saving}
          />
          <TextInput
            label="Notes"
            id="custom-path-notes"
            value={formState.notes}
            onChange={(event) =>
              setFormState((prev) => (prev ? { ...prev, notes: event.target.value } : null))
            }
            placeholder="Optional notes"
            disabled={saving}
          />
          <Group justify="flex-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              icon={
                formState.definitionId ? (
                  <FloppyDisk size={18} weight="fill" aria-hidden="true" />
                ) : (
                  <Plus size={18} weight="fill" aria-hidden="true" />
                )
              }
            >
              {saving ? 'Saving…' : formState.definitionId ? 'Update' : 'Add'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

