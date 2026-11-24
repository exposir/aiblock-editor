import { Extension } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { BlockConversion } from '../types'
import { blockAt } from './block-range'
import { convertBlockSelection } from './block-conversion'

export { allowsColumnDrop, createBlockMoveTransaction, getBlockDropSide } from './block-drag-logic'
export type { BlockDragSource, BlockDropSide, BlockDropTarget } from './block-drag-logic'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockDrag: {
      insertParagraphAfterBlock: (pos: number) => ReturnType
      convertSelectedBlocks: (target: BlockConversion) => ReturnType
    }
  }
}

export const BlockDragExtension = Extension.create({
  name: 'blockDrag',

  addCommands() {
    return {
      insertParagraphAfterBlock: pos => ({ tr, state, dispatch }) => {
        const block = blockAt(tr.doc, pos)
        const paragraph = state.schema.nodes.paragraph
        if (!block || !paragraph) return false
        const index = block.$pos.index() + 1
        if (!block.$pos.parent.canReplaceWith(index, index, paragraph)) return false
        if (dispatch) {
          const after = pos + block.node.nodeSize
          const content = new Slice(Fragment.from(paragraph.create()), 0, 0)
          tr.step(new ReplaceStep(after, after, content))
          tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
        }
        return true
      },
      convertSelectedBlocks: target => ({ tr, dispatch }) => convertBlockSelection(tr, target, !!dispatch),
    }
  },
})
