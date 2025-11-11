export type ClassValue = string | number | null | false | undefined | ClassValue[]

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
    classes.push(String(value))
  }

  inputs.forEach(push)

  return classes.join(' ')
}


