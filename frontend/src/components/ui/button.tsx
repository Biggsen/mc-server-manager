import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pill' | 'link' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      icon,
      iconPosition = 'left',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const hasIcon = Boolean(icon)
    const iconElement = hasIcon ? (
      <span className="ui-btn__icon" aria-hidden="true">
        {icon}
      </span>
    ) : null

    return (
      <button
        ref={ref}
        className={cn('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, { 'is-loading': loading }, className)}
        disabled={loading || disabled}
        {...props}
      >
        {hasIcon && iconPosition === 'left' && iconElement}
        <span className="ui-btn__label">{children}</span>
        {hasIcon && iconPosition === 'right' && iconElement}
      </button>
    )
  },
)

Button.displayName = 'Button'


