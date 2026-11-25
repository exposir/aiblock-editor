import { themeModes } from '../theme/theme.js'
import type { ThemeMode } from '../theme/theme.js'

export type DesktopPlatform = 'darwin' | 'win32' | 'linux'
export type DocumentFileFormat = 'markdown' | 'json' | 'svg'

export interface MarkdownFile {
  readonly name: string
  readonly contents: string
}

export interface SaveFileOptions {
  readonly name: string
  readonly format: DocumentFileFormat
  readonly contents: string
}

export const menuCommands = [
  'new-page', 'import-markdown', 'export-markdown', 'export-json',
  'toggle-pages', 'toggle-outline', 'toggle-comments',
  ...themeModes.map(mode => `theme-${mode}` as const),
] as const

export type DesktopMenuCommand = typeof menuCommands[number]

export const desktopChannels = {
  loadWorkspace: 'workspace:load',
  saveWorkspace: 'workspace:save',
  clearWorkspace: 'workspace:clear',
  openMarkdownFile: 'file:open-markdown',
  saveFile: 'file:save',
  menuCommand: 'menu:command',
  initialTheme: 'theme:initial',
  setTheme: 'theme:set',
  flushWorkspace: 'workspace:flush',
  workspaceFlushed: 'workspace:flushed',
} as const

export interface DesktopBridge {
  readonly platform: DesktopPlatform
  readonly initialTheme?: ThemeMode
  setTheme(mode: ThemeMode): Promise<void>
  loadWorkspace(): Promise<string | null>
  saveWorkspace(raw: string): Promise<void>
  clearWorkspace(): Promise<void>
  openMarkdownFile(): Promise<MarkdownFile | null>
  saveFile(options: SaveFileOptions): Promise<boolean>
  onMenuCommand(listener: (command: DesktopMenuCommand) => void): () => void
  onClosing?(listener: () => void | Promise<void>): () => void
}

declare global {
  interface Window {
    readonly desktop?: DesktopBridge
  }
}

export function getDesktopBridge(): DesktopBridge | undefined {
  return window.desktop
}

export function applyDesktopPlatform(root: HTMLElement, bridge = getDesktopBridge()): void {
  if (bridge) root.dataset.desktopPlatform = bridge.platform
}

export interface WorkspacePersistence {
  read(): string | null
  write(raw: string): boolean | Promise<void>
  clear(): void
  onClosing?(listener: () => void | Promise<void>): () => void
}

export function browserWorkspaceStorage(storage: Storage | null, key: string): WorkspacePersistence {
  return {
    read() {
      try { return storage?.getItem(key) ?? null } catch { return null }
    },
    write(raw) {
      if (!storage) return false
      try { storage.setItem(key, raw); return true } catch { return false }
    },
    clear() {
      try { storage?.removeItem(key) } catch { /* The next save still attempts to persist the workspace. */ }
    },
  }
}

export async function openDesktopWorkspaceStorage(bridge: DesktopBridge): Promise<WorkspacePersistence> {
  const raw = await bridge.loadWorkspace()
  return {
    read: () => raw,
    write: contents => bridge.saveWorkspace(contents),
    clear: () => { void bridge.clearWorkspace().catch(() => {}) },
    onClosing: bridge.onClosing?.bind(bridge),
  }
}

export async function openMarkdownFile(openBrowserPicker: () => void, bridge = getDesktopBridge()): Promise<MarkdownFile | null> {
  if (bridge) return bridge.openMarkdownFile()
  openBrowserPicker()
  return null
}

export function suggestedFileName(title: string, format: DocumentFileFormat): string {
  const stem = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_') || '未命名文档'
  return `${stem}.${format === 'markdown' ? 'md' : format}`
}

export async function saveDocumentFile(
  options: SaveFileOptions,
  download: (options: SaveFileOptions) => void,
  bridge = getDesktopBridge(),
): Promise<boolean> {
  if (bridge) return bridge.saveFile(options)
  download(options)
  return true
}
