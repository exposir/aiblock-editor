import { createHash, webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { WORKSPACE_STORAGE_KEY } from '../workspace/page-store'
import { DOCUMENT_MODE_STORAGE_KEY } from '../workspace/document-mode'
import type { WorkspaceState } from '../workspace/page-store'
import { createAssetStore } from '../workspace/asset-store'
import { splitLegacyWorkspace } from '../workspace/workspace-format'
import { finishImageTransfers } from '../editor/extensions/image-block'
import { resetImageUploads } from '../editor/extensions/image-assets'
import { imageCloseGrace } from '../workspace/useWorkspace'
import type { PageShard, WorkspaceCloseResult, WorkspaceCommit, WorkspaceCommitOptions, WorkspaceExternalChange, WorkspaceIndex } from '../workspace/workspace-format'
import { browserWorkspaceStorage } from '../workspace/workspace-storage'
import { testImage } from '../test/image-fixture'
import {
  applyDesktopPlatform, desktopChannels, getDesktopBridge,
  menuCommands, openMarkdownFile, saveDocumentFile, suggestedFileName,
} from './bridge'
import type { DesktopBridge, DesktopMenuCommand, SaveFileOptions } from './bridge'

const markdown = { name: 'desktop.md', contents: '# 原生导入\n\n- [x] 已验收\n' }
const output = { name: '目录/说明', format: 'markdown', contents: '# 文档' } satisfies SaveFileOptions

function nativeProfile(initial: string | null = null) {
  const migrated = initial ? splitLegacyWorkspace(initial) : null
  let index = migrated?.index ?? null
  const pages = new Map(migrated?.pages.map(page => [page.id, page]))
  const menu = new Set<(command: DesktopMenuCommand) => void>()
  const closing = new Set<() => WorkspaceCloseResult | Promise<WorkspaceCloseResult>>()
  const external = new Set<(change: WorkspaceExternalChange) => void>()
  let commitOptions: WorkspaceCommitOptions | undefined
  const bridge = {
    platform: 'darwin',
    initialThemePreset: 'paper',
    setTheme: vi.fn<DesktopBridge['setTheme']>().mockResolvedValue(undefined),
    setThemePreset: vi.fn<NonNullable<DesktopBridge['setThemePreset']>>().mockResolvedValue(undefined),
    readIndex: vi.fn(async () => index),
    readPage: vi.fn(async (id: string) => pages.get(id) ?? null),
    commit: vi.fn(async (changes: WorkspaceCommit, options?: WorkspaceCommitOptions) => {
      commitOptions = options
      if (changes.index) index = changes.index
      for (const page of changes.pages) pages.set(page.id, page)
      for (const id of changes.removedPageIds) pages.delete(id)
    }),
    saveImageAsset: vi.fn<DesktopBridge['saveImageAsset']>(),
    readImageAssets: vi.fn<DesktopBridge['readImageAssets']>(),
    openMarkdownFile: vi.fn<DesktopBridge['openMarkdownFile']>().mockResolvedValue(markdown),
    saveFile: vi.fn<DesktopBridge['saveFile']>().mockResolvedValue(true),
    onMenuCommand(listener) {
      menu.add(listener)
      return () => { menu.delete(listener) }
    },
    onClosing(listener) {
      closing.add(listener)
      return () => { closing.delete(listener) }
    },
    onExternalChange(listener) {
      external.add(listener)
      return () => { external.delete(listener) }
    },
  } satisfies DesktopBridge
  return {
    bridge,
    command(command: DesktopMenuCommand) { act(() => { for (const listener of menu) listener(command) }) },
    async close() {
      const results: WorkspaceCloseResult[] = []
      await act(async () => { results.push(...await Promise.all([...closing].map(listener => listener()))) })
      return results[0]
    },
    saved: () => index && { ...index, pages: index.pages.map(page => ({ ...page, content: pages.get(page.id)?.content })) },
    index: () => index,
    commitOptions: () => commitOptions,
    external(change: WorkspaceExternalChange, nextIndex?: WorkspaceIndex | null, nextPages: readonly PageShard[] = []) {
      if (nextIndex !== undefined) index = nextIndex
      for (const page of nextPages) pages.set(page.id, page)
      act(() => { for (const listener of external) listener(change) })
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
})

afterEach(() => {
  resetImageUploads()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
  localStorage.clear()
})

describe('desktop capabilities', () => {
  // @partition web: unchanged picker/download and unavailable localStorage
  // @partition native: separate storage, platform and dialogs, including cancellation
  it('keeps browser storage, file picker and download functional without a preload', async () => {
    expect(desktopChannels.paseoTree).toBe('paseo:tree')
    expect(desktopChannels.paseoLogs).toBe('paseo:logs')
    expect(desktopChannels.paseoChanged).toBe('paseo:changed')
    expect(getDesktopBridge()).toBeUndefined()
    const root = document.createElement('html')
    applyDesktopPlatform(root)
    expect(root).not.toHaveAttribute('data-desktop-platform')
    const picker = vi.fn()
    const download = vi.fn()
    expect(await openMarkdownFile(picker)).toBeNull()
    expect(picker).toHaveBeenCalledOnce()
    expect(await saveDocumentFile(output, download)).toBe(true)
    expect(download).toHaveBeenCalledExactlyOnceWith(output)

  })

  it('reports unavailable persistence through the no-IndexedDB fallback', async () => {
    const store = browserWorkspaceStorage(null)
    await expect(store.readIndex()).resolves.toBeNull()
    const page: PageShard = {
      id: '6a7fc615-75ff-4d51-8a10-e83183e5a65b', updatedAt: 0,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    }
    await expect(store.commit({ pages: [page], removedPageIds: [] })).rejects.toThrow('Workspace storage is unavailable')
  })

  it('uses the desktop asset protocol and native dialogs, preserving cancellation', async () => {
    const { bridge } = nativeProfile()
    vi.stubGlobal('desktop', bridge)
    expect(getDesktopBridge()).toBe(bridge)
    const root = document.createElement('html')
    applyDesktopPlatform(root)
    expect(root).toHaveAttribute('data-desktop-platform', 'darwin')

    const image = testImage()
    const metadata = { ...image, id: 'a'.repeat(64) + '.png', mime: 'image/png' as const, byteLength: image.bytes.byteLength }
    bridge.saveImageAsset.mockResolvedValueOnce(metadata)
    const assets = createAssetStore()
    await expect(assets.saveImageAsset(image)).resolves.toEqual(metadata)
    expect(bridge.saveImageAsset).toHaveBeenCalledWith(image)
    bridge.readImageAssets.mockResolvedValueOnce([metadata]).mockResolvedValueOnce([null])
    await expect(assets.resolveAssetUrl(metadata.id)).resolves.toBe(`aiblock-asset://media/${metadata.id}`)
    assets.releaseAssetUrl(metadata.id)
    await expect(assets.resolveAssetUrl(metadata.id)).resolves.toBeNull()
    await expect(assets.resolveAssetUrl('../index.json')).rejects.toThrow('Invalid asset IDs')

    const fallback = vi.fn()
    expect(await openMarkdownFile(fallback)).toEqual(markdown)
    bridge.openMarkdownFile.mockResolvedValueOnce(null)
    expect(await openMarkdownFile(fallback)).toBeNull()
    bridge.saveFile.mockResolvedValueOnce(false)
    expect(await saveDocumentFile(output, fallback)).toBe(false)
    expect(bridge.saveFile).toHaveBeenCalledExactlyOnceWith(output)
    expect(fallback).not.toHaveBeenCalled()
    expect(suggestedFileName(output.name, output.format)).toBe('目录_说明.md')
    expect(suggestedFileName('  ', 'json')).toBe('未命名文档.json')
  })
})

function renderApp() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  return render(createElement(App))
}

function title() {
  return screen.getByRole('textbox', { name: '文档标题' })
}

async function pasteDesktopImage(body: HTMLElement) {
  const image = testImage()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close() {} }))
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending-desktop-image')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const file = new File([image.bytes], image.name, { type: image.mime })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => image.bytes.buffer })
  const files = new DataTransfer()
  files.items.add(file)
  await act(async () => {
    fireEvent.paste(body, { clipboardData: files })
    await finishImageTransfers()
  })
  return () => { create.mockRestore(); revoke.mockRestore() }
}

function activeDocument() {
  return screen.findByRole('textbox', { name: '文档正文' }) as Promise<HTMLElement & { editor: Editor }>
}

describe('desktop workspace in App', () => {
  // @partition startup: waits for disk, preserves saved pages and can retry a read failure
  // @partition menu: native commands call the current workspace and active page
  // @partition shutdown: debounced editor changes reach disk and writes can recover
  afterEach(() => { vi.mocked(window.scrollTo).mockRestore() })

  it('waits for native data before mounting, then restores its title and keeps browser data independent', async () => {
    const record: WorkspaceState = {
      activePageId: '6a7fc615-75ff-4d51-8a10-e83183e5a65b',
      pages: [{
        id: '6a7fc615-75ff-4d51-8a10-e83183e5a65b', parentId: null, icon: '📄', title: '磁盘文档',
        content: { type: 'doc', content: [{ type: 'paragraph' }] }, comments: [], createdAt: 0, updatedAt: 0, order: 0,
      }],
    }
    const native = nativeProfile(JSON.stringify(record))
    let restore!: (value: ReturnType<typeof splitLegacyWorkspace>) => void
    native.bridge.readIndex.mockReturnValueOnce(new Promise(resolve => { restore = value => resolve(value?.index ?? null) }))
    vi.stubGlobal('desktop', native.bridge)
    localStorage.setItem(WORKSPACE_STORAGE_KEY, '独立的浏览器工作区')
    renderApp()
    expect(screen.queryByRole('textbox', { name: '文档标题' })).not.toBeInTheDocument()
    expect(native.bridge.commit).not.toHaveBeenCalled()
    await act(async () => { restore(splitLegacyWorkspace(JSON.stringify(record))) })
    expect(title()).toHaveValue('磁盘文档')
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe('独立的浏览器工作区')
  })

  it('silently reloads a clean page and follows an external active-page switch', async () => {
    const idA = '6a7fc615-75ff-4d51-8a10-e83183e5a65b'
    const idB = '6a7fc615-75ff-4d51-8a10-e83183e5a65c'
    const record: WorkspaceState = {
      activePageId: idA,
      pages: [
        { id: idA, parentId: null, icon: '📄', title: '旧标题', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'seed-a' }, content: [{ type: 'text', text: '旧正文' }] }] }, comments: [], createdAt: 0, updatedAt: 0, order: 0 },
        { id: idB, parentId: null, icon: '📄', title: '第二页', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'seed-b' }, content: [{ type: 'text', text: '第二页正文' }] }] }, comments: [], createdAt: 0, updatedAt: 0, order: 1 },
      ],
    }
    const native = nativeProfile(JSON.stringify(record))
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    await waitFor(() => expect(title()).toHaveValue('旧标题'))
    const metadata = (page: WorkspaceState['pages'][number]) => {
      const { content: _content, ...meta } = page
      return meta
    }
    const externalIndex: WorkspaceIndex = {
      version: 2, activePageId: idB,
      pages: record.pages.map(page => ({
        ...metadata(page),
        title: page.id === idB ? '外部第二页' : page.title,
        updatedAt: 2,
      })),
    }
    const externalShard: PageShard = {
      id: idB, updatedAt: 2,
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'external-b' }, content: [{ type: 'text', text: '外部第二页正文' }] }] },
    }
    native.external({ indexChanged: true, pageIds: [idB] }, externalIndex, [externalShard])
    await waitFor(() => expect(title()).toHaveValue('外部第二页'))
    expect(await activeDocument()).toHaveTextContent('外部第二页正文')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a dirty title on conflict and reloads only after explicit confirmation', async () => {
    const id = '6a7fc615-75ff-4d51-8a10-e83183e5a65b'
    const record: WorkspaceState = {
      activePageId: id,
      pages: [{
        id, parentId: null, icon: '📄', title: '磁盘标题',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '磁盘正文' }] }] },
        comments: [], createdAt: 0, updatedAt: 0, order: 0,
      }],
    }
    const native = nativeProfile(JSON.stringify(record))
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    await waitFor(() => expect(title()).toHaveValue('磁盘标题'))
    fireEvent.change(title(), { target: { value: '本地标题' } })
    const { content: _content, ...pageMeta } = record.pages[0]!
    const externalIndex: WorkspaceIndex = {
      version: 2, activePageId: id,
      pages: [{ ...pageMeta, title: '外部标题', updatedAt: 2 }],
    }
    const externalShard: PageShard = {
      id, updatedAt: 2,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '外部正文' }] }] },
    }
    native.external({ indexChanged: true, pageIds: [id] }, externalIndex, [externalShard])
    expect(await screen.findByRole('alert')).toHaveTextContent('本地还有未保存的编辑')
    expect(title()).toHaveValue('本地标题')
    expect(await activeDocument()).toHaveTextContent('磁盘正文')
    fireEvent.click(screen.getByRole('button', { name: '从磁盘重载' }))
    await waitFor(() => expect(title()).toHaveValue('外部标题'))
    expect(await activeDocument()).toHaveTextContent('外部正文')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a dirty page on conflict and explicitly overwrites disk with local content', async () => {
    const id = '6a7fc615-75ff-4d51-8a10-e83183e5a65b'
    const record: WorkspaceState = {
      activePageId: id,
      pages: [{
        id, parentId: null, icon: '📄', title: '页面',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '磁盘正文' }] }] },
        comments: [], createdAt: 0, updatedAt: 0, order: 0,
      }],
    }
    const native = nativeProfile(JSON.stringify(record))
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    const body = await activeDocument()
    await waitFor(() => expect(body.editor.isInitialized).toBe(true))
    act(() => body.editor.commands.setContent('<p>本地正文</p>'))
    const { content: _content, ...pageMeta } = record.pages[0]!
    const externalIndex: WorkspaceIndex = {
      version: 2, activePageId: id,
      pages: [{ ...pageMeta, updatedAt: 2 }],
    }
    native.external({ indexChanged: true, pageIds: [id] }, externalIndex, [{
      id, updatedAt: 2,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '外部正文' }] }] },
    }])
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await activeDocument()).toHaveTextContent('本地正文')
    fireEvent.click(screen.getByRole('button', { name: '用本地覆盖保存' }))
    await waitFor(() => expect(native.commitOptions()?.force).toBe(true))
    await waitFor(() => expect(JSON.stringify(native.saved())).toContain('本地正文'))
    expect(JSON.stringify(native.saved())).not.toContain('外部正文')
  })

  it('does not overwrite disk after a read failure and reopens on retry', async () => {
    const native = nativeProfile()
    native.bridge.readIndex.mockRejectedValueOnce(new Error('Permission denied'))
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('无法读取桌面工作区'))
    expect(native.bridge.commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('textbox', { name: '文档标题' })).toHaveValue('文档协作与发布手册')
  })

  it('routes native menus to the active page, panels and import/export actions', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    const view = renderApp()
    await screen.findByRole('textbox', { name: '文档标题' })
    native.command('toggle-outline')
    expect(screen.getByRole('navigation', { name: '文档章节' })).toBeInTheDocument()
    native.command('toggle-pages')
    expect(screen.getByRole('navigation', { name: '页面树' })).toBeInTheDocument()
    native.command('toggle-comments')
    expect(screen.getByRole('complementary', { name: '评论' })).toBeInTheDocument()
    native.command('toggle-comments')
    expect(screen.queryByRole('complementary', { name: '评论' })).not.toBeInTheDocument()

    native.command('new-page')
    expect(title()).toHaveValue('无标题文档')
    native.command('import-markdown')
    await waitFor(() => expect(title()).toHaveValue('原生导入'))
    await waitFor(() => expect(native.saved()?.pages).toHaveLength(7))
    expect(native.bridge.openMarkdownFile).toHaveBeenCalledOnce()
    native.command('export-markdown')
    native.command('export-json')
    expect(native.bridge.saveFile).toHaveBeenNthCalledWith(1, {
      name: '原生导入', format: 'markdown', contents: expect.stringContaining('- [x] 已验收'),
    })
    expect(native.bridge.saveFile).toHaveBeenNthCalledWith(2, {
      name: '原生导入', format: 'json', contents: expect.stringContaining('"type": "taskList"'),
    })
    view.unmount()
    native.command('export-json')
    expect(native.bridge.saveFile).toHaveBeenCalledTimes(2)
  })

  it('mirrors the native View menu appearance into the rendered workspace', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    const view = renderApp()
    await screen.findByRole('textbox', { name: '文档标题' })
    native.command('theme-dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(native.bridge.setTheme).toHaveBeenLastCalledWith('dark')
    const group = screen.getByRole('radiogroup', { name: '外观主题' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: '深色' })).toHaveAttribute('aria-checked', 'true')

    native.command('theme-light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(document.documentElement.style.colorScheme).toBe('light')

    native.command('theme-preset-notion')
    expect(document.documentElement).toHaveAttribute('data-theme-preset', 'notion')
    expect(native.bridge.setThemePreset).toHaveBeenLastCalledWith('notion')
    expect(document.documentElement.style.getPropertyValue('--bg-workspace')).toBe('#F7F7F5')

    fireEvent.keyDown(window, { key: 'd', metaKey: true, shiftKey: true })
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(menuCommands).toContain('toggle-theme')

    native.command('toggle-theme')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(native.bridge.setTheme).toHaveBeenLastCalledWith('dark')
    expect(within(group).getByRole('radio', { name: '深色' })).toHaveAttribute('aria-checked', 'true')

    native.command('toggle-theme')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(native.bridge.setTheme).toHaveBeenLastCalledWith('light')
    view.unmount()
  })

  it('routes native mode toggles without double-firing the web shortcut', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    const view = renderApp()
    await screen.findByRole('textbox', { name: '文档标题' })
    fireEvent.keyDown(window, { key: 'e', metaKey: true })
    expect(screen.queryByRole('article', { name: '文档预览' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '编辑' })).toHaveAttribute('aria-checked', 'true')
    expect(menuCommands).toContain('toggle-mode')

    native.command('toggle-mode')
    expect(await screen.findByRole('article', { name: '文档预览' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '预览' })).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem(DOCUMENT_MODE_STORAGE_KEY)).toBe('preview')

    native.command('toggle-mode')
    expect(await screen.findByRole('textbox', { name: '文档正文' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '编辑' })).toHaveAttribute('aria-checked', 'true')
    view.unmount()
  })

  it('hot-reloads external content in preview without creating a conflict draft', async () => {
    const id = '6a7fc615-75ff-4d51-8a10-e83183e5a65b'
    const record: WorkspaceState = {
      activePageId: id,
      pages: [{
        id, parentId: null, icon: '📄', title: '磁盘文档',
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'old' }, content: [{ type: 'text', text: '旧正文' }] }] },
        comments: [], createdAt: 0, updatedAt: 0, order: 0,
      }],
    }
    const native = nativeProfile(JSON.stringify(record))
    localStorage.setItem(DOCUMENT_MODE_STORAGE_KEY, 'preview')
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    expect(await screen.findByRole('article', { name: '文档预览' })).toHaveTextContent('旧正文')
    const { content: _content, ...pageMeta } = record.pages[0]!
    const externalIndex: WorkspaceIndex = {
      ...splitLegacyWorkspace(JSON.stringify(record))!.index,
      pages: [{ ...pageMeta, title: '外部标题', updatedAt: 2 }],
    }
    const externalShard: PageShard = {
      id, updatedAt: 2,
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'new' }, content: [{ type: 'text', text: '外部新正文' }] }] },
    }
    native.external({ indexChanged: true, pageIds: [id] }, externalIndex, [externalShard])
    await waitFor(() => expect(screen.getByRole('article', { name: '文档预览' })).toHaveTextContent('外部新正文'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the native profile on a confirmed reset and saves the default workspace', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    await screen.findByRole('textbox', { name: '文档标题' })
    native.command('new-page')
    await waitFor(() => expect(native.saved()?.pages).toHaveLength(6))
    fireEvent.click(screen.getByRole('button', { name: '重置示例工作区' }))
    expect(native.saved()?.pages).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
    await waitFor(() => expect(native.saved()?.pages).toHaveLength(5))
    expect(title()).toHaveValue('文档协作与发布手册')
    expect(native.saved()?.pages).toHaveLength(5)
  })

  it('flushes a pending body edit immediately when the native window requests close', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    const body = await screen.findByRole('textbox', { name: '文档正文' }) as HTMLElement & { editor: Editor }
    act(() => { body.editor.commands.setContent('<p>关窗前的最后修改</p>') })
    expect(JSON.stringify(native.saved())).not.toContain('关窗前的最后修改')
    await native.close()
    expect(JSON.stringify(native.saved())).toContain('关窗前的最后修改')
  })

  it('surfaces native write failure and retries the current snapshot on close', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    await screen.findByRole('textbox', { name: '文档标题' })
    native.bridge.commit.mockRejectedValueOnce(new Error('Disk full'))
    fireEvent.change(title(), { target: { value: '待重试标题' } })
    expect(await screen.findByRole('status')).toHaveTextContent('无法保存工作区')
    await native.close()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(native.saved()?.pages.some(page => page.title === '待重试标题')).toBe(true)
  })
  it('debounces title input and serializes the live body only when the combined save fires', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    const body = await activeDocument()
    await waitFor(() => expect(body.editor.isInitialized).toBe(true))
    expect(await native.close()).toBe('saved')
    native.bridge.commit.mockClear()
    vi.useFakeTimers()
    const json = vi.spyOn(body.editor, 'getJSON')
    act(() => body.editor.commands.setContent('<p>尚未落盘的首段</p>'))
    fireEvent.change(title(), { target: { value: '修' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(180) })
    fireEvent.change(title(), { target: { value: '修订后' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(349) })
    expect(title()).toHaveValue('修订后')
    expect(native.bridge.commit).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(json).toHaveBeenCalledOnce()
    expect(native.bridge.commit).toHaveBeenCalledOnce()
    expect(native.saved()?.pages.find(page => page.title === '修订后')?.content)
      .toMatchObject({ content: [{ content: [{ text: '尚未落盘的首段' }] }] })
    json.mockRestore()
  })

  it('commits body and index after image I/O fails, warns on close, then allows retry without rewriting text', async () => {
    const native = nativeProfile()
    native.bridge.saveImageAsset.mockRejectedValueOnce(new Error('Asset disk full'))
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    const body = await activeDocument()
    await waitFor(() => expect(body.editor.isInitialized).toBe(true))
    act(() => body.editor.commands.setContent('<p>和失败图片同页的正文</p>'))
    const restoreUrls = await pasteDesktopImage(body)
    try {
      fireEvent.change(title(), { target: { value: '包含失败图片的文档' } })
      expect(await native.close()).toBe('images-pending')
      expect(JSON.stringify(native.saved())).toContain('和失败图片同页的正文')
      expect(JSON.stringify(native.saved())).toContain('包含失败图片的文档')
      expect(JSON.stringify(native.saved())).toContain('imageBlock')
      expect(screen.getByText(/图片尚未保存/)).toBeInTheDocument()
      const savedImage = testImage()
      const metadata = { id: createHash('sha256').update(savedImage.bytes).digest('hex') + '.png',
        width: 1, height: 1, byteLength: savedImage.bytes.byteLength, mime: 'image/png' as const }
      native.bridge.saveImageAsset.mockResolvedValue(metadata)
      native.bridge.readImageAssets.mockResolvedValue([metadata])
      native.bridge.commit.mockClear()
      fireEvent.click(screen.getByRole('button', { name: '重试保存图片' }))
      await waitFor(() => expect(screen.queryByText(/图片尚未保存/)).not.toBeInTheDocument())
      expect(await native.close()).toBe('saved')
      expect(native.bridge.commit).not.toHaveBeenCalled()
    } finally {
      restoreUrls()
    }
  })

  it('bounds a hung binary write at close while flushing unsaved text separately', async () => {
    const native = nativeProfile()
    let rejectAsset!: (error: Error) => void
    native.bridge.saveImageAsset.mockReturnValueOnce(new Promise((_, reject) => { rejectAsset = reject }))
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    const body = await activeDocument()
    await waitFor(() => expect(body.editor.isInitialized).toBe(true))
    act(() => body.editor.commands.setContent('<p>关窗前写入正文</p>'))
    const restoreUrls = await pasteDesktopImage(body)
    try {
      vi.useFakeTimers()
      const closing = native.close()
      await vi.advanceTimersByTimeAsync(imageCloseGrace + 1)
      expect(await closing).toBe('images-pending')
      expect(JSON.stringify(native.saved())).toContain('关窗前写入正文')
    } finally {
      await act(async () => { rejectAsset(new Error('结束模拟挂起')) })
      restoreUrls()
    }
  })
})
