import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CloudArrowDown, HardDrives } from '@phosphor-icons/react'
import { Alert, Group, Loader, NativeSelect, Stack, Text, Title } from '@mantine/core'
import { ContentSection } from '../components/layout'
import { Button, useToast } from '../components/ui'
import {
  cancelTeledosiBackupDownloadJob,
  downloadTeledosiBackupToLocal,
  fetchTeledosiBackupDownloadJob,
  fetchTeledosiBackupsList,
  type TeledosiBackupDownloadJob,
  type TeledosiBackupEntry,
} from '../lib/api'

export default function TeledosiBackups() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [entries, setEntries] = useState<TeledosiBackupEntry[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastDownloadPath, setLastDownloadPath] = useState<string | null>(null)
  const [downloadJob, setDownloadJob] = useState<TeledosiBackupDownloadJob | null>(null)

  const reload = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetchTeledosiBackupsList()
      const files = response.entries.filter((entry) => entry.type === 'file')
      setEntries(files)
      setSelected((prev) => {
        if (prev && files.some((entry) => entry.name === prev)) return prev
        return files[0]?.name ?? ''
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const options = useMemo(
    () =>
      entries.map((entry) => ({
        value: entry.name,
        label: entry.size != null ? `${entry.name} (${Math.round(entry.size / (1024 * 1024))} MiB)` : entry.name,
      })),
    [entries],
  )

  const downloadSelected = async () => {
    if (!selected) return
    setDownloadBusy(true)
    setLoadError(null)
    setLastDownloadPath(null)
    setDownloadJob(null)
    try {
      const result = await downloadTeledosiBackupToLocal(selected)
      const started = await fetchTeledosiBackupDownloadJob(result.jobId)
      setDownloadJob(started.job)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
      setDownloadBusy(false)
    } finally {
      // Busy state is cleared by polling when job reaches terminal state.
    }
  }

  const stopDownload = async () => {
    if (!downloadJob) return
    if (downloadJob.status !== 'pending' && downloadJob.status !== 'running') return
    try {
      await cancelTeledosiBackupDownloadJob(downloadJob.id)
      setDownloadBusy(false)
      setDownloadJob((prev) =>
        prev
          ? {
              ...prev,
              status: 'cancelled',
            }
          : prev,
      )
      toast({
        title: 'Download stopped',
        description: downloadJob.fileName,
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    if (!downloadJob) return
    if (downloadJob.status === 'completed' || downloadJob.status === 'failed') return
    const timer = window.setInterval(async () => {
      try {
        const { job } = await fetchTeledosiBackupDownloadJob(downloadJob.id)
        setDownloadJob(job)
        if (job.status === 'completed') {
          setDownloadBusy(false)
          setLastDownloadPath(job.localPath)
          toast({
            title: 'Backup downloaded',
            description: job.localPath,
          })
          window.clearInterval(timer)
        } else if (job.status === 'failed') {
          setDownloadBusy(false)
          setLoadError(job.error ?? 'Backup download failed')
          window.clearInterval(timer)
        } else if (job.status === 'cancelled') {
          setDownloadBusy(false)
          window.clearInterval(timer)
        }
      } catch (error) {
        setDownloadBusy(false)
        setLoadError(error instanceof Error ? error.message : String(error))
        window.clearInterval(timer)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [downloadJob, toast])

  const downloadProgressText = useMemo(() => {
    if (!downloadJob) return null
    const downloadedMiB = downloadJob.downloadedBytes / (1024 * 1024)
    if (!downloadJob.totalBytes || downloadJob.totalBytes <= 0) {
      return `${downloadJob.status}: ${downloadedMiB.toFixed(1)} MiB downloaded`
    }
    const totalMiB = downloadJob.totalBytes / (1024 * 1024)
    const pct = Math.max(0, Math.min(100, (downloadJob.downloadedBytes / downloadJob.totalBytes) * 100))
    const speedMiBs = (downloadJob.speedBytesPerSec ?? 0) / (1024 * 1024)
    const remainingMiB = Math.max(0, totalMiB - downloadedMiB)
    const etaSec =
      typeof downloadJob.etaSeconds === 'number'
        ? downloadJob.etaSeconds
        : speedMiBs > 0
          ? remainingMiB / speedMiBs
          : Number.POSITIVE_INFINITY
    const etaLabel = Number.isFinite(etaSec)
      ? `${Math.floor(etaSec / 60)}m ${Math.floor(etaSec % 60)}s`
      : 'calculating...'
    return `${downloadJob.status}: ${downloadedMiB.toFixed(1)} / ${totalMiB.toFixed(1)} MiB (${pct.toFixed(1)}%) · ${speedMiBs.toFixed(2)} MiB/s · ETA ${etaLabel}`
  }, [downloadJob])

  return (
    <ContentSection>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="sm">
            <HardDrives size={26} weight="duotone" aria-hidden />
            <Title order={2}>Teledosi Backups</Title>
          </Group>
          <Group gap="sm">
            <Button variant="secondary" size="sm" onClick={() => void reload()} disabled={loading}>
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/teledosi')}>
              Server
            </Button>
          </Group>
        </Group>

        <Text size="xs" c="dimmed" ff="monospace">
          Source: /opt/minecraft/backups
        </Text>

        {loadError && <Alert color="red">{loadError}</Alert>}

        {loading ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Loading backup files...</Text>
          </Group>
        ) : entries.length === 0 ? (
          <Alert color="blue">No backup files found in /opt/minecraft/backups.</Alert>
        ) : (
          <Group align="flex-end" wrap="nowrap">
            <NativeSelect
              label="Backup file"
              data={options}
              value={selected}
              onChange={(e) => setSelected(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              icon={<CloudArrowDown size={18} weight="fill" />}
              onClick={() => void downloadSelected()}
              disabled={!selected || downloadBusy}
              loading={downloadBusy}
            >
              Download
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void stopDownload()}
              disabled={!downloadJob || (downloadJob.status !== 'pending' && downloadJob.status !== 'running')}
            >
              Stop
            </Button>
          </Group>
        )}

        {lastDownloadPath && (
          <Alert color="green" title="Saved locally">
            {lastDownloadPath}
          </Alert>
        )}

        {downloadProgressText && (
          <Alert
            color={
              downloadJob?.status === 'failed'
                ? 'red'
                : downloadJob?.status === 'cancelled'
                  ? 'yellow'
                  : 'blue'
            }
            title="Download progress"
          >
            {downloadProgressText}
          </Alert>
        )}
      </Stack>
    </ContentSection>
  )
}
