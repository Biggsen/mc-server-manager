import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Button as MantineButton } from '@mantine/core'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pill' | 'link' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  loading?: boolean
}

const sizeMap: Record<ButtonSize, 'xs' | 'sm' | 'md'> = {
  sm: 'xs',
  md: 'sm',
  lg: 'md',
}

const variantMap: Record<
  ButtonVariant,
  { variant: 'filled' | 'light' | 'subtle' | 'white' | 'outline'; color?: string; radius?: 'md' | 'lg' | 'xl'; underline?: boolean }
> = {
  primary: { variant: 'filled', color: 'blue' },
  secondary: { variant: 'light', color: 'blue' },
  ghost: { variant: 'subtle', color: 'gray' },
  pill: { variant: 'filled', color: 'blue', radius: 'xl' },
  link: { variant: 'subtle', color: 'blue', underline: true },
  danger: { variant: 'filled', color: 'red' },
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
      style: inlineStyle,
      ...props
    },
    ref,
  ) => {
    const settings = variantMap[variant]
    const combinedStyle =
      settings.underline && inlineStyle
        ? { ...inlineStyle, textDecoration: 'underline' }
        : settings.underline
          ? { textDecoration: 'underline' }
          : inlineStyle
    return (
      <MantineButton
        ref={ref}
        className={className}
        variant={settings.variant}
        color={settings.color}
        radius={settings.radius ?? 'md'}
        size={sizeMap[size]}
        leftSection={icon && iconPosition === 'left' ? icon : undefined}
        rightSection={icon && iconPosition === 'right' ? icon : undefined}
        loading={loading}
        disabled={loading || disabled}
        style={combinedStyle}
        {...props}
      >
        {children}
      </MantineButton>
    )
  },
)

Button.displayName = 'Button'
