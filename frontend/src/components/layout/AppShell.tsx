import type { ReactNode } from 'react'
import { AppShell as MantineAppShell, ScrollArea, Box } from '@mantine/core'

export interface AppShellProps {
  sidebar: ReactNode
  topbar: ReactNode
  children: ReactNode
  className?: string
  mainClassName?: string
  sidebarClassName?: string
  topbarClassName?: string
  isDev?: boolean | null
}

export function AppShell({
  sidebar,
  topbar,
  children,
  className,
  mainClassName,
  sidebarClassName,
  topbarClassName,
  isDev,
}: AppShellProps) {
  const borderColor = isDev === null 
    ? 'var(--mantine-color-gray-6)' 
    : isDev 
    ? 'var(--mantine-color-yellow-6)' 
    : 'var(--mantine-color-green-6)'

  return (
    <MantineAppShell
      className={className}
      padding="xl"
      navbar={{
        width: 200,
        breakpoint: 'xs',
      }}
      header={{
        height: 80,
      }}
      styles={{
        navbar: {
          width: '200px',
          minWidth: '200px',
          maxWidth: '200px',
        },
        header: {
          borderLeft: `4px solid ${borderColor}`,
        },
      }}
    >
      <MantineAppShell.Header className={topbarClassName}>
        <Box h="100%" px="lg" display="flex" style={{ alignItems: 'center' }}>
          {topbar}
        </Box>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="lg" className={sidebarClassName}>
        <ScrollArea type="auto" h="100%">
          {sidebar}
        </ScrollArea>
      </MantineAppShell.Navbar>
      <MantineAppShell.Main className={mainClassName}>
        <ScrollArea type="auto" h="100%">
          {children}
        </ScrollArea>
      </MantineAppShell.Main>
    </MantineAppShell>
  )
}
