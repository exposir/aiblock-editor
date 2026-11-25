import type { JSONContent } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import type { PageMetadata } from './workspace-format'
import { extractPlainText, searchWorkspacePages } from './workspace-search'

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const block = (type: string, ...content: JSONContent[]): JSONContent => ({ type, content })
const meta = (id: string, title: string): PageMetadata => ({
  id, title, parentId: null, icon: '📄', order: 0, createdAt: 0, updatedAt: 0, comments: [],
})

describe('workspace search', () => {
  // @partition text: readable text across inline formatting and nested blocks
  // @partition query: ranking, snippets, limit and cancellation of suspended I/O
  it('text: preserves contiguous marks and exposes nested table, code, formula and image text', () => {
    const doc = block('doc',
      block('heading', text('发布'), { ...text('计划'), marks: [{ type: 'bold' }] }),
      block('toggle', block('toggleSummary', text('清单')),
        block('toggleContent', block('table', block('tableRow', block('tableCell', block('paragraph', text('指标'))))))),
      block('columnList', block('column', block('callout', block('paragraph', text('分栏'),
        { type: 'inlineMath', attrs: { latex: 'x^2' } })))),
      block('codeBlock', text('const ok = true')),
      { type: 'imageBlock', attrs: { alt: '发布截图' } },
    )
    expect(extractPlainText(doc).split(/\s+/u)).toEqual(['发布计划', '清单', '指标', '分栏', 'x^2', 'const', 'ok', '=', 'true', '发布截图'])
  })

  it('query: returns a title hit first, then a case-insensitive body match with context', async () => {
    const pages = [meta('body', '备忘'), meta('title', 'RELEASE'), meta('unread', '其他')]
    const read = vi.fn(async () => block('doc', block('paragraph', text('前置说明： Release 已完成。'))))
    const hits = await searchWorkspacePages(pages, read, '  release  ', { limit: 2 })
    expect(hits).toMatchObject([
      { pageId: 'title', title: 'RELEASE', match: 'title' },
      { pageId: 'body', title: '备忘', match: 'body', snippet: '前置说明： Release 已完成。' },
    ])
    expect(read).toHaveBeenCalledExactlyOnceWith('body')
    await expect(searchWorkspacePages(pages, read, '   ')).resolves.toEqual([])
  })

  it('query: stops immediately during an outstanding read and never starts another page', async () => {
    const stop = new AbortController()
    const read = vi.fn(() => new Promise<JSONContent>(() => {}))
    const results = searchWorkspacePages([meta('a', '一'), meta('b', '二')], read, '查找', { signal: stop.signal })
    stop.abort()
    await expect(results).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledExactlyOnceWith('a')
  })
})
