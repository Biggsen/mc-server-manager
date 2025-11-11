import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plug } from '@phosphor-icons/react'
import {
  searchPlugins,
  addLibraryPlugin,
  uploadLibraryPlugin,
  type PluginSearchResult,
} from '../lib/api'
import { Button } from '../components/ui'
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
    <>
      <ContentSection as="section">
        <header>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link to="/plugins" className="link" style={{ display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={18} weight="bold" aria-hidden="true" />
            </Link>
            <div>
              <h2>
                <span className="title-icon" aria-hidden="true">
                  <Plug size={22} weight="fill" />
                </span>
                Add Plugin to Library
              </h2>
            </div>
          </div>
        </header>
      </ContentSection>

      <div className="assets-grid">
        <ContentSection as="article">
          <header>
            <h3>Add via Download URL</h3>
          </header>
          <form
            className="page-form"
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
            <div className="form-grid">
              <div className="field">
                <label htmlFor="manual-plugin-id">Plugin ID</label>
                <input
                  id="manual-plugin-id"
                  value={manualPluginId}
                  onChange={(event) => setManualPluginId(event.target.value)}
                  placeholder="worldguard"
                />
              </div>
              <div className="field">
                <label htmlFor="manual-plugin-version">Version</label>
                <input
                  id="manual-plugin-version"
                  value={manualPluginVersion}
                  onChange={(event) => setManualPluginVersion(event.target.value)}
                  placeholder="7.0.10"
                />
              </div>
              <div className="field">
                <label htmlFor="manual-plugin-min-version">Min Minecraft Version</label>
                <input
                  id="manual-plugin-min-version"
                  value={manualMinVersion}
                  onChange={(event) => setManualMinVersion(event.target.value)}
                  placeholder="1.21.1"
                />
              </div>
              <div className="field">
                <label htmlFor="manual-plugin-max-version">Max Minecraft Version</label>
                <input
                  id="manual-plugin-max-version"
                  value={manualMaxVersion}
                  onChange={(event) => setManualMaxVersion(event.target.value)}
                  placeholder="1.21.1"
                />
              </div>
              <div className="field span-2">
                <label htmlFor="manual-plugin-url">Download URL</label>
                <input
                  id="manual-plugin-url"
                  value={manualPluginUrl}
                  onChange={(event) => setManualPluginUrl(event.target.value)}
                  placeholder="https://example.com/plugin.jar"
                />
              </div>
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={manualBusy}>
                {manualBusy ? 'Adding…' : 'Add Plugin'}
              </Button>
            </div>
          </form>
        </ContentSection>

        <ContentSection as="article">
          <header>
            <h3>Upload Plugin Jar</h3>
          </header>
          <form
            className="page-form"
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
                  description:
                    'Plugin ID, version, file, and Minecraft version range are required.',
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
            <div className="form-grid">
              <div className="field">
                <label htmlFor="upload-plugin-id">Plugin ID</label>
                <input
                  id="upload-plugin-id"
                  value={uploadPluginId}
                  onChange={(event) => setUploadPluginId(event.target.value)}
                  placeholder="my-custom-plugin"
                />
              </div>
              <div className="field">
                <label htmlFor="upload-plugin-version">Version</label>
                <input
                  id="upload-plugin-version"
                  value={uploadPluginVersion}
                  onChange={(event) => setUploadPluginVersion(event.target.value)}
                  placeholder="1.0.0"
                />
              </div>
              <div className="field">
                <label htmlFor="upload-plugin-min-version">Min Minecraft Version</label>
                <input
                  id="upload-plugin-min-version"
                  value={uploadMinVersion}
                  onChange={(event) => setUploadMinVersion(event.target.value)}
                  placeholder="1.21.1"
                />
              </div>
              <div className="field">
                <label htmlFor="upload-plugin-max-version">Max Minecraft Version</label>
                <input
                  id="upload-plugin-max-version"
                  value={uploadMaxVersion}
                  onChange={(event) => setUploadMaxVersion(event.target.value)}
                  placeholder="1.21.1"
                />
              </div>
              <div className="field span-2">
                <label htmlFor="upload-plugin-file">Plugin Jar</label>
                <input
                  id="upload-plugin-file"
                  type="file"
                  accept=".jar,.zip"
                  onChange={(event) => setUploadPluginFile(event.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={uploadBusy}>
                {uploadBusy ? 'Uploading…' : 'Upload Plugin'}
              </Button>
            </div>
          </form>
        </ContentSection>

        <ContentSection as="article">
          <header>
            <h3>Search External Catalogs</h3>
          </header>

          <section>
            <form
              className="page-form"
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
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="plugin-search-loader">Loader</label>
                  <select
                    id="plugin-search-loader"
                    value={loader}
                    onChange={(event) => setLoader(event.target.value)}
                  >
                    <option value="paper">Paper</option>
                    <option value="purpur">Purpur</option>
                    <option value="spigot">Spigot</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="plugin-search-mc-version">Minecraft Version</label>
                  <input
                    id="plugin-search-mc-version"
                    value={minecraftVersion}
                    onChange={(event) => setMinecraftVersion(event.target.value)}
                    placeholder="1.21.1"
                  />
                </div>
                <div className="field span-2">
                  <label htmlFor="plugin-search">Search</label>
                  <input
                    id="plugin-search"
                    value={pluginQuery}
                    onChange={(event) => setPluginQuery(event.target.value)}
                    placeholder="WorldGuard, LuckPerms, ..."
                  />
                </div>
              </div>
              <div className="form-actions">
                <Button type="submit" variant="ghost" disabled={loadingPlugins}>
                  {loadingPlugins ? 'Searching…' : 'Search'}
                </Button>
              </div>
              {searchStatus && <p className="muted">{searchStatus}</p>}
            </form>

            {pluginResults.length > 0 && (
              <div className="layout-grid" style={{ marginTop: '1.5rem' }}>
                <ContentSection as="section">
                  <header>
                    <h4>Search Results</h4>
                  </header>
                  <ul className="project-list">
                    {pluginResults.map((result) => (
                      <li key={`${result.provider}:${result.slug}`}>
                        <div>
                          <strong>{result.name}</strong>{' '}
                          <span className="badge">{catalogProviderLabel[result.provider]}</span>
                          <p className="muted">
                            {result.slug} ·{' '}
                            <a
                              href={`https://google.com/search?q=${encodeURIComponent(
                                `${result.name} ${loader} ${minecraftVersion}`,
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Search releases
                            </a>
                          </p>
                          {result.summary && <p className="muted">{result.summary}</p>}
                          {result.projectUrl && (
                            <a href={result.projectUrl} target="_blank" rel="noreferrer">
                              View project
                            </a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </ContentSection>
              </div>
            )}
          </section>
        </ContentSection>
      </div>
    </>
  )
}

export default AddPlugin

