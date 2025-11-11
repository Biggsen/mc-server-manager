import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from 'react'
import { cn } from '../../lib/cn'

interface TabsContextValue {
  activeId: string
  setActiveId: (id: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) {
    throw new Error(`${component} must be used within <Tabs>`)
  }
  return ctx
}

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
  ...props
}: TabsProps) {
  const autoId = useId()
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? '')

  const activeId = value ?? internalValue ?? defaultValue ?? autoId

  const setActiveId = useCallback(
    (next: string) => {
      if (value === undefined) {
        setInternalValue(next)
      }
      onValueChange?.(next)
    },
    [onValueChange, value],
  )

  const context = useMemo<TabsContextValue>(
    () => ({
      activeId,
      setActiveId,
    }),
    [activeId, setActiveId],
  )

  return (
    <TabsContext.Provider value={context}>
      <div className={cn('ui-tabs', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export type TabListProps = HTMLAttributes<HTMLDivElement>

export const TabList = forwardRef<HTMLDivElement, TabListProps>(({ className, ...props }, ref) => (
  <div ref={ref} role="tablist" className={cn('ui-tabs__list', className)} {...props} />
))
TabList.displayName = 'TabList'

export interface TabTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string
}

export const TabTrigger = forwardRef<HTMLButtonElement, TabTriggerProps>(
  ({ className, value, children, ...props }, ref) => {
    const { activeId, setActiveId } = useTabsContext('TabTrigger')
    const isActive = activeId === value

    return (
      <button
        ref={ref}
        role="tab"
        type="button"
        aria-selected={isActive}
        data-state={isActive ? 'active' : 'inactive'}
        className={cn('ui-tabs__trigger', { 'is-active': isActive }, className)}
        onClick={() => setActiveId(value)}
        {...props}
      >
        {children}
      </button>
    )
  },
)
TabTrigger.displayName = 'TabTrigger'

export type TabPanelsProps = HTMLAttributes<HTMLDivElement>

export const TabPanels = forwardRef<HTMLDivElement, TabPanelsProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('ui-tabs__panels', className)} {...props} />
))
TabPanels.displayName = 'TabPanels'

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string
}

export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(
  ({ className, value, children, ...props }, ref) => {
    const { activeId } = useTabsContext('TabPanel')
    const isActive = activeId === value
    return (
      <div
        ref={ref}
        role="tabpanel"
        hidden={!isActive}
        className={cn('ui-tabs__panel', { 'is-active': isActive }, className)}
        {...props}
      >
        {isActive ? children : null}
      </div>
    )
  },
)
TabPanel.displayName = 'TabPanel'


