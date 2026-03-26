import { useEffect, useState } from 'react'
import { Group, Stack, TextInput } from '@mantine/core'
import { updateProject, type ProjectSummary } from '../lib/api'
import { Button } from './ui/button'
import { Modal } from './ui/modal'
import { useToast } from './ui/toast'

type RenameProjectModalProps = {
  project: ProjectSummary | null
  opened: boolean
  onClose: () => void
}

export function RenameProjectModal({ project, opened, onClose }: RenameProjectModalProps) {
  const { toast } = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (opened && project) {
      setValue(project.name)
    }
  }, [opened, project?.id, project?.name])

  if (!project) {
    return null
  }

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      toast({ variant: 'danger', description: 'Name cannot be empty' })
      return
    }
    setBusy(true)
    try {
      await updateProject(project.id, { name: trimmed })
      onClose()
      toast({ variant: 'success', description: 'Project renamed' })
    } catch (err) {
      toast({
        variant: 'danger',
        description: err instanceof Error ? err.message : 'Failed to rename project',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened={opened} onClose={() => !busy && onClose()} title="Rename project" size="sm" centered>
      <Stack gap="md">
        <TextInput
          label="Display name"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          disabled={busy}
          autoComplete="off"
          autoFocus
        />
        <Group justify="flex-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={busy} onClick={() => void handleSave()}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
