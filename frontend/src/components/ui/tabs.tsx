import { Tabs as MantineTabs } from '@mantine/core'
import type { TabsProps as MantineTabsProps } from '@mantine/core'
import type { ReactElement, ReactNode } from 'react'

export const Tabs = (props: MantineTabsProps): ReactElement => <MantineTabs {...props} />
export const TabList = MantineTabs.List
export const TabTrigger = MantineTabs.Tab
// Mantine doesn't have a Panels wrapper - TabPanel components are used directly
export const TabPanels = ({ children }: { children?: ReactNode }): ReactElement => <>{children}</>
export const TabPanel = MantineTabs.Panel
