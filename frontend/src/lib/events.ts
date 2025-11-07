const PROJECTS_UPDATED = 'projects:updated'

export function emitProjectsUpdated(): void {
  window.dispatchEvent(new CustomEvent(PROJECTS_UPDATED))
}

export function subscribeProjectsUpdated(callback: () => void): () => void {
  window.addEventListener(PROJECTS_UPDATED, callback)
  return () => window.removeEventListener(PROJECTS_UPDATED, callback)
}

