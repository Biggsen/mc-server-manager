import { useCallback, useEffect, useRef, useState } from 'react'
import { useAsyncActionsRegistry } from './asyncActions'
import { useToast, type ToastOptions } from '../components/ui/toast'

type ToastConfig<Result, Args extends unknown[]> =
  | ToastOptions
  | null
  | undefined
  | ((result: Result, args: Args) => ToastOptions | null | undefined)

type ErrorToastConfig<Args extends unknown[]> =
  | ToastOptions
  | null
  | undefined
  | ((error: unknown, args: Args) => ToastOptions | null | undefined)

type LabelConfig<Args extends unknown[]> = string | ((...args: Args) => string)

export interface AsyncActionConfig<Result, Args extends unknown[]> {
  label?: LabelConfig<Args>
  successToast?: ToastConfig<Result, Args>
  errorToast?: ErrorToastConfig<Args>
  onStart?: (...args: Args) => void
  onSuccess?: (result: Result, args: Args) => void
  onError?: (error: unknown, args: Args) => void
  onFinally?: (...args: Args) => void
  suppressDefaultErrorToast?: boolean
}

export interface AsyncActionHandle<Args extends unknown[], Result> {
  run: (...args: Args) => Promise<Result>
  busy: boolean
  activeCount: number
}

const DEFAULT_LABEL = 'Working…'

function resolveLabel<Args extends unknown[]>(label: LabelConfig<Args> | undefined, args: Args): string {
  if (typeof label === 'function') {
    return label(...args)
  }
  if (typeof label === 'string' && label.trim().length > 0) {
    return label
  }
  return DEFAULT_LABEL
}

function resolveToast<Result, Args extends unknown[]>(
  config: ToastConfig<Result, Args>,
  result: Result,
  args: Args,
): ToastOptions | null {
  if (!config) return null
  if (typeof config === 'function') {
    return config(result, args) ?? null
  }
  return config
}

function resolveErrorToast<Args extends unknown[]>(
  config: ErrorToastConfig<Args>,
  error: unknown,
  args: Args,
): ToastOptions | null {
  if (!config) return null
  if (typeof config === 'function') {
    return config(error, args) ?? null
  }
  return config
}

export function useAsyncAction<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result>,
  config: AsyncActionConfig<Result, Args> = {},
): AsyncActionHandle<Args, Result> {
  const { register, complete } = useAsyncActionsRegistry()
  const { toast } = useToast()
  const [activeCount, setActiveCount] = useState(0)
  const mountedRef = useRef(true)

  const run = useCallback(
    async (...args: Args) => {
      const label = resolveLabel(config.label, args)
      const actionId = register(label)
      setActiveCount((count) => count + 1)
      config.onStart?.(...args)

      try {
        const result = await handler(...args)
        config.onSuccess?.(result, args)
        const toastConfig = resolveToast(config.successToast, result, args)
        if (toastConfig) {
          toast(toastConfig)
        }
        return result
      } catch (error) {
        config.onError?.(error, args)
        if (!config.suppressDefaultErrorToast) {
          const toastConfig =
            resolveErrorToast(config.errorToast, error, args) ??
            ({
              title: 'Something went wrong',
              description: error instanceof Error ? error.message : String(error),
              variant: 'danger',
            } satisfies ToastOptions)
          if (toastConfig) {
            toast(toastConfig)
          }
        }
        throw error
      } finally {
        complete(actionId)
        config.onFinally?.(...args)
        if (mountedRef.current) {
          setActiveCount((count) => Math.max(0, count - 1))
        }
      }
    },
    [complete, config, handler, register, toast],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return {
    run,
    busy: activeCount > 0,
    activeCount,
  }
}


