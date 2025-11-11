import { createElement, forwardRef } from 'react'
import { cn } from '../../lib/cn'

type ContentElement = 'section' | 'article' | 'div'

export interface ContentSectionProps extends React.HTMLAttributes<HTMLElement> {
  as?: ContentElement
  tone?: 'default' | 'subtle'
}

export const ContentSection = forwardRef<HTMLElement, ContentSectionProps>(function ContentSection(
  { as: Component = 'section', className, tone = 'default', ...props },
  ref,
) {
  return createElement(Component, {
    ref,
    className: cn('content-section', `content-section--${tone}`, className),
    ...props,
  })
})


