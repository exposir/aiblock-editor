import { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'
import { demoDocument } from '../demo-document'
import { createEditorExtensions } from '../extensions'
import { docToMarkdown, markdownToDoc } from './markdown-codec'

const editors: Editor[] = []

function editor(content: string) {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

function counts(doc: ReturnType<Editor['getJSON']>) {
  const result: Record<string, number> = {}
  const visit = (node: { type?: string; content?: readonly unknown[] }) => {
    if (node.type) result[node.type] = (result[node.type] ?? 0) + 1
    if (Array.isArray(node.content)) for (const child of node.content) visit(child as typeof node)
  }
  visit(doc as typeof doc)
  return result
}

function linkHrefs(doc: ProseMirrorNode) {
  const hrefs: string[] = []
  doc.descendants(node => {
    for (const mark of node.marks) {
      if (mark.type.name === 'link') hrefs.push(String(mark.attrs.href))
    }
  })
  return hrefs
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

describe('MarkdownCodec', () => {
  it('round-trips standard GFM inline and block syntax', () => {
    const source = `
# H1
## H2
### H3
#### H4
##### H5
###### H6

Plain **bold** *italic* ~~strike~~ <u>underline</u> \`code\` [link](https://example.com/a_(b)) ==highlight==

- parent
  - child
    - [x] done
    - [ ] todo

> quoted text

---

\`\`\`\`typescript
const fence = "\`\`\`"
\`\`\`\`
`
    const parsed = markdownToDoc(editor('').schema, source)
    expect(docToMarkdown(parsed)).toContain('```typescript')
    const roundTrip = markdownToDoc(parsed.type.schema, docToMarkdown(parsed))
    expect(roundTrip.textContent).toContain('const fence')
    expect(counts(roundTrip.toJSON())).toMatchObject({ heading: 6, bulletList: 2, taskList: 1, blockquote: 1, codeBlock: 1 })
  })

  it('round-trips a table with escaped pipes and block cells', () => {
    const markdown = `| A | B |
| --- | --- |
| left \\| right | first<br>second |
`
    const doc = markdownToDoc(editor('').schema, markdown)
    const back = markdownToDoc(doc.type.schema, docToMarkdown(doc))
    expect(counts(back.toJSON())).toMatchObject({ table: 1, tableRow: 2, tableHeader: 2, tableCell: 2 })
  })

  it('keeps literal pipes and hard breaks inside table cells', () => {
    const schema = editor('').schema
    const doc = markdownToDoc(schema, '| A | B |\n| --- | --- |\n| left \\| right | first<br>second |\n')
    const bodyRow = doc.firstChild!.child(1)
    expect(bodyRow.child(0)!.textContent).toBe('left | right')
    let breaks = 0
    bodyRow.child(1)!.descendants(node => { if (node.type.name === 'hardBreak') breaks++ })
    expect(breaks).toBe(1)

    const out = docToMarkdown(doc)
    expect(out).toContain('| left \\| right | first<br>second |')
    expect(out).not.toMatch(/left \\{2,}\| right/)

    const again = markdownToDoc(schema, out)
    expect(again.textContent).toContain('left | right')
    let breaksAgain = 0
    again.descendants(node => { if (node.type.name === 'hardBreak') breaksAgain++ })
    expect(breaksAgain).toBe(1)
  })

  it('escapes pipes inside inline code in table cells', () => {
    const schema = editor('').schema
    const doc = markdownToDoc(schema, '| A |\n| --- |\n| `a\\|b` |\n')
    expect(doc.textContent).toContain('a|b')
    const out = docToMarkdown(doc)
    expect(out).toContain('`a\\|b`')
    expect(markdownToDoc(schema, out).textContent).toContain('a|b')
  })

  it('drops unsafe link protocols and preserves safe or relative hrefs', () => {
    const schema = editor('').schema
    const markdown = [
      '[js](javascript:alert(1))',
      '[vb](vbscript:msgbox(1))',
      '[data](data:text/html,x)',
      '[entity](&#106;avascript:alert(1))',
      '[tab](java&Tab;script:alert(1))',
      '[escaped](java%73cript:alert(1))',
      '[http](https://example.com/a%20b)',
      '[query](https://example.com/?q=a%26b)',
      '[mail](mailto:a@b.c)',
      '[tel](tel:12345)',
      '[rel](/docs/page)',
      '[hash](#part)',
    ].join(' ')
    const doc = markdownToDoc(schema, markdown)
    expect(linkHrefs(doc)).toEqual([
      'https://example.com/a%20b',
      'https://example.com/?q=a%26b',
      'mailto:a@b.c',
      'tel:12345',
      '/docs/page',
      '#part',
    ])
    expect(doc.textContent).toContain('js')
    expect(doc.textContent).toContain('data')
  })

  it('creates a valid paragraph for empty markdown and round-trips plain text', () => {
    const schema = editor('').schema
    const empty = markdownToDoc(schema, '')
    expect(empty.childCount).toBe(1)
    expect(empty.firstChild?.type.name).toBe('paragraph')
    const plain = markdownToDoc(schema, 'hello world')
    expect(plain.textContent).toBe('hello world')
    expect(docToMarkdown(plain).trim()).toBe('hello world')
  })

  it('keeps the nested list hierarchy', () => {
    const schema = editor('').schema
    const doc = markdownToDoc(schema, '- parent\n  - child\n    - [x] done\n    - [ ] todo\n')
    const outer = doc.firstChild!
    expect(outer.type.name).toBe('bulletList')
    const parent = outer.firstChild!
    expect(parent.firstChild?.type.name).toBe('paragraph')
    const nested = parent.child(1)
    expect(nested.type.name).toBe('bulletList')
    const tasks = nested.firstChild!.child(1)
    expect(tasks.type.name).toBe('taskList')
    expect(tasks.childCount).toBe(2)
  })

  it('keeps tight-list inline marks and nested items together', () => {
    const schema = editor('').schema
    const source = '- **工程文件**： `build/icon.svg`（矢量源图） [文档](https://example.com/docs) $x^2$\n  - **子项**：`index.json`\n'
    const assertFormatting = (doc: ProseMirrorNode) => {
      const list = doc.firstChild!
      expect(list.type.name).toBe('bulletList')
      const item = list.firstChild!
      expect(item.childCount).toBe(2)
      const paragraph = item.firstChild!
      expect(paragraph.type.name).toBe('paragraph')
      expect(paragraph.textContent).toContain('工程文件')
      expect(paragraph.textContent).toContain('build/icon.svg')
      expect(paragraph.textContent).toContain('文档')
      const texts: { text: string; marks: readonly string[] }[] = []
      const math: string[] = []
      doc.descendants(node => {
        if (node.isText) texts.push({ text: node.textContent, marks: node.marks.map(mark => mark.type.name) })
        if (node.type.name === 'inlineMath') math.push(String(node.attrs.latex))
      })
      expect(texts.find(node => node.text === '工程文件')?.marks).toContain('bold')
      expect(texts.find(node => node.text === 'build/icon.svg')?.marks).toContain('code')
      expect(texts.find(node => node.text === '文档')?.marks).toContain('link')
      expect(math).toContain('x^2')
      const nested = item.child(1)
      expect(nested.type.name).toBe('bulletList')
      expect(nested.firstChild?.firstChild?.type.name).toBe('paragraph')
      expect(texts.find(node => node.text === '子项')?.marks).toContain('bold')
      expect(texts.find(node => node.text === 'index.json')?.marks).toContain('code')
    }
    const parsed = markdownToDoc(schema, source)
    assertFormatting(parsed)
    const rendered = docToMarkdown(parsed)
    expect(rendered).toContain('**工程文件**')
    expect(rendered).toContain('`build/icon.svg`')
    expect(rendered).toContain('[文档](https://example.com/docs)')
    expect(rendered).toContain('$x^2$')
    assertFormatting(markdownToDoc(schema, rendered))
  })

  it('does not let literal internal tokens duplicate custom blocks', () => {
    const schema = editor('').schema
    const doc = markdownToDoc(schema, '> [!NOTE]\n> body\n\n%%CODEX-0%%\n')
    expect(counts(doc.toJSON()).callout).toBe(1)
    expect(doc.textContent).toContain('%%CODEX-0%%')
    expect(doc.lastChild?.type.name).toBe('paragraph')
  })

  it('round-trips all alert themes with custom icons and task lists', () => {
    const markdown = `> [!NOTE] 📌
> Intro
>
> - [x] done
> - [ ] todo
>
> > nested
`
    const first = markdownToDoc(editor('').schema, markdown)
    const second = markdownToDoc(first.type.schema, docToMarkdown(first))
    expect(docToMarkdown(first)).toContain('[!NOTE] 📌')
    expect(counts(second.toJSON())).toMatchObject({ callout: 1, taskList: 1, blockquote: 1 })
  })

  it('round-trips details toggles with open state and multiple blocks', () => {
    const markdown = `<details open>
<summary>Summary</summary>

First

- [ ] task

Second

</details>
`
    const first = markdownToDoc(editor('').schema, markdown)
    const second = markdownToDoc(first.type.schema, docToMarkdown(first))
    expect(docToMarkdown(first)).toContain('<details open>')
    expect(counts(second.toJSON())).toMatchObject({ toggle: 1, toggleSummary: 1, toggleContent: 1, taskList: 1 })
  })

  it('round-trips 2-3 column containers and normalized widths', () => {
    const markdown = `::::columns
:::column{width=40}
Left
:::
:::column{width=60}
Right
:::
::::
`
    const first = markdownToDoc(editor('').schema, markdown)
    const second = markdownToDoc(first.type.schema, docToMarkdown(first))
    expect(docToMarkdown(first)).toContain('::::columns')
    expect(counts(second.toJSON())).toMatchObject({ columnList: 1, column: 2 })
  })

  it('round-trips the demo document without losing key block types', () => {
    const parsed = editor(demoDocument).state.doc
    const original = counts(parsed.toJSON())
    const roundTripped = markdownToDoc(parsed.type.schema, docToMarkdown(parsed))
    const next = counts(roundTripped.toJSON())
    for (const type of ['callout', 'toggle', 'columnList', 'column', 'table', 'taskList', 'taskItem', 'codeBlock']) {
      expect(next[type]).toBe(original[type])
    }
    expect(docToMarkdown(parsed)).not.toContain('data-block-id')
    expect(docToMarkdown(parsed)).not.toContain('data-comment-id')
  })
})

describe('block images in Markdown', () => {
  // @partition source and layout: external URLs, asset aliases and HTML dimensions
  it('keeps safe URLs and local asset IDs while preserving image blocks in mixed text', () => {
    const id = 'a'.repeat(64) + '.png'
    const source = 'Before ![figure](https://example.test/a.png?q=1&v=2) after.\n\n![local](lark-asset://media/' + id + ')'
    const schema = editor('').schema
    const doc = markdownToDoc(schema, source)
    expect(doc.children.map(node => node.type.name)).toEqual(['paragraph', 'imageBlock', 'paragraph', 'imageBlock'])
    expect(doc.child(1).attrs).toMatchObject({ src: 'https://example.test/a.png?q=1&v=2', alt: 'figure' })
    expect(doc.child(3).attrs).toMatchObject({ assetId: id, src: null, alt: 'local' })
    expect(markdownToDoc(schema, docToMarkdown(doc)).eq(doc)).toBe(true)
  })

  it('round trips intrinsic size, display size, alignment and alternative text', () => {
    const source = '<img src="https://example.test/layout.png" alt="A &amp; B" width="1200" height="600" data-display-width="360" data-align="right">'
    const schema = editor('').schema
    const doc = markdownToDoc(schema, source)
    expect(doc.firstChild?.attrs).toMatchObject({ alt: 'A & B', width: 1200, height: 600, align: 'right', displayWidth: 360 })
    expect(markdownToDoc(schema, docToMarkdown(doc)).eq(doc)).toBe(true)
  })

  it('recognizes dangerous Markdown image labels as text without mounting unsafe image sources', () => {
    const schema = editor('').schema
    const doc = markdownToDoc(schema, '![blocked](javascript:alert(1))\n\n![also blocked](data:image/svg+xml,svg)')
    expect(doc.children.every(node => node.type.name === 'paragraph')).toBe(true)
    expect(doc.textContent).toContain('blocked')
  })
  it('keeps the safe external fallback of a local asset', () => {
    const schema = editor('').schema
    const id = 'b'.repeat(64) + '.webp'
    const source = `<img src="asset:${id}" data-fallback-src="https://example.test/backup.webp" alt="备份">`
    const doc = markdownToDoc(schema, source)
    expect(doc.firstChild?.attrs).toMatchObject({ assetId: id, src: 'https://example.test/backup.webp' })
    expect(markdownToDoc(schema, docToMarkdown(doc)).eq(doc)).toBe(true)
  })
})
