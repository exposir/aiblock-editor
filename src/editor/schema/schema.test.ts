import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { assignMissingBlockIds } from '../extensions/block-id'
import { createEditorExtensions } from '../extensions'
import { markdownToDoc } from '../markdown/markdown-codec'
import { createDocumentSchema } from './index'

function shape(schema: ReturnType<typeof createDocumentSchema>) {
  const node = (name: string, type: (typeof schema.nodes)[string]) => ({
    name,
    group: type.spec.group,
    content: type.spec.content,
    atom: type.spec.atom === true,
    inline: type.spec.inline === true,
    attrs: Object.keys(type.spec.attrs ?? {}).sort(),
    defaults: Object.fromEntries(Object.entries(type.spec.attrs ?? {}).map(([key, value]) => [key, (value as { default?: unknown }).default])),
  })
  return {
    nodes: Object.keys(schema.nodes).sort().map(name => node(name, schema.nodes[name]!)),
    marks: Object.keys(schema.marks).sort().map(name => ({
      name,
      attrs: Object.keys(schema.marks[name]!.spec.attrs ?? {}).sort(),
    })),
  }
}

describe('CLI document schema', () => {
  it('matches the editor schema without importing the UI extensions', () => {
    const editorSchema = getSchema(createEditorExtensions())
    const documentSchema = createDocumentSchema()
    expect(shape(documentSchema)).toEqual(shape(editorSchema))
  })

  it('assigns unique block IDs to nested parsed blocks and is idempotent', () => {
    const schema = createDocumentSchema()
    const parsed = markdownToDoc(schema, '# 标题\n\n- 一\n  - 二\n\n> [!NOTE]\n> 内容\n\n```ts\nconst x = 1\n```\n')
    const assigned = assignMissingBlockIds(parsed)
    const ids: string[] = []
    assigned.descendants(node => {
      if (Object.hasOwn(node.attrs, 'blockId')) ids.push(String(node.attrs.blockId))
      return true
    })
    expect(ids.length).toBeGreaterThan(5)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(Boolean)).toBe(true)
    expect(assignMissingBlockIds(assigned)).toBe(assigned)
  })
})
