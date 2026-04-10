import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Button as MantineButton } from '@mantine/core'

/** Matches Mantine Button `styles` API (partial keys). */
export type MantineButtonStyles = Partial<{
  root: CSSProperties
  inner: CSSProperties
  label: CSSProperties
  section: CSSProperties
}>

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pill' | 'link' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  loading?: boolean
  styles?: MantineButtonStyles
  /** Mantine theme color; overrides the variant default when set. */
  color?: string
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
  ghost: { variant: 'outline', color: 'gray' },
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
      styles,
      color: colorOverride,
      ...props
    },
    ref,
  ) => {
    const settings = variantMap[variant]
    const mantineColor = colorOverride ?? settings.color
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
        color={mantineColor}
        radius={settings.radius ?? 'md'}
        size={sizeMap[size]}
        leftSection={icon && iconPosition === 'left' ? icon : undefined}
        rightSection={icon && iconPosition === 'right' ? icon : undefined}
        loading={loading}
        disabled={loading || disabled}
        style={combinedStyle}
        styles={styles}
        {...props}
      >
        {children}
      </MantineButton>
    )
  },
)

Button.displayName = 'Button'
