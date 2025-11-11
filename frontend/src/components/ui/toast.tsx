/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
  type HTMLAttributes,
  forwardRef,
} from 'react'
import { cn } from '../../lib/cn'

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  id?: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastRecord extends ToastOptions {
  id: string
  createdAt: number
}

type ToastAction =
  | { type: 'PUSH'; payload: ToastRecord }
  | { type: 'DISMISS'; payload: { id: string } }
  | { type: 'CLEAR_EXPIRED'; payload: { now: number } }

function toastReducer(state: ToastRecord[], action: ToastAction): ToastRecord[] {
  switch (action.type) {
    case 'PUSH':
      return [...state, action.payload]
    case 'DISMISS':
      return state.filter((toast) => toast.id !== action.payload.id)
    case 'CLEAR_EXPIRED':
      return state.filter((toast) => {
        const duration = toast.duration ?? 5000
        return toast.createdAt + duration > action.payload.now
      })
    default:
      return state
  }
}

interface ToastContextValue {
  toasts: ToastRecord[]
  push: (options: ToastOptions) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastId = 0

export interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [state, dispatch] = useReducer(toastReducer, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts: state,
      push: ({ id, ...options }) => {
        const finalId = id ?? `toast-${++toastId}`
        dispatch({
          type: 'PUSH',
          payload: {
            id: finalId,
            createdAt: Date.now(),
            ...options,
          },
        })
        return finalId
      },
      dismiss: (targetId) => {
        dispatch({ type: 'DISMISS', payload: { id: targetId } })
      },
    }),
    [state],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }

  return useMemo(
    () => ({
      toast: ctx.push,
      dismiss: ctx.dismiss,
      toasts: ctx.toasts,
    }),
    [ctx.dismiss, ctx.push, ctx.toasts],
  )
}

export interface ToastViewportProps extends HTMLAttributes<HTMLDivElement> {
  autoDismiss?: boolean
  interval?: number
}

export const ToastViewport = forwardRef<HTMLDivElement, ToastViewportProps>(
  ({ className, autoDismiss = true, interval = 1600, ...props }, ref) => {
    const { toasts, dismiss } = useToast()

    useEffect(() => {
      if (!autoDismiss) {
        return
      }
      const id = window.setInterval(() => {
        const now = Date.now()
        toasts.forEach((toast) => {
          const duration = toast.duration ?? 5000
          if (toast.createdAt + duration <= now) {
            dismiss(toast.id)
          }
        })
      }, interval)
      return () => {
        window.clearInterval(id)
      }
    }, [autoDismiss, dismiss, interval, toasts])

    return (
      <div ref={ref} className={cn('ui-toast-viewport', className)} role="status" {...props}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    )
  },
)

ToastViewport.displayName = 'ToastViewport'

interface ToastItemProps {
  toast: ToastRecord
  onDismiss: () => void
}

const variantClassMap: Record<ToastVariant, string> = {
  default: 'ui-toast--default',
  success: 'ui-toast--success',
  warning: 'ui-toast--warning',
  danger: 'ui-toast--danger',
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { title, description, variant = 'default' } = toast
  return (
    <div className={cn('ui-toast', variantClassMap[variant])}>
      <div className="ui-toast__content">
        {title && <p className="ui-toast__title">{title}</p>}
        {description && <p className="ui-toast__description">{description}</p>}
      </div>
      <button className="ui-toast__close" type="button" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  )
}


