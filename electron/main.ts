import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, screen, shell } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopChannels as channels, suggestedFileName } from '../src/desktop/bridge.js'
import type { WorkspaceCloseResult, WorkspaceCommitOptions, WorkspaceExternalChange } from '../src/workspace/workspace-format.js'
import type { DesktopMenuCommand } from '../src/desktop/bridge.js'
import { isThemeMode, parseThemeMode, themeBackgrounds, themeLabels, themeModes } from '../src/theme/theme.js'
import type { ThemeMode } from '../src/theme/theme.js'
import { decideNavigation, developmentUrl, externalUrl, isAppDocument } from './security.js'
import { createImageAssetFiles, createWorkspaceFiles, isSaveFileOptions, readMarkdownFile, readOptionalText, writeAtomicText } from './storage.js'
import { WorkspaceConflictError, WorkspaceLockedError } from '../src/workspace/workspace-files.js'
import { watchWorkspace } from './workspace-watcher.js'
import type { WorkspaceWatcher } from './workspace-watcher.js'
import { minimumWindowSize, parseWindowState, restoreWindowState } from './window-state.js'

const isMac = process.platform === 'darwin'
const productionPage = pathToFileURL(join(app.getAppPath(), 'dist', 'index.html')).href
function rendererUrl() {
  const dev = app.isPackaged ? undefined : process.env.LARK_EDITOR_DEV_URL
  if (dev === undefined) return productionPage
  const url = developmentUrl(dev)
  if (!url) throw new Error('Electron development requires a loopback Vite URL')
  return url
}

const appUrl = rendererUrl()

let mainWindow: BrowserWindow | null = null
let openingWindow = false
let quitting = false
let workspaceWatcher: WorkspaceWatcher | undefined

function reportError(error: unknown) {
  console.error(error)
}

function openExternal(target: string) {
  const url = externalUrl(target)
  if (url) void shell.openExternal(url).catch(reportError)
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return event.sender === mainWindow?.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    isAppDocument(event.senderFrame.url, appUrl)
}

function installNavigationPolicy(window: BrowserWindow) {
  const { webContents } = window
  webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, appUrl)
    if (decision.kind === 'external') openExternal(decision.url)
    return { action: 'deny' }
  })
  webContents.on('will-navigate', event => {
    const decision = decideNavigation(event.url, appUrl)
    if (decision.kind === 'allow') return
    event.preventDefault()
    if (decision.kind === 'external') openExternal(decision.url)
  })
  webContents.on('will-frame-navigate', event => {
    if (!event.isMainFrame) event.preventDefault()
  })
  webContents.on('will-redirect', event => {
    if (!event.isMainFrame || !isAppDocument(event.url, appUrl)) event.preventDefault()
  })
  webContents.on('will-attach-webview', event => event.preventDefault())

  const clipboardAllowed = (contents: Electron.WebContents | null, permission: string, mainFrame: boolean) =>
    permission === 'clipboard-sanitized-write' && mainFrame && contents === mainWindow?.webContents &&
    isAppDocument(contents.getURL(), appUrl)
  webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    clipboardAllowed(contents, permission, details.isMainFrame))
  webContents.session.setPermissionRequestHandler((contents, permission, reply, details) => {
    reply(clipboardAllowed(contents, permission, details.isMainFrame))
  })
}

function windowBackground() {
  return themeBackgrounds[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
}

function installTheme(path: string) {
  let pending = Promise.resolve()
  function updateWindow() {
    mainWindow?.setBackgroundColor(windowBackground())
  }
  nativeTheme.on('updated', updateWindow)
  ipcMain.on(channels.initialTheme, event => {
    event.returnValue = isTrustedSender(event) ? nativeTheme.themeSource : null
  })

  function setTheme(mode: ThemeMode): Promise<void> {
    if (nativeTheme.themeSource === mode) return pending
    nativeTheme.themeSource = mode
    updateWindow()
    const item = Menu.getApplicationMenu()?.getMenuItemById(`theme-${mode}`)
    if (item) item.checked = true
    pending = pending.then(() => writeAtomicText(path, mode)).catch(reportError)
    return pending
  }

  trustedHandler(channels.setTheme, (_window, mode) => {
    if (!isThemeMode(mode)) throw new TypeError('Invalid theme preference')
    return setTheme(mode)
  })
  return { setTheme, drain: () => pending }
}

function installMenu(setTheme: (mode: ThemeMode) => Promise<void>) {
  function action(label: string, command: DesktopMenuCommand, accelerator?: string): MenuItemConstructorOptions {
    return {
      label, accelerator,
      click: () => mainWindow?.webContents.send(channels.menuCommand, command),
    }
  }

  const menu: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        action('新建页面', 'new-page', 'CmdOrCtrl+N'),
        action('导入 Markdown…', 'import-markdown', 'CmdOrCtrl+O'),
        { type: 'separator' },
        action('导出 Markdown…', 'export-markdown', 'CmdOrCtrl+Shift+E'),
        action('导出 JSON…', 'export-json'),
        { type: 'separator' }, { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        action('切换页面侧栏', 'toggle-pages', 'CmdOrCtrl+Shift+1'),
        action('切换目录侧栏', 'toggle-outline', 'CmdOrCtrl+Shift+2'),
        action('切换评论侧栏', 'toggle-comments', 'CmdOrCtrl+Shift+3'),
        { type: 'separator' },
        {
          label: '外观',
          submenu: themeModes.map(mode => ({
            id: `theme-${mode}`,
            label: themeLabels[mode],
            type: 'radio',
            checked: nativeTheme.themeSource === mode,
            click: () => {
              void setTheme(mode)
              mainWindow?.webContents.send(channels.menuCommand, `theme-${mode}`)
            },
          })),
        },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu))
}

function trustedHandler(channel: string, handle: (window: BrowserWindow, value: unknown) => unknown) {
  ipcMain.handle(channel, (event, value: unknown) => {
    if (!mainWindow || !isTrustedSender(event)) throw new Error('Untrusted desktop IPC sender')
    return handle(mainWindow, value)
  })
}

function installFileHandlers(
  workspace: ReturnType<typeof createWorkspaceFiles>,
  assets: ReturnType<typeof createImageAssetFiles>,
) {
  trustedHandler(channels.readIndex, () => workspace.readIndex())
  trustedHandler(channels.readPage, (_window, id) => workspace.readPage(id))
  trustedHandler(channels.commit, async (_window, payload) => {
    const envelope = payload && typeof payload === 'object' && 'changes' in payload
      ? payload as { changes: unknown; options?: WorkspaceCommitOptions }
      : { changes: payload }
    try {
      await workspace.commit(envelope.changes, envelope.options)
      return { conflict: false }
    } catch (error) {
      if (error instanceof WorkspaceConflictError) return { conflict: true, files: error.files }
      if (error instanceof WorkspaceLockedError) return { conflict: true, files: [], locked: true }
      throw error
    }
  })
  trustedHandler(channels.saveImageAsset, (_window, input) => assets.save(input))
  trustedHandler(channels.readImageAssets, (_window, ids) => assets.readMetadata(ids))
  trustedHandler(channels.openMarkdownFile, async window => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
    const path = filePaths[0]
    return canceled || !path ? null : readMarkdownFile(path)
  })
  trustedHandler(channels.saveFile, async (window, options) => {
    if (!isSaveFileOptions(options)) throw new TypeError('Invalid document export')
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath: join(app.getPath('documents'), suggestedFileName(options.name, options.format)),
      filters: [{
        name: options.format === 'markdown' ? 'Markdown' : options.format.toUpperCase(),
        extensions: options.format === 'markdown' ? ['md', 'markdown'] : [options.format],
      }],
    })
    if (canceled || !filePath) return false
    await writeAtomicText(filePath, options.contents)
    return true
  })
}

function flushRenderer(window: BrowserWindow): Promise<WorkspaceCloseResult> {
  const contents = window.webContents
  if (contents.isCrashed() || !isAppDocument(contents.getURL(), appUrl)) return Promise.resolve('saved')
  const requestId = randomUUID()
  return new Promise(resolve => {
    function finish(saved: WorkspaceCloseResult) {
      clearTimeout(timeout)
      ipcMain.off(channels.workspaceFlushed, acknowledge)
      resolve(saved)
    }
    function acknowledge(event: IpcMainEvent, id: unknown, saved: unknown) {
      if (id === requestId && isTrustedSender(event)) {
        finish(saved === 'saved' || saved === 'images-pending' ? saved : 'workspace-failed')
      }
    }
    const timeout = setTimeout(() => finish('workspace-failed'), 10_000)
    ipcMain.on(channels.workspaceFlushed, acknowledge)
    try { contents.send(channels.flushWorkspace, requestId) } catch { finish('workspace-failed') }
  })
}

async function createWindow(
  statePath: string,
  theme: ReturnType<typeof installTheme>,
  watcher: WorkspaceWatcher,
) {
  if (openingWindow || mainWindow) return
  openingWindow = true
  try {
    const primary = screen.getPrimaryDisplay()
    const otherDisplays = screen.getAllDisplays().filter(display => display.id !== primary.id)
    const raw = await readOptionalText(statePath).catch(() => null)
    const saved = restoreWindowState(parseWindowState(raw), primary.workArea, otherDisplays.map(display => display.workArea))
    const window = new BrowserWindow({
      ...saved.bounds,
      minWidth: minimumWindowSize.width,
      minHeight: minimumWindowSize.height,
      backgroundColor: windowBackground(),
      show: false,
      ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 17 } } : {}),
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    mainWindow = window
    installNavigationPolicy(window)
    window.on('focus', () => watcher.refresh())
    window.webContents.on('did-finish-load', () => watcher.refresh())
    window.once('ready-to-show', () => {
      if (saved.maximized) window.maximize()
      window.show()
    })
    window.webContents.on('render-process-gone', (_event, details) => reportError(details))
    let closing = false
    let closeAllowed = false
    window.on('close', event => {
      if (closeAllowed) return
      event.preventDefault()
      if (closing) return
      closing = true
      const state = { bounds: window.getNormalBounds(), maximized: window.isMaximized() }
      void Promise.allSettled([
        flushRenderer(window),
        writeAtomicText(statePath, JSON.stringify(state)),
        theme.drain(),
      ]).then(async results => {
        for (const result of results) {
          if (result.status === 'rejected') reportError(result.reason)
        }
        const result = results[0]
        const saved = result?.status === 'fulfilled' ? result.value : 'workspace-failed'
        if (saved !== 'saved') {
          const images = saved === 'images-pending'
          const { response } = await dialog.showMessageBox(window, {
            type: 'warning',
            title: '关闭工作区',
            message: images ? '部分图片尚未保存' : '工作区尚未确认保存',
            detail: images
              ? '正文和页面已保存。返回工作区可等待或重试图片保存。现在关闭可能丢失这些图片。'
              : '返回工作区可继续保存。现在关闭可能丢失未写入的修改。',
            buttons: ['返回工作区', '仍要关闭'],
            defaultId: 0,
            cancelId: 0,
          })
          if (response !== 1) {
            closing = false
            quitting = false
            return
          }
        }
        closeAllowed = true
        if (quitting) app.quit()
        else window.close()
      }).catch(error => {
        closing = false
        quitting = false
        reportError(error)
      })
    })
    window.on('closed', () => { mainWindow = null })
    await window.loadURL(appUrl)
  } finally {
    openingWindow = false
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'lark-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

if (app.requestSingleInstanceLock()) {
  app.on('before-quit', () => { quitting = true; workspaceWatcher?.close() })
  process.on('SIGINT', () => app.quit())
  process.on('SIGTERM', () => app.quit())
  if (appUrl !== productionPage) process.stdin.once('end', () => app.quit()).resume()
  app.on('window-all-closed', () => { if (!isMac) app.quit() })
  void app.whenReady().then(async () => {
    const directory = app.getPath('userData')
    const workspace = createWorkspaceFiles(directory)
    const watcher = watchWorkspace(workspace, (change: WorkspaceExternalChange) => {
      const window = mainWindow
      if (!window || window.webContents.isDestroyed() || !isAppDocument(window.webContents.getURL(), appUrl)) return
      window.webContents.send(channels.externalChange, change)
    })
    workspaceWatcher = watcher
    const assets = createImageAssetFiles(directory)
    protocol.handle('lark-asset', request => assets.respond(request, appUrl))
    const statePath = join(directory, 'window-state.json')
    const themePath = join(directory, 'theme')
    nativeTheme.themeSource = parseThemeMode(await readOptionalText(themePath).catch(() => null))
    const theme = installTheme(themePath)
    const showWindow = () => createWindow(statePath, theme, watcher)
    installFileHandlers(workspace, assets)
    installMenu(theme.setTheme)
    app.on('activate', () => { void showWindow().catch(reportError) })
    app.on('second-instance', () => {
      if (!mainWindow) {
        void showWindow().catch(reportError)
        return
      }
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })
    await showWindow()
  }).catch(error => {
    reportError(error)
    app.exit(1)
  })
} else {
  app.quit()
}
