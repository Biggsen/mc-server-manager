import { ReactNode } from 'react'
import { cn } from '../../lib/cn'

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
    <div className={cn('app-shell', className)}>
      <aside className={cn('app-shell__sidebar', sidebarClassName)}>{sidebar}</aside>
      <div className={cn('app-shell__main', mainClassName)}>
        <header className={cn('app-shell__topbar', topbarClassName)}>{topbar}</header>
        {children}
      </div>
    </div>
  )
}


