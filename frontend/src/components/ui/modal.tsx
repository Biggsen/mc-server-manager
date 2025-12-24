import { type ReactNode } from 'react'
import { Modal as MantineModal, type MantineStyleProp } from '@mantine/core'

export interface ModalProps {
  opened: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | string | number
  centered?: boolean
  styles?: {
    body?: MantineStyleProp
    content?: MantineStyleProp
  }
}

export function Modal({ opened, onClose, title, children, size = 'md', centered = false, styles }: ModalProps) {
  return (
    <MantineModal opened={opened} onClose={onClose} title={title} size={size} centered={centered} styles={styles}>
      {children}
    </MantineModal>
  )
}

