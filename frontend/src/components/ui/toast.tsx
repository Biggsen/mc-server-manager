import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { notifications } from '@mantine/notifications'

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  id?: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const variantColor: Record<ToastVariant, string | undefined> = {
  default: undefined,
  success: 'green',
  warning: 'yellow',
  danger: 'red',
}

export interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const value = useMemo<ToastContextValue>(
    () => ({
      toast: ({ id, title, description, variant = 'default', duration }) => {
        return notifications.show({
          id,
          title,
          message: description,
          color: variantColor[variant],
          autoClose: duration ?? 5000,
        })
      },
      dismiss: (id: string) => notifications.hide(id),
    }),
    [],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

export function ToastViewport(): null {
  return null
}
