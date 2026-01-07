import { type ReactNode } from 'react'
import { Modal as MantineModal, type ModalBaseStylesNames } from '@mantine/core'
import type { CSSProperties } from 'react'

export interface ModalProps {
  opened: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | string | number
  centered?: boolean
  styles?: Partial<Record<ModalBaseStylesNames, CSSProperties>>
}

export function Modal({ opened, onClose, title, children, size = 'md', centered = false, styles }: ModalProps) {
  return (
    <MantineModal opened={opened} onClose={onClose} title={title} size={size} centered={centered} styles={styles}>
      {children}
    </MantineModal>
  )
}

