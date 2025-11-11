import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface MainCanvasProps extends HTMLAttributes<HTMLElement> {
  padded?: boolean
  bleed?: boolean
}

export const MainCanvas = forwardRef<HTMLElement, MainCanvasProps>(function MainCanvas(
  { className, padded = true, bleed = false, ...props },
  ref,
) {
  return (
    <main
      ref={ref}
      className={cn(
        'main-canvas',
        {
          'main-canvas--padded': padded,
          'main-canvas--bleed': bleed,
        },
        className,
      )}
      {...props}
    />
  )
})


