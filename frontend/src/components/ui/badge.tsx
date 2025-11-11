import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'outline'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <span ref={ref} className={cn('ui-badge', `ui-badge--${variant}`, className)} {...props} />
  ),
)

Badge.displayName = 'Badge'


