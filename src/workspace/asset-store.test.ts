import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testImage } from '../test/image-fixture'
import { createBrowserAssetStore, removeBrowserImageAssets } from './asset-store'

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IndexedDB 图片资产', () => {
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
