import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testImage } from '../test/image-fixture'
import { createBrowserAssetStore, removeBrowserImageAssets } from './asset-store'
import { browserWorkspaceStorage } from './workspace-storage'
import type { WorkspaceIndex } from './workspace-format'

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IndexedDB 图片资产', () => {
  it('旧图重新粘贴去重后得到新的宽限期，仍保留原始创建时间', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 600_000)
    const factory = new IDBFactory()
    const assets = createBrowserAssetStore(factory)
    const workspace = browserWorkspaceStorage(null, factory)
    const image = testImage()
    const original = await assets.saveImageAsset(image)
    const id = 'bfe20256-0754-468f-818e-fc40b06abdc4'
    const page = { id, parentId: null, title: 'live', icon: '📄', comments: [], createdAt: 1, updatedAt: 1, order: 0 }
    await workspace.commit({
      index: { version: 2, activePageId: id, pages: [page] },
      pages: [{ id, updatedAt: 1, content: { type: 'doc', content: [{ type: 'paragraph' }] } }],
      removedPageIds: [],
    })
    clock.mockReturnValue(now)
    expect(await assets.saveImageAsset(image)).toEqual(original)
    await expect(workspace.pruneOrphanAssets!()).resolves.toEqual({ removedCount: 0, keptCount: 1 })
    clock.mockReturnValue(now + 300_000)
    await expect(workspace.pruneOrphanAssets!()).resolves.toEqual({ removedCount: 1, keptCount: 0 })
  })

  it('同一事务检查活页和回收站，缺分片时回滚，清空后回收引用消失的资产', async () => {
    const factory = new IDBFactory()
    const assets = createBrowserAssetStore(factory)
    const workspace = browserWorkspaceStorage(null, factory)
    const image = testImage()
    const [kept, protectedImage] = await Promise.all([
      assets.saveImageAsset(image), assets.saveImageAsset({ ...image, bytes: Uint8Array.from([...image.bytes, 1]) }),
    ])
    const id = 'bfe20256-0754-468f-818e-fc40b06abdc4'
    const removedId = 'bfe20256-0754-468f-818e-fc40b06abdc5'
    const page = { id, parentId: null, title: 'live', icon: '📄', comments: [], createdAt: 1, updatedAt: 1, order: 0 }
    const index: WorkspaceIndex = { version: 2, activePageId: id, pages: [page], trash: [{ ...page, id: removedId, deletedAt: 2 }] }
    await workspace.commit({ index, pages: [{ id, updatedAt: 1, content: { type: 'doc' } }], removedPageIds: [] })
    await expect(workspace.pruneOrphanAssets!(0)).rejects.toThrow('missing or invalid page')
    expect(await assets.listMetadata()).toHaveLength(2)
    await workspace.commit({ pages: [{
      id: removedId, updatedAt: 1, content: { type: 'doc', content: [{ type: 'imageBlock', attrs: { assetId: kept.id } }] },
    }], removedPageIds: [] })
    await expect(workspace.pruneOrphanAssets!(0, [protectedImage.id])).resolves.toEqual({ removedCount: 0, keptCount: 2 })
    await workspace.commit({ index: { ...index, trash: [] }, pages: [], removedPageIds: [removedId] })
    await expect(workspace.pruneOrphanAssets!(0, [protectedImage.id])).resolves.toEqual({ removedCount: 1, keptCount: 1 })
    await expect(assets.readImageAssets([kept.id, protectedImage.id])).resolves.toEqual([null, protectedImage])
  })
  it('bytes 和 Blob 按 SHA-256 去重，重新打开后可批量读取元数据', async () => {
    const factory = new IDBFactory()
    const assets = createBrowserAssetStore(factory)
    const image = testImage()
    const [fromBytes, fromBlob] = await Promise.all([
      assets.saveImageAsset(image),
      assets.saveImageAsset({ blob: new Blob([image.bytes], { type: image.mime }), mime: image.mime, width: 1, height: 1 }),
    ])
    expect(fromBytes).toEqual(fromBlob)
    expect(fromBytes).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{64}\.png$/), width: 1, height: 1,
      mime: 'image/png', byteLength: image.bytes.byteLength,
    })
    const reopened = createBrowserAssetStore(factory)
    await expect(reopened.readImageAssets([fromBytes.id, '0'.repeat(64) + '.png', fromBytes.id]))
      .resolves.toEqual([fromBytes, null, fromBytes])
  })

  it('同一资产的并发 URL 请求共享 Blob，最后一次释放才回收', async () => {
    const factory = new IDBFactory()
    const image = testImage()
    const assets = createBrowserAssetStore(factory)
    const metadata = await assets.saveImageAsset(image)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await expect(Promise.all([assets.resolveAssetUrl(metadata.id), assets.resolveAssetUrl(metadata.id)]))
      .resolves.toEqual(['blob:shared', 'blob:shared'])
    expect(create).toHaveBeenCalledOnce()
    await expect(removeBrowserImageAssets([metadata.id], factory)).rejects.toThrow('Image assets are in use')
    const storedBlob = create.mock.calls[0]![0] as Blob
    expect(new Uint8Array(await storedBlob.arrayBuffer())).toEqual(image.bytes)
    assets.releaseAssetUrl(metadata.id)
    expect(revoke).not.toHaveBeenCalled()
    assets.releaseAssetUrl(metadata.id)
    assets.releaseAssetUrl(metadata.id)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:shared')
    await removeBrowserImageAssets([metadata.id], factory)
    await expect(assets.resolveAssetUrl(metadata.id)).resolves.toBeNull()
  })

  it('加载完成前释放，不创建悬空 URL，之后仍能正常打开', async () => {
    const assets = createBrowserAssetStore(new IDBFactory())
    const { id } = await assets.saveImageAsset(testImage())
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:next')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const pending = assets.resolveAssetUrl(id)
    assets.releaseAssetUrl(id)
    await expect(pending).resolves.toBeNull()
    expect(create).not.toHaveBeenCalled()
    await expect(assets.resolveAssetUrl(id)).resolves.toBe('blob:next')
    assets.releaseAssetUrl(id)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:next')
  })

  it('拒绝非法 ID、伪装成 PNG 的内容、SVG 和缺失的 IndexedDB', async () => {
    const assets = createBrowserAssetStore(new IDBFactory())
    await expect(assets.resolveAssetUrl('../index.json')).rejects.toThrow('Invalid asset ID')
    await expect(assets.readImageAssets(['b'.repeat(64) + '.png\n'])).rejects.toThrow('Invalid asset IDs')
    await expect(assets.saveImageAsset({ ...testImage(), mime: 'image/svg+xml' })).rejects.toThrow('Invalid image')
    await expect(assets.saveImageAsset({ ...testImage(), bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow('Invalid image')
    await expect(createBrowserAssetStore().saveImageAsset(testImage())).rejects.toThrow('requires IndexedDB')
  })
  it('releasing a failed acquisition cannot revoke a replacement lease for the same asset', async () => {
    const store = createBrowserAssetStore(new IDBFactory())
    const { id } = await store.saveImageAsset(testImage())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:replacement').mockImplementationOnce(() => {
      throw new Error('Blob allocation failed')
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const failed = store.acquireAssetUrl(id)
    await expect(failed.url).rejects.toThrow('Blob allocation failed')
    const replacement = store.acquireAssetUrl(id)
    await expect(replacement.url).resolves.toBe('blob:replacement')
    failed.release()
    failed.release()
    expect(revoke).not.toHaveBeenCalled()
    replacement.release()
    replacement.release()
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:replacement')
  })
})
