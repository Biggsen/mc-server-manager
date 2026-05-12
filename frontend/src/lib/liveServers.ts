export interface LiveServerEntry {
  id: string
  label: string
  filesLabel: string
  logsLabel: string
  serverPath: string
  filesPath: string
  logsPath: string
  iconPath: string
}

export const liveServers: LiveServerEntry[] = [
  {
    id: 'teledosi',
    label: 'Teledosi Server',
    filesLabel: 'Teledosi Files',
    logsLabel: 'Teledosi Logs',
    serverPath: '/teledosi',
    filesPath: '/teledosi/files',
    logsPath: '/teledosi/logs',
    iconPath: 'server_icons/teledosi.png',
  },
  {
    id: 'charidh',
    label: 'Charidh Server',
    filesLabel: 'Charidh Files',
    logsLabel: 'Charidh Logs',
    serverPath: '/charidh',
    filesPath: '/charidh/files',
    logsPath: '/charidh/logs',
    iconPath: 'server_icons/charidh.png',
  },
]
