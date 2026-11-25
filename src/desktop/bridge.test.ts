import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { WORKSPACE_STORAGE_KEY } from '../workspace/page-store'
import type { WorkspaceState } from '../workspace/page-store'
import {
  applyDesktopPlatform, browserWorkspaceStorage, getDesktopBridge, openDesktopWorkspaceStorage,
  openMarkdownFile, saveDocumentFile, suggestedFileName,
} from './bridge'
import type { DesktopBridge, DesktopMenuCommand, SaveFileOptions } from './bridge'

const markdown = { name: 'desktop.md', contents: '# 原生导入\n\n- [x] 已验收\n' }
const output = { name: '目录/说明', format: 'markdown', contents: '# 文档' } satisfies SaveFileOptions

function nativeProfile(initial: string | null = null) {
  let snapshot = initial
  const menu = new Set<(command: DesktopMenuCommand) => void>()
  const closing = new Set<() => void | Promise<void>>()
  const bridge = {
    platform: 'darwin',
    setTheme: vi.fn<DesktopBridge['setTheme']>().mockResolvedValue(undefined),
    loadWorkspace: vi.fn(async () => snapshot),
    saveWorkspace: vi.fn(async (raw: string) => { snapshot = raw }),
    clearWorkspace: vi.fn(async () => { snapshot = null }),
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
  } satisfies DesktopBridge
  return {
    bridge,
    command(command: DesktopMenuCommand) { act(() => { for (const listener of menu) listener(command) }) },
    async close() { await act(async () => { await Promise.all([...closing].map(listener => listener())) }) },
    saved: () => snapshot ? JSON.parse(snapshot) as WorkspaceState : null,
  }
}

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
  localStorage.clear()
})

describe('desktop capabilities', () => {
  // @partition web: unchanged picker/download and unavailable localStorage
  // @partition native: separate storage, platform and dialogs, including cancellation
  it('keeps browser storage, file picker and download functional without a preload', async () => {
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

    const store = browserWorkspaceStorage(localStorage, WORKSPACE_STORAGE_KEY)
    expect(store.read()).toBeNull()
    expect(store.write('workspace')).toBe(true)
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe('workspace')
    store.clear()
    expect(store.read()).toBeNull()
  })

  it('reports browser persistence failure when storage is unavailable', () => {
    const store = browserWorkspaceStorage(null, WORKSPACE_STORAGE_KEY)
    expect(store.read()).toBeNull()
    expect(store.write('workspace')).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })

  it('delegates native storage and file dialogs and preserves a cancelled export', async () => {
    const { bridge } = nativeProfile('saved snapshot')
    vi.stubGlobal('desktop', bridge)
    expect(getDesktopBridge()).toBe(bridge)
    const root = document.createElement('html')
    applyDesktopPlatform(root)
    expect(root).toHaveAttribute('data-desktop-platform', 'darwin')

    const store = await openDesktopWorkspaceStorage(bridge)
    expect(store.read()).toBe('saved snapshot')
    await store.write('new snapshot')
    expect(await bridge.loadWorkspace()).toBe('new snapshot')
    store.clear()
    expect(await bridge.loadWorkspace()).toBeNull()
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull()

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
    let restore!: (raw: string) => void
    native.bridge.loadWorkspace.mockReturnValueOnce(new Promise(resolve => { restore = resolve }))
    vi.stubGlobal('desktop', native.bridge)
    localStorage.setItem(WORKSPACE_STORAGE_KEY, '独立的浏览器工作区')
    renderApp()
    expect(screen.queryByRole('textbox', { name: '文档标题' })).not.toBeInTheDocument()
    expect(native.bridge.saveWorkspace).not.toHaveBeenCalled()
    await act(async () => { restore(JSON.stringify(record)) })
    expect(title()).toHaveValue('磁盘文档')
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe('独立的浏览器工作区')
  })

  it('does not overwrite disk after a read failure and reopens on retry', async () => {
    const native = nativeProfile()
    native.bridge.loadWorkspace.mockRejectedValueOnce(new Error('Permission denied'))
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    expect(await screen.findByRole('status')).toHaveTextContent('无法读取桌面工作区')
    expect(native.bridge.saveWorkspace).not.toHaveBeenCalled()
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
    expect(screen.queryByRole('complementary', { name: '评论' })).not.toBeInTheDocument()

    native.command('new-page')
    expect(title()).toHaveValue('无标题文档')
    native.command('import-markdown')
    await waitFor(() => expect(title()).toHaveValue('原生导入'))
    expect(native.saved()?.pages).toHaveLength(7)
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
    expect(screen.getByRole('button', { name: '外观：深色，切换为跟随系统' })).toBeInTheDocument()

    native.command('theme-light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    view.unmount()
  })

  it('clears the native profile on a confirmed reset and saves the default workspace', async () => {
    const native = nativeProfile()
    vi.stubGlobal('desktop', native.bridge)
    renderApp()
    await screen.findByRole('textbox', { name: '文档标题' })
    native.command('new-page')
    expect(native.saved()?.pages).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: '重置示例工作区' }))
    expect(native.bridge.clearWorkspace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
    expect(native.bridge.clearWorkspace).toHaveBeenCalledOnce()
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
    native.bridge.saveWorkspace.mockRejectedValueOnce(new Error('Disk full'))
    fireEvent.change(title(), { target: { value: '待重试标题' } })
    expect(await screen.findByRole('status')).toHaveTextContent('无法保存工作区')
    await native.close()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(native.saved()?.pages.some(page => page.title === '待重试标题')).toBe(true)
  })
})
