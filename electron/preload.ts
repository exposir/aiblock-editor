import { contextBridge, ipcRenderer } from 'electron'
import { desktopChannels as channels, menuCommands } from '../src/desktop/bridge.js'
import type { DesktopBridge, DesktopMenuCommand } from '../src/desktop/bridge.js'
import { isThemeMode } from '../src/theme/theme.js'
import { isThemePresetId } from '../src/theme/theme-presets.js'
import { validateImageInput } from '../src/workspace/asset-format.js'
import { isWorkspaceExternalChange } from '../src/workspace/workspace-format.js'

const initialTheme: unknown = ipcRenderer.sendSync(channels.initialTheme)
const initialThemePreset: unknown = ipcRenderer.sendSync(channels.initialThemePreset)
const desktop: DesktopBridge = {
  platform: process.platform as DesktopBridge['platform'],
  initialTheme: isThemeMode(initialTheme) ? initialTheme : undefined,
  initialThemePreset: isThemePresetId(initialThemePreset) ? initialThemePreset : undefined,
  setTheme: mode => ipcRenderer.invoke(channels.setTheme, mode),
  setThemePreset: preset => ipcRenderer.invoke(channels.setThemePreset, preset),
  readIndex: () => ipcRenderer.invoke(channels.readIndex),
  readPage: id => ipcRenderer.invoke(channels.readPage, id),
  peekPage: id => ipcRenderer.invoke(channels.peekPage, id),
  commit: (changes, options) => ipcRenderer.invoke(channels.commit, { changes, options }),
  async saveImageAsset(input) {
    validateImageInput(input)
    return ipcRenderer.invoke(channels.saveImageAsset, input)
  },
  readImageAssets: ids => ipcRenderer.invoke(channels.readImageAssets, ids),
  pruneOrphanAssets: (graceMs, protectedIds) => ipcRenderer.invoke(channels.pruneOrphanAssets, { graceMs, protectedIds }),
  openMarkdownFile: () => ipcRenderer.invoke(channels.openMarkdownFile),
  saveFile: options => ipcRenderer.invoke(channels.saveFile, options),
  onMenuCommand(listener) {
    const receive = (_event: Electron.IpcRendererEvent, command: DesktopMenuCommand) => {
      if (menuCommands.includes(command)) listener(command)
    }
    ipcRenderer.on(channels.menuCommand, receive)
    return () => { ipcRenderer.off(channels.menuCommand, receive) }
  },
  onExternalChange(listener) {
    const receive = (_event: Electron.IpcRendererEvent, change: unknown) => {
      if (isWorkspaceExternalChange(change)) listener(change)
    }
    ipcRenderer.on(channels.externalChange, receive)
    return () => { ipcRenderer.off(channels.externalChange, receive) }
  },
  readPaseoTree: () => ipcRenderer.invoke(channels.paseoTree),
  readPaseoLogs: (agentId, options) => ipcRenderer.invoke(channels.paseoLogs, agentId, options),
  onPaseoChange(listener) {
    const receive = () => listener()
    ipcRenderer.on(channels.paseoChanged, receive)
    return () => { ipcRenderer.off(channels.paseoChanged, receive) }
  },
  onClosing(listener) {
    const flush = async (_event: Electron.IpcRendererEvent, requestId: string) => {
      try {
        const result = await listener()
        ipcRenderer.send(channels.workspaceFlushed, requestId, result)
      } catch {
        ipcRenderer.send(channels.workspaceFlushed, requestId, 'workspace-failed')
      }
    }
    ipcRenderer.on(channels.flushWorkspace, flush)
    return () => { ipcRenderer.off(channels.flushWorkspace, flush) }
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)
