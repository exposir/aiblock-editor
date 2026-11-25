import { contextBridge, ipcRenderer } from 'electron'
import { desktopChannels as channels, menuCommands } from '../src/desktop/bridge.js'
import type { DesktopBridge, DesktopMenuCommand } from '../src/desktop/bridge.js'
import { isThemeMode } from '../src/theme/theme.js'

const initialTheme: unknown = ipcRenderer.sendSync(channels.initialTheme)
const desktop: DesktopBridge = {
  platform: process.platform as DesktopBridge['platform'],
  initialTheme: isThemeMode(initialTheme) ? initialTheme : undefined,
  setTheme: mode => ipcRenderer.invoke(channels.setTheme, mode),
  loadWorkspace: () => ipcRenderer.invoke(channels.loadWorkspace),
  saveWorkspace: raw => ipcRenderer.invoke(channels.saveWorkspace, raw),
  clearWorkspace: () => ipcRenderer.invoke(channels.clearWorkspace),
  openMarkdownFile: () => ipcRenderer.invoke(channels.openMarkdownFile),
  saveFile: options => ipcRenderer.invoke(channels.saveFile, options),
  onMenuCommand(listener) {
    const receive = (_event: Electron.IpcRendererEvent, command: DesktopMenuCommand) => {
      if (menuCommands.includes(command)) listener(command)
    }
    ipcRenderer.on(channels.menuCommand, receive)
    return () => { ipcRenderer.off(channels.menuCommand, receive) }
  },
  onClosing(listener) {
    const flush = async () => {
      try {
        await listener()
      } finally {
        ipcRenderer.send(channels.workspaceFlushed)
      }
    }
    ipcRenderer.on(channels.flushWorkspace, flush)
    return () => { ipcRenderer.off(channels.flushWorkspace, flush) }
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)
