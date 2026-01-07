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
}

export function AppShell({
  sidebar,
  topbar,
  children,
  className,
  mainClassName,
  sidebarClassName,
  topbarClassName,
}: AppShellProps) {
  return (
    <MantineAppShell
      className={className}
      padding="xl"
      navbar={{
        width: 280,
        breakpoint: 'lg',
      }}
      header={{
        height: 80,
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
