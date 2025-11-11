export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | Record<string, boolean>

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = []

  const push = (value: ClassValue) => {
    if (!value) {
      return
    }
    if (Array.isArray(value)) {
      value.forEach(push)
      return
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, active]) => {
        if (active) {
          classes.push(key)
        }
      })
      return
    }
    classes.push(String(value))
  }

  inputs.forEach(push)

  return classes.join(' ')
}


