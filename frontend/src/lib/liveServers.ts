export interface LiveServerEntry {
  id: string
  label: string
  filesLabel: string
  serverPath: string
  filesPath: string
  iconPath: string
}

export const liveServers: LiveServerEntry[] = [
  {
    id: 'teledosi',
    label: 'Teledosi Server',
    filesLabel: 'Teledosi Files',
    serverPath: '/teledosi',
    filesPath: '/teledosi/files',
    iconPath: 'server_icons/teledosi.png',
  },
  {
    id: 'charidh',
    label: 'Charidh Server',
    filesLabel: 'Charidh Files',
    serverPath: '/charidh',
    filesPath: '/charidh/files',
    iconPath: 'server_icons/charidh.png',
  },
]
