import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { describe, expect, it } from 'vitest'
import { codeBlockAnchor, registerCodeBlockAnchor } from './code-block-anchors'

function node(blockId: string | null): ProseMirrorNode {
  return { attrs: { blockId } } as unknown as ProseMirrorNode
}

describe('code block DOM anchors', () => {
  it('resolves by block id and node identity without walking the document', () => {
    const view = {} as EditorView
    const current = node('stable-id')
    const element = document.createElement('pre')
    const stop = registerCodeBlockAnchor(view, current, element)

    expect(codeBlockAnchor(view, current)).toBe(element)
    expect(codeBlockAnchor(view, node('stable-id'))).toBe(element)
    stop()
    expect(codeBlockAnchor(view, current)).toBeNull()
  })

  it('does not let an old NodeView remove a newer anchor with the same id', () => {
    const view = {} as EditorView
    const first = document.createElement('pre')
    const second = document.createElement('pre')
    const stopFirst = registerCodeBlockAnchor(view, node('same-id'), first)
    const stopSecond = registerCodeBlockAnchor(view, node('same-id'), second)

    stopFirst()
    expect(codeBlockAnchor(view, node('same-id'))).toBe(second)
    stopSecond()
    expect(codeBlockAnchor(view, node('same-id'))).toBeNull()
  })
})
