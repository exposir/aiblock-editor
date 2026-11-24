import { mergeAttributes } from '@tiptap/core'
import type { NodeViewProps } from '@tiptap/core'
import TaskItem from '@tiptap/extension-task-item'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Check } from 'lucide-react'
import { FloatingBlockControl } from '../components/FloatingBlockControl'

function TaskItemView({ editor, node, updateAttributes }: NodeViewProps) {
  const checked = node.attrs.checked === true
  return (
    <NodeViewWrapper className="task-item-view">
      <FloatingBlockControl className="task-checkbox" role="checkbox" disabled={!editor.isEditable}
        aria-checked={checked} aria-label={node.firstChild?.textContent || '待办事项'}
        onMouseDown={event => event.preventDefault()} onClick={() => updateAttributes({ checked: !checked })}>
        {checked && <Check size={13} aria-hidden="true" />}
      </FloatingBlockControl>
      <NodeViewContent className="task-item-content" />
    </NodeViewWrapper>
  )
}

export const PortalTaskItem = TaskItem.extend({
  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes, { 'data-type': this.name }), ['div', 0]]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView, {
      as: 'li',
      attrs: ({ HTMLAttributes }) => ({ ...HTMLAttributes, 'data-type': this.name }),
    })
  },
}).configure({ nested: true })
