import { getSchema } from '@tiptap/core'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import { DEMO_HANDBOOK_ID, createDemoWorkspace } from './demo-workspace'
import { WORKSPACE_STORAGE_KEY, activatePage, findPage, removePage, updatePage } from './page-store'
import type { WorkspaceState } from './page-store'
import { useWorkspace } from './useWorkspace'
import { pageMetadata, splitLegacyWorkspace } from './workspace-format'
import type { PageShard, WorkspacePersistence } from './workspace-format'
import { browserWorkspaceStorage } from './workspace-storage'

const schema = getSchema(createEditorExtensions())
const storageKey = WORKSPACE_STORAGE_KEY
let latest: ReturnType<typeof useWorkspace>

function Probe({ persistence }: { persistence?: WorkspacePersistence }) {
  latest = useWorkspace(schema, persistence)
  return <output>{latest.workspace?.activePageId}</output>
}

async function mount(persistence?: WorkspacePersistence) {
  const view = render(<Probe persistence={persistence} />)
  await act(async () => {})
  return view
}

function browser() {
  return browserWorkspaceStorage(localStorage)
}

async function stored(): Promise<WorkspaceState | null> {
  const storage = browser()
  const index = await storage.readIndex()
  if (!index) return null
  const pages = await Promise.all(index.pages.map(async page => ({
    ...page, content: (await storage.readPage(page.id))!.content,
  })))
  return { pages, activePageId: index.activePageId, demoVersion: index.demoVersion }
}

function textDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function seededStorage() {
  const seed = splitLegacyWorkspace(JSON.stringify(createDemoWorkspace(schema)))!
  let index = seed.index
  const pages = new Map(seed.pages.map(page => [page.id, page]))
  const storage = {
    readIndex: vi.fn(async () => index),
    readPage: vi.fn(async id => pages.get(id) ?? null),
    commit: vi.fn<WorkspacePersistence['commit']>(async changes => {
      for (const page of changes.pages) pages.set(page.id, page)
      for (const id of changes.removedPageIds) pages.delete(id)
      if (changes.index) index = changes.index
    }),
  } satisfies WorkspacePersistence
  return { storage, seed, pages }
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

  it('initial: 首次打开生成五个示例页并立即保存', async () => {
    await mount()
    expect(latest.workspace!.pages).toHaveLength(5)
    expect(latest.anchor).toBeNull()
    expect((await stored())?.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(history.scrollRestoration).toBe('manual')
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}`)
  })

  it('initial: 旧示例补入图表页并保留本地修改，删除后刷新不会补回', async () => {
    const workspace = createDemoWorkspace(schema)
    const gallery = workspace.pages.find(page => page.title === '全图种与公式复杂示例')!
    const active = workspace.pages.find(page => page.title === '试点验收清单')!
    const legacy = {
      activePageId: active.id,
      pages: workspace.pages.filter(page => page.id !== gallery.id).map(page =>
        page.id === DEMO_HANDBOOK_ID ? { ...page, title: '本地手册' } : page),
    }
    localStorage.setItem(storageKey, JSON.stringify(legacy))
    const first = await mount()
    expect(latest.workspace!.activePageId).toBe(active.id)
    expect(findPage(latest.workspace!, DEMO_HANDBOOK_ID)?.title).toBe('本地手册')
    expect((await stored())?.pages).toEqual([...legacy.pages, gallery])
    await act(async () => latest.change(current => removePage(current, gallery.id, { id: 'unused', now: 0 })))
    first.unmount()
    await mount()
    expect((await stored())?.pages).toEqual(legacy.pages)
    expect(latest.workspace!.activePageId).toBe(active.id)
  })

  it('initial: 从有效的页面和块地址恢复指定页与块锚点', async () => {
    const workspace = createDemoWorkspace(schema)
    localStorage.setItem(storageKey, JSON.stringify(workspace))
    const target = workspace.pages.find(page => page.title === '试点验收清单')!
    history.replaceState(null, '', `/#page=${target.id}&block=pilot-before`)
    await mount()
    expect(latest.workspace!.activePageId).toBe(target.id)
    expect(latest.anchor).toEqual({ id: 'pilot-before' })
  })

  it('initial: 损坏存储回退示例，旧块链接指向手册页', async () => {
    localStorage.setItem(storageKey, '{bad')
    history.replaceState(null, '', '/#block-demo-code')
    await mount()
    expect(latest.workspace!.pages.map(page => page.title)).toContain('架构设计备忘')
    expect(latest.workspace!.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(latest.anchor).toEqual({ id: 'demo-code' })
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}&block=demo-code`)
  })

  it('persistence: 标题变更在 350ms 前不写盘，达到期限才保存', async () => {
    await mount()
    const original = await browser().readIndex()
    const page = findPage(latest.workspace!, DEMO_HANDBOOK_ID)!
    await act(async () => {
      latest.change(current => ({
        ...current, pages: current.pages.map(item => item.id === page.id ? { ...item, title: '临时标题' } : item),
      }), true)
    })
    expect(await browser().readIndex()).toEqual(original)
    await act(async () => { vi.advanceTimersByTime(349) })
    expect(await browser().readIndex()).toEqual(original)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(findPage((await stored())!, DEMO_HANDBOOK_ID)?.title).toBe('临时标题')
  })

  it('persistence: 连续输入只在最后一次编辑 350ms 后生成快照', async () => {
    await mount()
    const initial = await browser().readPage(DEMO_HANDBOOK_ID)
    const older = vi.fn(() => ({ type: 'doc', content: [{ type: 'paragraph' }] }))
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '最后一个字' }] }] }
    const newest = vi.fn(() => content)
    await act(async () => {
      latest.stageContent(DEMO_HANDBOOK_ID, older)
      vi.advanceTimersByTime(200)
      latest.stageContent(DEMO_HANDBOOK_ID, newest)
      vi.advanceTimersByTime(349)
    })
    expect(older).not.toHaveBeenCalled()
    expect(newest).not.toHaveBeenCalled()
    expect(await browser().readPage(DEMO_HANDBOOK_ID)).toEqual(initial)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(newest).toHaveBeenCalledTimes(1)
    expect(findPage((await stored())!, DEMO_HANDBOOK_ID)?.content).toEqual(content)
  })

  it('navigation: 最后一个字在切页和 pagehide 时立即保存', async () => {
    await mount()
    const next = latest.workspace!.pages.find(page => page.id !== DEMO_HANDBOOK_ID)!
    const content = textDoc
    await act(async () => {
      latest.stageContent(DEMO_HANDBOOK_ID, () => content('切换前'))
      latest.change(workspace => ({ ...workspace, activePageId: next.id }))
    })
    await act(async () => {
      latest.stageContent(next.id, () => content('关页前'))
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(findPage((await stored())!, DEMO_HANDBOOK_ID)?.content).toEqual(content('切换前'))
    expect(findPage((await stored())!, next.id)?.content).toEqual(content('关页前'))
  })

  it('persistence: pagehide 与 visibilitychange 会把待写内容立即刷盘', async () => {
    await mount()
    const page = findPage(latest.workspace!, DEMO_HANDBOOK_ID)!
    await act(async () => latest.change(current => ({ ...current,
      pages: current.pages.map(item => item.id === page.id ? { ...item, title: '离开前标题' } : item),
    }), true))
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(findPage((await stored())!, page.id)?.title).toBe('离开前标题')
    await act(async () => latest.change(current => ({ ...current,
      pages: current.pages.map(item => item.id === page.id ? { ...item, title: '隐藏前标题' } : item),
    }), true))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    visibility.mockRestore()
    expect(findPage((await stored())!, page.id)?.title).toBe('隐藏前标题')
  })

  it('failure: localStorage 写入失败时公开 saveFailed 且页面状态仍更新', async () => {
    await mount()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    await act(async () => latest.change(current => ({ ...current,
      pages: current.pages.map(page => ({ ...page, title: '等待重试' })),
    })))
    expect(latest.saveFailed).toBe(true)
    setItem.mockRestore()
  })

  it('navigation: hashchange 切到另一页面并清空旧块锚点', async () => {
    await mount()
    const target = latest.workspace!.pages.find(page => page.title === '接口与发布规则')!
    await act(async () => {
      location.hash = `page=${target.id}&block=release-code`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(latest.workspace!.activePageId).toBe(target.id)
    expect(latest.anchor).toEqual({ id: 'release-code' })
    expect(findPage((await stored())!, target.id)).toBeDefined()
  })

  it('navigation: 切页 pushState，浏览器后退恢复原页', async () => {
    await mount()
    const target = latest.workspace!.pages.find(page => page.title === '试点验收清单')!
    await act(async () => {
      latest.change(current => ({ ...current, activePageId: target.id }))
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(location.hash).toBe(`#page=${target.id}`)
    expect(latest.workspace!.activePageId).toBe(target.id)
    await act(async () => {
      latest.change(current => ({ ...current, activePageId: DEMO_HANDBOOK_ID }))
      history.replaceState(null, '', `#page=${DEMO_HANDBOOK_ID}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(latest.workspace!.activePageId).toBe(DEMO_HANDBOOK_ID)
  })

  it('navigation: 无效页面地址不会换页，已激活页仍可定位', async () => {
    await mount()
    await act(async () => {
      location.hash = 'page=missing'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(latest.workspace!.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}`)
  })

  it('clear-local: reset 清理存储并以全新示例页替换当前工作区', async () => {
    await mount()
    await act(async () => latest.change(current => ({
      ...current,
      pages: current.pages.map((page, index) => index === 0 ? { ...page, title: '自定义工作区' } : page),
    })))
    const before = latest.revision
    await act(async () => latest.reset())
    expect(latest.revision).toBe(before + 1)
    expect(latest.workspace!.pages.map(page => page.title)[0]).toBe('文档协作与发布手册')
    expect(latest.anchor).toBeNull()
    expect(location.hash).toBe(`#page=${DEMO_HANDBOOK_ID}`)
    expect((await stored())?.pages).toHaveLength(5)
  })
  it('启动只读一次活动分片，标题只写索引，键入只写脏正文', async () => {
    const { storage, seed } = seededStorage()
    const active = seed.index.activePageId
    await mount(storage)
    expect(storage.readPage.mock.calls).toEqual([[active]])
    expect(latest.workspace?.pages.filter(page => page.content).map(page => page.id)).toEqual([active])
    expect(storage.commit).not.toHaveBeenCalled()
    await act(async () => latest.change(workspace => updatePage(workspace, active, { title: '新标题' }, 100)))
    expect(storage.commit).toHaveBeenLastCalledWith({
      index: { ...seed.index, pages: latest.workspace!.pages.map(pageMetadata) },
      pages: [], removedPageIds: [],
    })
    const content = textDoc('新正文')
    await act(async () => {
      latest.stageContent(active, () => content)
      vi.advanceTimersByTime(350)
    })
    expect(storage.commit).toHaveBeenLastCalledWith({
      index: expect.objectContaining({ activePageId: active, version: 2 }),
      pages: [{ id: active, content, updatedAt: expect.any(Number) }], removedPageIds: [],
    })
    expect(storage.readPage).toHaveBeenCalledTimes(1)
  })

  it('快速 A→B→C 时先收集草稿，B 的迟到结果不覆盖 C', async () => {
    const { storage, seed, pages } = seededStorage()
    const a = seed.index.activePageId
    const b = seed.index.pages[1]!.id
    const c = seed.index.pages[2]!.id
    let resolveB!: (page: PageShard) => void
    let resolveC!: (page: PageShard) => void
    const read = storage.readPage.getMockImplementation()!
    storage.readPage.mockImplementation(id => {
      if (id === b) return new Promise(resolve => { resolveB = resolve })
      if (id === c) return new Promise(resolve => { resolveC = resolve })
      return read(id)
    })
    await mount(storage)
    const final = textDoc('A 页最后一字')
    const draft = vi.fn(() => final)
    await act(async () => {
      latest.stageContent(a, draft)
      latest.change(workspace => activatePage(workspace, b))
      expect(draft).toHaveBeenCalledOnce()
      latest.change(workspace => activatePage(workspace, c))
    })
    expect(pages.get(a)?.content).toEqual(final)
    expect(latest.workspace?.activePageId).toBe(c)
    expect(findPage(latest.workspace!, c)?.content).toBeUndefined()
    await act(async () => { resolveC(pages.get(c)!) })
    const stale = { ...pages.get(b)!,
      get content(): PageShard['content'] { throw new Error('Stale page must not be validated') },
    }
    const contentRead = vi.spyOn(stale, 'content', 'get')
    await act(async () => { resolveB(stale) })
    expect(contentRead).not.toHaveBeenCalled()
    expect(latest.workspace?.activePageId).toBe(c)
    expect(findPage(latest.workspace!, c)?.content).toEqual(pages.get(c)!.content)
    expect(findPage(latest.workspace!, b)?.content).toBeUndefined()
    await act(async () => latest.change(workspace => activatePage(workspace, a)))
    expect(findPage(latest.workspace!, a)?.content).toEqual(final)
  })

  it('首个写入失败时保留两页待写草稿，已请求的后一次保存重试成功', async () => {
    const { storage, seed, pages } = seededStorage()
    const a = seed.index.activePageId
    const b = seed.index.pages[1]!.id
    let failFirst!: (error: Error) => void
    storage.commit.mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject }))
    await mount(storage)
    const first = textDoc('A 的草稿')
    const second = textDoc('B 的草稿')
    await act(async () => {
      latest.stageContent(a, () => first)
      latest.change(workspace => activatePage(workspace, b))
    })
    expect(storage.commit).toHaveBeenCalledOnce()
    await act(async () => {
      latest.stageContent(b, () => second)
      window.dispatchEvent(new Event('pagehide'))
      failFirst(new Error('暂时无法写入'))
    })
    expect(storage.commit).toHaveBeenCalledTimes(2)
    expect(pages.get(a)?.content).toEqual(first)
    expect(pages.get(b)?.content).toEqual(second)
    expect(latest.saveFailed).toBe(false)
  })

  it('未激活的损坏分片不会阻塞启动，失败的目标页可重试', async () => {
    const { storage, seed, pages } = seededStorage()
    const target = seed.index.pages[2]!.id
    const valid = pages.get(target)!
    pages.set(target, { ...valid, content: { type: 'doc', content: [{ type: 'unknown' }] } })
    await mount(storage)
    expect(latest.loadFailed).toBe(false)
    expect(storage.readPage).toHaveBeenCalledOnce()
    await act(async () => latest.change(workspace => activatePage(workspace, target)))
    expect(latest.loadFailed).toBe(true)
    expect(storage.commit.mock.lastCall?.[0].pages).toEqual([])
    pages.set(target, valid)
    await act(async () => latest.retry())
    expect(latest.loadFailed).toBe(false)
    expect(findPage(latest.workspace!, target)?.content).toEqual(valid.content)
  })
})
