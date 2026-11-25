import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addPage, createWorkspace, WORKSPACE_STORAGE_KEY } from './page-store'
import { isWorkspaceIndex, splitLegacyWorkspace } from './workspace-format'
import { browserWorkspaceStorage, idbCommit, openWorkspaceDatabase } from './workspace-storage'

const a = '45cc45bf-b55d-48d8-a980-701141d02891'
const b = '45cc45bf-b55d-48d8-a980-701141d02892'
const legacy = addPage(createWorkspace({ id: a, now: 1 }), { id: b, now: 2 }, {
  parentId: a,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '页面 B' }] }] },
})
const split = splitLegacyWorkspace(JSON.stringify(legacy))!

beforeEach(() => localStorage.clear())

describe('Web 工作区分片存储', () => {
  it('两次并发打开只迁移一次，按页读取并保留正文、关系和时间', async () => {
    const factory = new IDBFactory()
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(legacy))
    const tabs = [browserWorkspaceStorage(localStorage, factory), browserWorkspaceStorage(localStorage, factory)]
    await expect(Promise.all(tabs.map(tab => tab.readIndex()))).resolves.toEqual([split.index, split.index])
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull()
    await expect(tabs[0]!.readPage(a)).resolves.toEqual(split.pages[0])
    await expect(tabs[1]!.readPage(b)).resolves.toEqual(split.pages[1])
    expect(isWorkspaceIndex(split.index)).toBe(true)
  })

  it('单独更新分片，删除时将新索引和页移除放进同一个事务', async () => {
    const storage = browserWorkspaceStorage(null, new IDBFactory())
    const { index, pages } = split
    await storage.commit({ index, pages, removedPageIds: [] })
    const page = { ...pages[1]!, updatedAt: 3, content: pages[0]!.content }
    await storage.commit({ pages: [page], removedPageIds: [] })
    await expect(storage.readIndex()).resolves.toEqual(index)
    await expect(storage.readPage(a)).resolves.toEqual(pages[0])
    await expect(storage.readPage(b)).resolves.toEqual(page)
    await expect(storage.commit({ index, pages: [], removedPageIds: [b] })).rejects.toThrow('Invalid workspace changes')
    await storage.commit({ index: { ...index, activePageId: a, pages: [index.pages[0]!] }, pages: [], removedPageIds: [b] })
    await expect(storage.readPage(b)).resolves.toBeNull()
    await expect(storage.readIndex()).resolves.toMatchObject({ activePageId: a, pages: [index.pages[0]] })
  })

  it('支持超过 20 MiB 的多页工作区，IndexedDB-only 写入不依赖本地配额', async () => {
    const browser = browserWorkspaceStorage(null, new IDBFactory())
    const text = 'x'.repeat(11 * 1024 * 1024)
    const pages = split.pages.map(page => ({
      ...page, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    }))
    await browser.commit({ index: split.index, pages, removedPageIds: [] })
    await expect(browser.readIndex()).resolves.toEqual(split.index)
    const loaded = await browser.readPage(b)
    expect(loaded?.content.content?.[0]?.content?.[0]?.text?.length).toBe(text.length)
  })

  it('IndexedDB 暂不可用时仍保留旧快照，重试后可成功迁移', async () => {
    const factory = new IDBFactory()
    const store = browserWorkspaceStorage(localStorage, factory)
    const raw = JSON.stringify(legacy)
    localStorage.setItem(WORKSPACE_STORAGE_KEY, raw)
    vi.spyOn(factory, 'open').mockImplementationOnce(() => { throw new DOMException('Denied', 'SecurityError') })
    await expect(store.readIndex()).rejects.toThrow('Denied')
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(raw)
    await expect(store.readIndex()).resolves.toEqual(split.index)
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull()
  })

  it.each([{ version: 2 }, null])('损坏的 v2 索引 %j 会明确报错，保留分片以供恢复', async invalid => {
    const factory = new IDBFactory()
    const storage = browserWorkspaceStorage(null, factory)
    await storage.commit({ ...split, removedPageIds: [] })
    const db = await openWorkspaceDatabase(factory)
    try {
      const transaction = db.transaction('meta', 'readwrite')
      const committed = idbCommit(transaction)
      transaction.objectStore('meta').put(invalid, 'workspace')
      await committed
      await expect(storage.readIndex()).rejects.toThrow('Invalid workspace index')
      await expect(storage.readPage(b)).resolves.toEqual(split.pages[1])
    } finally {
      db.close()
    }
  })

  it('无 IndexedDB 时分键保存，支持有限存储恢复后提升至 IndexedDB', async () => {
    const store = browserWorkspaceStorage(localStorage)
    localStorage.setItem('unrelated', 'preserve')
    await store.commit({ ...split, removedPageIds: [] })
    await expect(browserWorkspaceStorage(localStorage).readPage(b)).resolves.toEqual(split.pages[1])
    const upgraded = browserWorkspaceStorage(localStorage, new IDBFactory())
    await expect(upgraded.readIndex()).resolves.toEqual(split.index)
    await expect(upgraded.readPage(a)).resolves.toEqual(split.pages[0])
    await expect(store.readIndex()).resolves.toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('preserve')
  })
})
