import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Badge as MantineBadge } from '@mantine/core'

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'outline'

export interface BadgeProps
  extends Omit<ComponentPropsWithoutRef<typeof MantineBadge>, 'color' | 'variant'> {
  variant?: BadgeVariant
  children?: ReactNode
}

const variantMap: Record<BadgeVariant, { variant: 'light' | 'filled' | 'outline'; color?: string }> = {
  default: { variant: 'light' },
  accent: { variant: 'filled', color: 'blue' },
  success: { variant: 'filled', color: 'green' },
  warning: { variant: 'filled', color: 'yellow' },
  danger: { variant: 'filled', color: 'red' },
  outline: { variant: 'outline', color: 'gray' },
}

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(({ className, variant = 'default', ...props }, ref) => {
  const settings = variantMap[variant]
  return <MantineBadge ref={ref} className={className} variant={settings.variant} color={settings.color} {...props} />
})

Badge.displayName = 'Badge'
