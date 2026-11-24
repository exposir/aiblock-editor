import { ChevronRight } from 'lucide-react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { FloatingBlockControl } from '../components/FloatingBlockControl'

export function toggleBodyId(editorId: string, blockId: unknown): string | undefined {
  return typeof blockId === 'string' ? `toggle-${editorId}-${encodeURIComponent(blockId)}` : undefined
}

export function ToggleView({ editor, node, getPos }: NodeViewProps) {
  const open = node.attrs.open !== false
  return (
    <NodeViewWrapper className="toggle">
      <FloatingBlockControl
        className="block-control toggle-button"
        aria-label="折叠块内容"
        aria-expanded={open}
        aria-controls={toggleBodyId(editor.instanceId, node.attrs.blockId)}
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          const pos = getPos()
          if (typeof pos === 'number') editor.commands.setToggleOpen(pos, !open)
        }}
      >
        <ChevronRight size={17} aria-hidden="true" />
      </FloatingBlockControl>
      <NodeViewContent className="toggle-content" />
    </NodeViewWrapper>
  )
}
