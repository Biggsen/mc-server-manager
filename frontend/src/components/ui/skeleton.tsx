import type { ComponentPropsWithoutRef } from 'react'
import { Skeleton as MantineSkeleton } from '@mantine/core'

export type SkeletonProps = ComponentPropsWithoutRef<typeof MantineSkeleton>

export function Skeleton(props: SkeletonProps) {
  return <MantineSkeleton {...props} />
}
