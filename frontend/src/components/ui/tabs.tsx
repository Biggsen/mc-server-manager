import { Tabs as MantineTabs } from '@mantine/core'
import type { TabsProps as MantineTabsProps } from '@mantine/core'
import type { ReactElement } from 'react'

export const Tabs = (props: MantineTabsProps): ReactElement => <MantineTabs {...props} />
export const TabList = MantineTabs.List
export const TabTrigger = MantineTabs.Tab
export const TabPanels = MantineTabs.Panels
export const TabPanel = MantineTabs.Panel
