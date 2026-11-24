import { getSchema } from '@tiptap/core'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import { DEMO_HANDBOOK_ID, createDemoWorkspace } from './demo-workspace'
import { WORKSPACE_STORAGE_KEY, findPage } from './page-store'
import type { WorkspaceState } from './page-store'
import { useWorkspace } from './useWorkspace'

const schema = getSchema(createEditorExtensions())
const storageKey = WORKSPACE_STORAGE_KEY
let latest: ReturnType<typeof useWorkspace>

function Probe() {
  latest = useWorkspace(schema)
  return <output>{latest.workspace.activePageId}</output>
}

function mount() {
  return render(<Probe />)
}

function stored() {
  const raw = localStorage.getItem(storageKey)
  return raw ? JSON.parse(raw) as WorkspaceState : null
}

describe('useWorkspace 工作区生命周期', () => {
  /*
   * @partition initial: 无存储、有效存储、损坏存储、旧块地址
   * @partition persistence: 立即变更、350ms 防抖、pagehide、visibilitychange
   * @partition navigation: hashchange、pushState、popstate、未知页面
   * @partition failure: localStorage 写入异常
   * @partition clear-local: reset
   */
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    history.replaceState(null, '', '/')
  })

  it('initial: 首次打开生成四个示例页并立即保存', () => {
    mount()
    expect(latest.workspace.pages).toHaveLength(4)
    expect(latest.anchor).toBeNull()
    expect(stored()?.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(history.scrollRestoration).toBe('manual')
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}`)
  })

  it('initial: 从有效的页面和块地址恢复指定页与块锚点', () => {
    const workspace = createDemoWorkspace(schema)
    localStorage.setItem(storageKey, JSON.stringify(workspace))
    const target = workspace.pages.find(page => page.title === '试点验收清单')!
    history.replaceState(null, '', `/#page=${target.id}&block=pilot-before`)
    mount()
    expect(latest.workspace.activePageId).toBe(target.id)
    expect(latest.anchor).toEqual({ id: 'pilot-before' })
  })

  it('initial: 损坏存储回退示例，旧块链接指向手册页', () => {
    localStorage.setItem(storageKey, '{bad')
    history.replaceState(null, '', '/#block-demo-code')
    mount()
    expect(latest.workspace.pages.map(page => page.title)).toContain('架构设计备忘')
    expect(latest.workspace.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(latest.anchor).toEqual({ id: 'demo-code' })
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}&block=demo-code`)
  })

  it('persistence: 标题变更在 350ms 前不写盘，达到期限才保存', () => {
    mount()
    const original = localStorage.getItem(storageKey)
    const page = findPage(latest.workspace, DEMO_HANDBOOK_ID)!
    act(() => {
      latest.change(current => ({
        ...current, pages: current.pages.map(item => item.id === page.id ? { ...item, title: '临时标题' } : item),
      }), true)
    })
    expect(localStorage.getItem(storageKey)).toBe(original)
    act(() => vi.advanceTimersByTime(349))
    expect(localStorage.getItem(storageKey)).toBe(original)
    act(() => vi.advanceTimersByTime(1))
    expect(findPage(stored()!, DEMO_HANDBOOK_ID)?.title).toBe('临时标题')
  })

  it('persistence: pagehide 与 visibilitychange 会把待写内容立即刷盘', () => {
    mount()
    const page = findPage(latest.workspace, DEMO_HANDBOOK_ID)!
    act(() => latest.change(current => ({ ...current,
      pages: current.pages.map(item => item.id === page.id ? { ...item, title: '离开前标题' } : item),
    }), true))
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(findPage(stored()!, page.id)?.title).toBe('离开前标题')
    act(() => latest.change(current => ({ ...current,
      pages: current.pages.map(item => item.id === page.id ? { ...item, title: '隐藏前标题' } : item),
    }), true))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(findPage(stored()!, page.id)?.title).toBe('隐藏前标题')
  })

  it('failure: localStorage 写入失败时公开 saveFailed 且页面状态仍更新', () => {
    mount()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    act(() => latest.change(current => ({ ...current,
      pages: current.pages.map(page => ({ ...page, title: page.title })),
    })))
    expect(latest.saveFailed).toBe(true)
    setItem.mockRestore()
  })

  it('navigation: hashchange 切到另一页面并清空旧块锚点', () => {
    mount()
    const target = latest.workspace.pages.find(page => page.title === '接口与发布规则')!
    act(() => {
      location.hash = `page=${target.id}&block=release-code`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(latest.workspace.activePageId).toBe(target.id)
    expect(latest.anchor).toEqual({ id: 'release-code' })
    expect(findPage(stored()!, target.id)).toBeDefined()
  })

  it('navigation: 切页 pushState，浏览器后退恢复原页', () => {
    mount()
    const target = latest.workspace.pages.find(page => page.title === '试点验收清单')!
    act(() => {
      latest.change(current => ({ ...current, activePageId: target.id }))
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(location.hash).toBe(`#page=${target.id}`)
    expect(latest.workspace.activePageId).toBe(target.id)
    act(() => {
      latest.change(current => ({ ...current, activePageId: DEMO_HANDBOOK_ID }))
      history.replaceState(null, '', `#page=${DEMO_HANDBOOK_ID}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(latest.workspace.activePageId).toBe(DEMO_HANDBOOK_ID)
  })

  it('navigation: 无效页面地址不会换页，已激活页仍可定位', () => {
    mount()
    act(() => {
      location.hash = 'page=missing'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(latest.workspace.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}`)
  })

  it('clear-local: reset 清理存储并以全新示例页替换当前工作区', () => {
    mount()
    act(() => latest.change(current => ({
      ...current,
      pages: current.pages.map((page, index) => index === 0 ? { ...page, title: '自定义工作区' } : page),
    })))
    const before = latest.revision
    act(() => latest.reset())
    expect(latest.revision).toBe(before + 1)
    expect(latest.workspace.pages.map(page => page.title)[0]).toBe('文档协作与发布手册')
    expect(latest.anchor).toBeNull()
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}`)
    expect(stored()?.pages).toHaveLength(4)
  })
})
