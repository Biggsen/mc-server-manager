import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import {
  searchPlugins,
  addLibraryPlugin,
  uploadLibraryPlugin,
  type PluginSearchResult,
} from '../lib/api'
import {
  Anchor,
  Badge,
  Grid,
  Group,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { Button, Card, CardContent } from '../components/ui'
import { ContentSection } from '../components/layout'
import { useToast } from '../components/ui/toast'

const catalogProviderLabel: Record<'hangar' | 'modrinth' | 'spiget', string> = {
  hangar: 'Hangar',
  modrinth: 'Modrinth',
  spiget: 'Spigot',
}

function AddPlugin() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginResults, setPluginResults] = useState<PluginSearchResult[]>([])
  const [searchStatus, setSearchStatus] = useState<string | null>(null)
  const [loadingPlugins, setLoadingPlugins] = useState(false)
  const [loader, setLoader] = useState('paper')
  const [minecraftVersion, setMinecraftVersion] = useState('1.21.1')
  const [manualPluginId, setManualPluginId] = useState('')
  const [manualPluginVersion, setManualPluginVersion] = useState('')
  const [manualPluginUrl, setManualPluginUrl] = useState('')
  const [manualMinVersion, setManualMinVersion] = useState('')
  const [manualMaxVersion, setManualMaxVersion] = useState('')
  const [uploadPluginId, setUploadPluginId] = useState('')
  const [uploadPluginVersion, setUploadPluginVersion] = useState('')
  const [uploadPluginFile, setUploadPluginFile] = useState<File | null>(null)
  const [uploadMinVersion, setUploadMinVersion] = useState('')
  const [uploadMaxVersion, setUploadMaxVersion] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)

  return (
    <Stack gap="xl">
      <ContentSection as="section" padding="xl">
        <Group gap="sm" align="flex-start">
          <Button
            variant="ghost"
            icon={<ArrowLeft size={18} weight="bold" aria-hidden="true" />}
            onClick={() => navigate('/plugins')}
          >
            Back to Library
          </Button>
          <Stack gap={2}>
            <Title order={2}>Add Plugin to Library</Title>
            <Text size="sm" c="dimmed">
              Import plugins via download URL, direct upload, or search external catalogs.
            </Text>
          </Stack>
        </Group>
      </ContentSection>

      <Stack gap="xl">
        <ContentSection as="article" padding="xl">
          <Stack gap="lg">
            <Title order={3}>Add via Download URL</Title>
            <Card>
              <CardContent>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    if (
                      !manualPluginId.trim() ||
                      !manualPluginVersion.trim() ||
                      !manualPluginUrl.trim() ||
                      !manualMinVersion.trim() ||
                      !manualMaxVersion.trim()
                    ) {
                      toast({
                        title: 'Failed to add plugin',
                        description:
                          'Plugin ID, version, download URL, and Minecraft version range are required.',
                        variant: 'danger',
                      })
                      return
                    }
                    try {
                      setManualBusy(true)
                      await addLibraryPlugin({
                        pluginId: manualPluginId.trim(),
                        version: manualPluginVersion.trim(),
                        provider: 'custom',
                        downloadUrl: manualPluginUrl.trim(),
                        minecraftVersionMin: manualMinVersion.trim(),
                        minecraftVersionMax: manualMaxVersion.trim(),
                      })
                      toast({
                        title: 'Plugin added',
                        description: `${manualPluginId.trim()} ${manualPluginVersion.trim()} added to library.`,
                        variant: 'success',
                      })
                      navigate('/plugins')
                    } catch (err) {
                      toast({
                        title: 'Failed to add plugin',
                        description: err instanceof Error ? err.message : 'Failed to add plugin.',
                        variant: 'danger',
                      })
                    } finally {
                      setManualBusy(false)
                    }
                  }}
                >
                  <Grid gutter="md">
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Plugin ID
                        </Text>
                        <TextInput
                          id="manual-plugin-id"
                          value={manualPluginId}
                          onChange={(event) => setManualPluginId(event.currentTarget.value)}
                          placeholder="worldguard"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Version
                        </Text>
                        <TextInput
                          id="manual-plugin-version"
                          value={manualPluginVersion}
                          onChange={(event) => setManualPluginVersion(event.currentTarget.value)}
                          placeholder="7.0.10"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Min Minecraft Version
                        </Text>
                        <TextInput
                          id="manual-plugin-min-version"
                          value={manualMinVersion}
                          onChange={(event) => setManualMinVersion(event.currentTarget.value)}
                          placeholder="1.21.1"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Max Minecraft Version
                        </Text>
                        <TextInput
                          id="manual-plugin-max-version"
                          value={manualMaxVersion}
                          onChange={(event) => setManualMaxVersion(event.currentTarget.value)}
                          placeholder="1.21.1"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Download URL
                        </Text>
                        <TextInput
                          id="manual-plugin-url"
                          value={manualPluginUrl}
                          onChange={(event) => setManualPluginUrl(event.currentTarget.value)}
                          placeholder="https://example.com/plugin.jar"
                        />
                      </Stack>
                    </Grid.Col>
                  </Grid>
                  <Group justify="flex-end" mt="md">
                    <Button type="submit" variant="primary" disabled={manualBusy}>
                      {manualBusy ? 'Adding…' : 'Add plugin'}
                    </Button>
                  </Group>
                </form>
              </CardContent>
            </Card>
          </Stack>
        </ContentSection>

        <ContentSection as="article" padding="xl">
          <Stack gap="lg">
            <Title order={3}>Upload Plugin Jar</Title>
            <Card>
              <CardContent>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    if (
                      !uploadPluginId.trim() ||
                      !uploadPluginVersion.trim() ||
                      !uploadPluginFile ||
                      !uploadMinVersion.trim() ||
                      !uploadMaxVersion.trim()
                    ) {
                      toast({
                        title: 'Failed to upload plugin',
                        description: 'Plugin ID, version, file, and Minecraft version range are required.',
                        variant: 'danger',
                      })
                      return
                    }
                    try {
                      setUploadBusy(true)
                      await uploadLibraryPlugin({
                        pluginId: uploadPluginId.trim(),
                        version: uploadPluginVersion.trim(),
                        file: uploadPluginFile,
                        minecraftVersionMin: uploadMinVersion.trim(),
                        minecraftVersionMax: uploadMaxVersion.trim(),
                      })
                      toast({
                        title: 'Plugin uploaded',
                        description: `${uploadPluginId.trim()} ${uploadPluginVersion.trim()} uploaded successfully.`,
                        variant: 'success',
                      })
                      navigate('/plugins')
                    } catch (err) {
                      toast({
                        title: 'Upload failed',
                        description: err instanceof Error ? err.message : 'Failed to upload plugin.',
                        variant: 'danger',
                      })
                    } finally {
                      setUploadBusy(false)
                    }
                  }}
                >
                  <Grid gutter="md">
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Plugin ID
                        </Text>
                        <TextInput
                          id="upload-plugin-id"
                          value={uploadPluginId}
                          onChange={(event) => setUploadPluginId(event.currentTarget.value)}
                          placeholder="my-custom-plugin"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Version
                        </Text>
                        <TextInput
                          id="upload-plugin-version"
                          value={uploadPluginVersion}
                          onChange={(event) => setUploadPluginVersion(event.currentTarget.value)}
                          placeholder="1.0.0"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Min Minecraft Version
                        </Text>
                        <TextInput
                          id="upload-plugin-min-version"
                          value={uploadMinVersion}
                          onChange={(event) => setUploadMinVersion(event.currentTarget.value)}
                          placeholder="1.21.1"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Max Minecraft Version
                        </Text>
                        <TextInput
                          id="upload-plugin-max-version"
                          value={uploadMaxVersion}
                          onChange={(event) => setUploadMaxVersion(event.currentTarget.value)}
                          placeholder="1.21.1"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Plugin Jar
                        </Text>
                        <TextInput
                          id="upload-plugin-file"
                          type="file"
                          accept=".jar,.zip"
                          onChange={(event) => setUploadPluginFile(event.currentTarget.files?.[0] ?? null)}
                        />
                      </Stack>
                    </Grid.Col>
                  </Grid>
                  <Group justify="flex-end" mt="md">
                    <Button type="submit" variant="primary" disabled={uploadBusy}>
                      {uploadBusy ? 'Uploading…' : 'Upload plugin'}
                    </Button>
                  </Group>
                </form>
              </CardContent>
            </Card>
          </Stack>
        </ContentSection>

        <ContentSection as="article" padding="xl">
          <Stack gap="lg">
            <Title order={3}>Search External Catalogs</Title>
            <Card>
              <CardContent>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    if (!pluginQuery.trim()) return
                    try {
                      setLoadingPlugins(true)
                      setSearchStatus(null)
                      const results = await searchPlugins(pluginQuery, loader, minecraftVersion)
                      setPluginResults(results)
                      if (results.length === 0) {
                        setSearchStatus('No plugins found for that query.')
                      }
                    } catch (err) {
                      setSearchStatus(err instanceof Error ? err.message : 'Search failed')
                    } finally {
                      setLoadingPlugins(false)
                    }
                  }}
                >
                  <Grid gutter="md">
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Loader
                        </Text>
                        <NativeSelect
                          id="plugin-search-loader"
                          value={loader}
                          onChange={(event) => setLoader(event.currentTarget.value)}
                          data={[
                            { value: 'paper', label: 'Paper' },
                            { value: 'purpur', label: 'Purpur' },
                            { value: 'spigot', label: 'Spigot' },
                          ]}
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Minecraft Version
                        </Text>
                        <TextInput
                          id="plugin-search-mc-version"
                          value={minecraftVersion}
                          onChange={(event) => setMinecraftVersion(event.currentTarget.value)}
                          placeholder="1.21.1"
                        />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <Stack gap={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Search
                        </Text>
                        <TextInput
                          id="plugin-search"
                          value={pluginQuery}
                          onChange={(event) => setPluginQuery(event.currentTarget.value)}
                          placeholder="WorldGuard, LuckPerms, ..."
                        />
                      </Stack>
                    </Grid.Col>
                  </Grid>
                  <Group justify="space-between" mt="md" align="center">
                    {searchStatus && (
                      <Text size="sm" c="dimmed">
                        {searchStatus}
                      </Text>
                    )}
                    <Button type="submit" variant="ghost" disabled={loadingPlugins}>
                      {loadingPlugins ? 'Searching…' : 'Search'}
                    </Button>
                  </Group>
                </form>

                {pluginResults.length > 0 && (
                  <Stack gap="md" mt="lg">
                    {pluginResults.map((result) => (
                      <Card key={`${result.provider}:${result.slug}`}>
                        <CardContent>
                          <Stack gap="xs">
                            <Text fw={600}>{result.name}</Text>
                            <Group gap="xs">
                              <Badge variant="light">{catalogProviderLabel[result.provider]}</Badge>
                              <Text size="sm" c="dimmed">
                                {result.slug}
                              </Text>
                            </Group>
                            {result.summary && (
                              <Text size="sm" c="dimmed">
                                {result.summary}
                              </Text>
                            )}
                            {result.projectUrl && (
                              <Anchor href={result.projectUrl} target="_blank" rel="noreferrer" size="sm">
                                View project
                              </Anchor>
                            )}
                            <Anchor
                              href={`https://google.com/search?q=${encodeURIComponent(
                                `${result.name} ${loader} ${minecraftVersion}`,
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              size="sm"
                            >
                              Search releases
                            </Anchor>
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Stack>
        </ContentSection>
      </Stack>
    </Stack>
  )
}

export default AddPlugin

