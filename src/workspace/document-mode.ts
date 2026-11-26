export const documentModes = ['preview', 'edit'] as const
export type DocumentMode = typeof documentModes[number]

export const DOCUMENT_MODE_STORAGE_KEY = 'aiblock-editor.mode.v1'

export function isDocumentMode(value: unknown): value is DocumentMode {
  return value === 'preview' || value === 'edit'
}

export function readDocumentMode(host: Window): DocumentMode {
  try {
    const value = host.localStorage.getItem(DOCUMENT_MODE_STORAGE_KEY)
    return isDocumentMode(value) ? value : 'edit'
  } catch {
    return 'edit'
  }
}

export function toggleDocumentMode(mode: DocumentMode): DocumentMode {
  return mode === 'preview' ? 'edit' : 'preview'
}
