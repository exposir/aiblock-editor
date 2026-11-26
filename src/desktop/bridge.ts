import { themeModes } from '../theme/theme.js'
import type { PaseoAgentLogs, PaseoLogsOptions, PaseoTreeSnapshot } from '../paseo/paseo-types.js'
import type { ImageAssetInput, ImageAssetMetadata } from '../workspace/asset-format.js'
import type { WorkspaceExternalChange, WorkspacePersistence } from '../workspace/workspace-format.js'
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
  'toggle-theme', 'toggle-mode',
  ...themeModes.map(mode => `theme-${mode}` as const),
] as const

export type DesktopMenuCommand = typeof menuCommands[number]

export const desktopChannels = {
  readIndex: 'workspace:read-index',
  readPage: 'workspace:read-page',
  peekPage: 'workspace:peek-page',
  commit: 'workspace:commit',
  saveImageAsset: 'asset:save-image',
  readImageAssets: 'asset:read-images',
  pruneOrphanAssets: 'asset:prune-orphans',
  openMarkdownFile: 'file:open-markdown',
  saveFile: 'file:save',
  menuCommand: 'menu:command',
  initialTheme: 'theme:initial',
  setTheme: 'theme:set',
  flushWorkspace: 'workspace:flush',
  workspaceFlushed: 'workspace:flushed',
  externalChange: 'workspace:external-change',
  paseoTree: 'paseo:tree',
  paseoLogs: 'paseo:logs',
  paseoChanged: 'paseo:changed',
} as const

export interface DesktopBridge extends WorkspacePersistence {
  readonly platform: DesktopPlatform
  readonly initialTheme?: ThemeMode
  setTheme(mode: ThemeMode): Promise<void>
  saveImageAsset(input: ImageAssetInput): Promise<ImageAssetMetadata>
  readImageAssets(ids: string[]): Promise<(ImageAssetMetadata | null)[]>
  openMarkdownFile(): Promise<MarkdownFile | null>
  saveFile(options: SaveFileOptions): Promise<boolean>
  onMenuCommand(listener: (command: DesktopMenuCommand) => void): () => void
  onExternalChange?(listener: (change: WorkspaceExternalChange) => void): () => void
  readPaseoTree?(): Promise<PaseoTreeSnapshot>
  readPaseoLogs?(agentId: string, options?: PaseoLogsOptions): Promise<PaseoAgentLogs>
  onPaseoChange?(listener: () => void): () => void
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
