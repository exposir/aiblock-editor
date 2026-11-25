import { describe, expect, it } from 'vitest'
import { collectReferencedAssetIds, selectOrphanAssetIds } from './asset-gc'

const a = 'a'.repeat(64) + '.png'
const b = 'b'.repeat(64) + '.webp'
const c = 'c'.repeat(64) + '.jpg'
const d = 'd'.repeat(64) + '.png'

describe('asset GC', () => {
  // @partition references: nested images, local URLs and malformed records
  // @partition eligibility: reachable, aged, fresh, future and legacy assets
  it('references: combines nested image IDs and local image URLs across documents', () => {
    const result = collectReferencedAssetIds({ type: 'doc', content: [
      { type: 'toggle', content: [{ type: 'imageBlock', attrs: { assetId: a, src: 'asset:' + b } }] },
      { type: 'image', attrs: { src: 'aiblock-asset://media/' + a } },
      { type: 'imageBlock', attrs: { src: 'https://example.test/' + c } },
      { type: 'paragraph', content: [{ type: 'text', text: 'asset:' + c }] },
    ] }, new Set([d]))
    expect(result).toEqual(new Set([a, b, d]))
    expect(() => collectReferencedAssetIds({ type: 'doc', content: [null] } as never)).toThrow()
  })

  it('eligibility: retains referenced and young files and treats the grace boundary as eligible', () => {
    const now = 600_000
    expect(selectOrphanAssetIds([
      { id: a }, { id: b, createdAt: now - 300_000 }, { id: c, createdAt: now - 299_999 },
      { id: d, createdAt: now + 1 }, { id: '../bad.png' },
    ], new Set([a]), now)).toEqual([b])
    expect(selectOrphanAssetIds([{ id: a }, { id: a }, { id: b, createdAt: now }], new Set(), now, 0)).toEqual([a, b])
  })
})
