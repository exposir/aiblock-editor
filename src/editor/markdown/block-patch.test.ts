import { describe, expect, it } from 'vitest'
import { createDocumentSchema } from '../schema'
import {
  BlockPatchError, extractDocumentOutline, listTopLevelBlocks, patchDocument, sliceDocumentMarkdown,
} from './block-patch'
import { docToMarkdown } from './markdown-codec'

const schema = createDocumentSchema()

function paragraph(blockId: string, value: string, marked = false) {
  return {
    type: 'paragraph', attrs: { blockId },
    content: [{ type: 'text', text: value, ...(marked ? { marks: [{ type: 'comment', attrs: { commentId: 'thread-1' } }] } : {}) }],
  }
}

function heading(blockId: string, level: number, value: string) {
  return { type: 'heading', attrs: { blockId, level }, content: [{ type: 'text', text: value }] }
}

function image(blockId: string) {
  return {
    type: 'imageBlock',
    attrs: { blockId, src: 'https://example.test/a.png', alt: '图', width: 800, height: 600, displayWidth: 640, align: 'left' },
  }
}

function table(blockId: string) {
  return {
    type: 'table', attrs: { blockId },
    content: [{
      type: 'tableRow', content: [{
        type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [140] },
        content: [paragraph('cell-1', '表头')],
      }],
    }],
  }
}

function document(...content: object[]) {
  return schema.nodeFromJSON({ type: 'doc', content })
}

const doc = document(
  heading('h1', 1, '总览'),
  paragraph('p1', '正文一', true),
  heading('h2', 2, '小节'),
  paragraph('p2', '正文二'),
  heading('h3', 3, '子节'),
  paragraph('p3', '正文三'),
  heading('h2b', 2, '下一节'),
  paragraph('p4', '正文四'),
  image('image-1'),
  table('table-1'),
)

function patchError(run: () => unknown, code: BlockPatchError['code']) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(BlockPatchError)
    expect((error as BlockPatchError).code).toBe(code)
    return
  }
  throw new Error('Expected BlockPatchError')
}

describe('block patch document views', () => {
  // @partition outline: headings only, top-level block count and indexes
  // @partition blocks: type and truncated preview for every top-level block
  it('extracts headings with block indexes and a lightweight top-level summary', () => {
    expect(extractDocumentOutline(doc)).toEqual({
      blockCount: 10,
      outline: [
        { blockId: 'h1', level: 1, text: '总览', blockIndex: 0 },
        { blockId: 'h2', level: 2, text: '小节', blockIndex: 2 },
        { blockId: 'h3', level: 3, text: '子节', blockIndex: 4 },
        { blockId: 'h2b', level: 2, text: '下一节', blockIndex: 6 },
      ],
    })
    const long = document(paragraph('long', 'x'.repeat(120)))
    expect(listTopLevelBlocks(long)).toEqual([{ blockId: 'long', type: 'paragraph', preview: 'x'.repeat(80) }])
    expect(listTopLevelBlocks(doc).map(block => block.type)).toEqual([
      'heading', 'paragraph', 'heading', 'paragraph', 'heading', 'paragraph', 'heading', 'paragraph', 'imageBlock', 'table',
    ])
  })

  // @partition slice-block: one block, missing target and block comments
  // @partition slice-section: level boundary, non-heading target and exact legacy output
  it('slices a block or a heading section without changing legacy Markdown by default', () => {
    expect(sliceDocumentMarkdown(doc)).toBe(docToMarkdown(doc))
    expect(sliceDocumentMarkdown(doc, { blockId: 'p2' })).toBe('正文二\n')
    expect(sliceDocumentMarkdown(doc, { blockId: 'p2', withBlockIds: true })).toBe('<!-- block:p2 -->\n正文二\n')
    expect(sliceDocumentMarkdown(doc, { sectionBlockId: 'h2' })).toBe(docToMarkdown(document(
      heading('h2', 2, '小节'), paragraph('p2', '正文二'), heading('h3', 3, '子节'), paragraph('p3', '正文三'),
    )))
    const section = sliceDocumentMarkdown(doc, { sectionBlockId: 'h2', withBlockIds: true })
    expect(section).toContain('<!-- block:h2 -->')
    expect(section).toContain('<!-- block:p2 -->')
    expect(section).toContain('<!-- block:h3 -->')
    expect(section).toContain('<!-- block:p3 -->')
    expect(section).not.toContain('<!-- block:h2b -->')
    const full = sliceDocumentMarkdown(doc, { withBlockIds: true })
    expect(full.match(/<!-- block:/g)).toHaveLength(10)
    expect(full.startsWith('<!-- block:h1 -->\n# 总览')).toBe(true)
    patchError(() => sliceDocumentMarkdown(doc, { blockId: 'missing' }), 'block_not_found')
    patchError(() => sliceDocumentMarkdown(doc, { sectionBlockId: 'p2' }), 'invalid_target')
  })
})

describe('block patch operations', () => {
  // @partition replace: untouched node references, block IDs, comment marks and media attrs
  // @partition insert-delete: new IDs, exact placement, empty-page fallback and missing targets
  // @partition section: heading boundaries, non-heading rejection and preserved siblings
  it('replaces one block while preserving every untouched node reference and rich attribute', () => {
    const next = patchDocument(schema, doc, { operation: 'replace-block', targetBlockId: 'p2', markdown: '## 新小节\n\n新正文' })
    expect(next.childCount).toBe(11)
    expect(next.child(0)).toBe(doc.child(0))
    expect(next.child(1)).toBe(doc.child(1))
    expect(next.child(1).firstChild?.marks[0]?.attrs.commentId).toBe('thread-1')
    expect(next.child(2)).toBe(doc.child(2))
    expect(next.child(3).type.name).toBe('heading')
    expect(next.child(3).textContent).toBe('新小节')
    expect(next.child(4).textContent).toBe('新正文')
    const imageAfter = next.child(9)
    const tableAfter = next.child(10)
    expect(imageAfter).toBe(doc.child(8))
    expect(tableAfter).toBe(doc.child(9))
    expect(imageAfter.attrs).toMatchObject({ width: 800, height: 600, displayWidth: 640, align: 'left' })
    expect(tableAfter.firstChild?.firstChild?.attrs.colwidth).toEqual([140])
    const rich = document(
      paragraph('rich-1', '前'),
      { type: 'codeBlock', attrs: { blockId: 'code-1', language: 'mermaid', viewMode: 'split' }, content: [{ type: 'text', text: 'flowchart LR' }] },
      paragraph('rich-2', '后'),
    )
    const richPatched = patchDocument(schema, rich, { operation: 'replace-block', targetBlockId: 'rich-2', markdown: '替换' })
    expect(richPatched.child(1)).toBe(rich.child(1))
    expect(richPatched.child(1).attrs).toMatchObject({ language: 'mermaid', viewMode: 'split' })
    expect(richPatched.child(1).attrs.blockId).toBe('code-1')
    expect(['h1', 'p1', 'h2b', 'p4', 'image-1', 'table-1']).toContain(next.child(0).attrs.blockId)
    const ids = new Set<string>()
    next.descendants(node => {
      if (Object.hasOwn(node.attrs, 'blockId')) ids.add(String(node.attrs.blockId))
    })
    expect(ids.size).toBeGreaterThan(10)
  })

  it('inserts before and after with fresh block IDs and deletes a block without touching its siblings', () => {
    const before = patchDocument(schema, doc, { operation: 'insert-before', targetBlockId: 'p2', markdown: '前一段' })
    expect(before.childCount).toBe(11)
    expect(before.child(3).textContent).toBe('前一段')
    expect(before.child(4)).toBe(doc.child(3))
    const after = patchDocument(schema, doc, { operation: 'insert-after', targetBlockId: 'p2', markdown: '后一段' })
    expect(after.child(4).textContent).toBe('后一段')
    expect(after.child(5)).toBe(doc.child(4))
    const deleted = patchDocument(schema, doc, { operation: 'delete-block', targetBlockId: 'p2' })
    expect(deleted.childCount).toBe(9)
    expect(deleted.child(2)).toBe(doc.child(2))
    expect(deleted.child(3)).toBe(doc.child(4))
    patchError(() => patchDocument(schema, doc, { operation: 'delete-block', targetBlockId: 'missing' }), 'block_not_found')
  })

  it('deleting the only block leaves one identified empty paragraph', () => {
    const single = document(paragraph('only', '唯一'))
    const next = patchDocument(schema, single, { operation: 'delete-block', targetBlockId: 'only' })
    expect(next.childCount).toBe(1)
    expect(next.firstChild?.type.name).toBe('paragraph')
    expect(next.firstChild?.textContent).toBe('')
    expect(typeof next.firstChild?.attrs.blockId).toBe('string')
    expect(next.firstChild?.attrs.blockId).not.toBe('only')
  })

  it('replaces a heading section up to the next peer heading and preserves the following section', () => {
    const next = patchDocument(schema, doc, { operation: 'replace-section', targetBlockId: 'h2', markdown: '## 替换小节\n\n替换正文' })
    expect(next.childCount).toBe(8)
    expect(next.child(0)).toBe(doc.child(0))
    expect(next.child(1)).toBe(doc.child(1))
    expect(next.child(2).textContent).toBe('替换小节')
    expect(next.child(3).textContent).toBe('替换正文')
    expect(next.child(4)).toBe(doc.child(6))
    expect(next.child(5)).toBe(doc.child(7))
    expect(next.child(6)).toBe(doc.child(8))
    expect(next.child(7)).toBe(doc.child(9))
    patchError(() => patchDocument(schema, doc, { operation: 'replace-section', targetBlockId: 'p1', markdown: '不能替换' }), 'invalid_target')
    patchError(() => patchDocument(schema, doc, { operation: 'replace-section', targetBlockId: 'missing', markdown: '不能替换' }), 'block_not_found')
  })

  it('rejects empty rendered Markdown', () => {
    patchError(() => patchDocument(schema, doc, { operation: 'replace-block', targetBlockId: 'p1', markdown: '<!-- 只有注释 -->' }), 'empty_content')
  })
})
