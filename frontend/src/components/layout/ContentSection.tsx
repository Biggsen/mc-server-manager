import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'
import { Paper } from '@mantine/core'

type ContentElement = 'section' | 'article' | 'div'

export interface ContentSectionProps extends HTMLAttributes<HTMLElement> {
  as?: ContentElement
  tone?: 'default' | 'subtle'
  padding?: 'sm' | 'md' | 'lg' | 'xl'
}

export const ContentSection = forwardRef<HTMLElement, ContentSectionProps>(function ContentSection(
  { as = 'section', className, tone = 'default', padding = 'lg', ...props },
  ref,
) {
  return (
    <Paper
      ref={ref}
      component={as as 'section'}
      className={className}
      shadow={tone === 'default' ? 'sm' : 'xs'}
      radius="md"
      withBorder={tone === 'default'}
      p={padding}
      {...props}
    />
  )
})
