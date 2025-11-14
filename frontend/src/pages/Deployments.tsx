import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  fetchDeploymentTargets,
  createDeploymentTarget,
  type DeploymentTarget,
  type DeploymentType,
} from '../lib/api'
import { Alert, Grid, Group, Loader, NativeSelect, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { Button, Card, CardContent } from '../components/ui'

type FormState = {
  name: string
  type: DeploymentType
  notes: string
  path: string
  host: string
  port: string
  username: string
  remotePath: string
}

const INITIAL_FORM: FormState = {
  name: '',
  type: 'folder',
  notes: '',
  path: '',
  host: '',
  port: '22',
  username: '',
  remotePath: '',
}

function Deployments() {
  const [targets, setTargets] = useState<DeploymentTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const items = await fetchDeploymentTargets()
        if (cancelled) return
        setTargets(items)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const folderTargets = useMemo(
    () => targets.filter((target) => target.type === 'folder'),
    [targets],
  )
  const sftpTargets = useMemo(
    () => targets.filter((target) => target.type === 'sftp'),
    [targets],
  )

  const resetForm = () => {
    setForm(INITIAL_FORM)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)

    try {
      setSaving(true)
      if (!form.name.trim()) {
        setMessage('Name is required.')
        return
      }
      if (form.type === 'folder' && !form.path.trim()) {
        setMessage('Folder path is required.')
        return
      }
      if (form.type === 'sftp' && (!form.host.trim() || !form.username.trim() || !form.remotePath.trim())) {
        setMessage('SFTP host, username, and remote path are required.')
        return
      }

      const target = await createDeploymentTarget({
        name: form.name.trim(),
        type: form.type,
        notes: form.notes ? form.notes.trim() : undefined,
        folder:
          form.type === 'folder'
            ? {
                path: form.path.trim(),
              }
            : undefined,
        sftp:
          form.type === 'sftp'
            ? {
                host: form.host.trim(),
                port: Number(form.port) || 22,
                username: form.username.trim(),
                remotePath: form.remotePath.trim(),
              }
            : undefined,
      })

      setTargets((prev) => [target, ...prev.filter((item) => item.id !== target.id)])
      setMessage('Deployment target saved.')
      resetForm()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save deployment target.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap="lg" p="lg">
      <Card>
        <CardContent>
          <Stack gap="md">
            <Stack gap={4}>
              <Title order={2}>Deployment Targets</Title>
              <Text size="sm" c="dimmed">
                Configure destinations for build artifacts. Publish support is stubbed for now.
              </Text>
            </Stack>

            {loading && (
              <Group>
                <Loader size="sm" />
                <Text size="sm" c="dimmed">Loading deployment targets…</Text>
              </Group>
            )}
            {error && (
              <Alert color="red" title="Error">
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                <Grid>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <TextInput
                      label="Name"
                      id="deployment-name"
                      value={form.name}
                      onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Production server"
                    />
                  </Grid.Col>

                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <NativeSelect
                      label="Type"
                      id="deployment-type"
                      value={form.type}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, type: event.target.value as DeploymentType }))
                      }
                      data={[
                        { value: 'folder', label: 'Local folder' },
                        { value: 'sftp', label: 'SFTP server' },
                      ]}
                    />
                  </Grid.Col>

                  <Grid.Col span={12}>
                    <Textarea
                      label="Notes"
                      id="deployment-notes"
                      rows={2}
                      value={form.notes}
                      onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                      placeholder="Optional description or credentials hint"
                    />
                  </Grid.Col>

                  {form.type === 'folder' && (
                    <Grid.Col span={12}>
                      <TextInput
                        label="Folder path"
                        id="deployment-path"
                        value={form.path}
                        onChange={(event) => setForm((prev) => ({ ...prev, path: event.target.value }))}
                        placeholder="D:/minecraft/releases"
                      />
                    </Grid.Col>
                  )}

                  {form.type === 'sftp' && (
                    <>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <TextInput
                          label="Host"
                          id="deployment-host"
                          value={form.host}
                          onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
                          placeholder="sftp.example.com"
                        />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <TextInput
                          label="Port"
                          id="deployment-port"
                          value={form.port}
                          onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
                          placeholder="22"
                        />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <TextInput
                          label="Username"
                          id="deployment-username"
                          value={form.username}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, username: event.target.value }))
                          }
                          placeholder="deploy"
                        />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <TextInput
                          label="Remote path"
                          id="deployment-remote"
                          value={form.remotePath}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, remotePath: event.target.value }))
                          }
                          placeholder="/srv/minecraft/releases"
                        />
                      </Grid.Col>
                    </>
                  )}
                </Grid>

                <Group>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save Target'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={resetForm}
                    disabled={saving}
                  >
                    Reset
                  </Button>
                </Group>

                {message && (
                  <Alert
                    color={message.startsWith('Error') || message.includes('required') || message.includes('Failed') ? 'red' : 'green'}
                    title={message.startsWith('Error') || message.includes('required') || message.includes('Failed') ? 'Error' : 'Success'}
                  >
                    {message}
                  </Alert>
                )}
              </Stack>
            </form>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack gap="md">
            <Title order={3}>Configured Targets</Title>
            {targets.length === 0 && (
              <Text size="sm" c="dimmed">No deployment targets configured yet.</Text>
            )}
            {targets.length > 0 && (
              <Grid>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <Stack gap="md">
                    <Title order={4}>Local Folders</Title>
                    {folderTargets.length === 0 && (
                      <Text size="sm" c="dimmed">None configured.</Text>
                    )}
                    {folderTargets.length > 0 && (
                      <Stack gap="md">
                        {folderTargets.map((target) => (
                          <Card key={target.id}>
                            <CardContent>
                              <Stack gap={4}>
                                <Text fw={600}>{target.name}</Text>
                                <Text size="sm" c="dimmed">{target.path}</Text>
                                {target.notes && (
                                  <Text size="sm" c="dimmed">{target.notes}</Text>
                                )}
                              </Stack>
                            </CardContent>
                          </Card>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <Stack gap="md">
                    <Title order={4}>SFTP Servers</Title>
                    {sftpTargets.length === 0 && (
                      <Text size="sm" c="dimmed">None configured.</Text>
                    )}
                    {sftpTargets.length > 0 && (
                      <Stack gap="md">
                        {sftpTargets.map((target) => (
                          <Card key={target.id}>
                            <CardContent>
                              <Stack gap={4}>
                                <Text fw={600}>{target.name}</Text>
                                <Text size="sm" c="dimmed">
                                  {target.username}@{target.host}:{target.port ?? 22}
                                </Text>
                                <Text size="sm" c="dimmed">{target.remotePath}</Text>
                                {target.notes && (
                                  <Text size="sm" c="dimmed">{target.notes}</Text>
                                )}
                              </Stack>
                            </CardContent>
                          </Card>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Grid.Col>
              </Grid>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}

export default Deployments


