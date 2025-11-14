import { forwardRef, type HTMLAttributes } from 'react'
import { Box } from '@mantine/core'

export interface MainCanvasProps extends HTMLAttributes<HTMLElement> {
  padded?: boolean
  bleed?: boolean
}

export const MainCanvas = forwardRef<HTMLElement, MainCanvasProps>(function MainCanvas(
  { className, padded = true, bleed = false, ...props },
  ref,
) {
  return (
    <Box
      component="main"
      ref={ref}
      className={className}
      px={padded && !bleed ? 'lg' : 0}
      py={padded ? 'lg' : 0}
      {...props}
    />
  )
})
