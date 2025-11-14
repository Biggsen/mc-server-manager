import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Card as MantineCard, CardSection, Title, Text, Box } from '@mantine/core'

export interface CardProps extends ComponentPropsWithoutRef<typeof MantineCard> {
  children?: ReactNode
  className?: string
}

export const Card = forwardRef<HTMLDivElement, CardProps>((props, ref) => (
  <MantineCard ref={ref} radius="md" shadow="sm" withBorder {...props} />
))
Card.displayName = 'Card'

export interface CardHeaderProps extends ComponentPropsWithoutRef<typeof CardSection> {
  children?: ReactNode
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>((props, ref) => (
  <CardSection ref={ref} inheritPadding py="md" withBorder {...props} />
))
CardHeader.displayName = 'CardHeader'

export interface CardTitleProps extends ComponentPropsWithoutRef<typeof Title> {
  children?: ReactNode
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>((props, ref) => (
  <Title ref={ref} order={4} {...props} />
))
CardTitle.displayName = 'CardTitle'

export interface CardDescriptionProps extends ComponentPropsWithoutRef<typeof Text> {
  children?: ReactNode
}

export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>((props, ref) => (
  <Text ref={ref} size="sm" c="dimmed" {...props} />
))
CardDescription.displayName = 'CardDescription'

export interface CardContentProps extends ComponentPropsWithoutRef<typeof Box> {
  children?: ReactNode
}

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>((props, ref) => (
  <Box ref={ref} p="md" {...props} />
))
CardContent.displayName = 'CardContent'

export interface CardFooterProps extends ComponentPropsWithoutRef<typeof CardSection> {
  children?: ReactNode
}

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>((props, ref) => (
  <CardSection ref={ref} inheritPadding py="md" withBorder {...props} />
))
CardFooter.displayName = 'CardFooter'
