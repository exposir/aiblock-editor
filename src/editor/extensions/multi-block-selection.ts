import { Extension } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Attrs, Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model'
import { Plugin, Selection, TextSelection } from '@tiptap/pm/state'
import type { SelectionBookmark, Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import type { Mappable } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { BLOCK_BACKGROUNDS, calloutTheme } from '../types'
import type { BlockBackground, CalloutTheme } from '../types'
import { blockAt, blockNodeTypes, blockRange, exactBlockReplacement, nearestBlock } from './block-range'
import type { BlockRange } from './block-range'

export class MultiBlockSelection extends Selection {
  override visible = false

  private constructor(
    readonly blockRange: BlockRange,
    readonly anchorBlockPos: number,
    readonly headBlockPos: number,
  ) {
    const { $from, $to } = blockRange
    super(anchorBlockPos <= headBlockPos ? $from : $to, anchorBlockPos <= headBlockPos ? $to : $from)
  }

  static create(doc: ProseMirrorNode, anchor: number, head = anchor): MultiBlockSelection {
    const selection = this.tryCreate(doc, anchor, head)
    if (!selection) throw new RangeError('Expected a continuous range of sibling blocks')
    return selection
  }

  static tryCreate(doc: ProseMirrorNode, anchor: number, head = anchor): MultiBlockSelection | null {
    const range = blockRange(doc, anchor, head)
    return range ? new MultiBlockSelection(range, anchor, head) : null
  }

  override eq(other: Selection): boolean {
    return other instanceof MultiBlockSelection &&
      other.anchorBlockPos === this.anchorBlockPos && other.headBlockPos === this.headBlockPos
  }

  override map(doc: ProseMirrorNode, mapping: Mappable): Selection {
    return this.getBookmark().map(mapping).resolve(doc)
  }

  override getBookmark(): SelectionBookmark {
    return new BlockBookmark(this.from, this.to, this.anchorBlockPos > this.headBlockPos)
  }

  override content(): Slice {
    return new Slice(Fragment.fromArray([...this.blockRange.blocks]), 0, 0)
  }

  override replace(tr: Transaction, slice = Slice.empty): void {
    const range = this.blockRange
    if (slice.openStart || slice.openEnd) {
      try {
        slice.content.forEach(node => node.check())
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        super.replace(tr, slice)
        return
      }
    }
    const paragraph = tr.doc.type.schema.nodes.paragraph
    const content = slice.content.firstChild?.isInline && paragraph?.validContent(slice.content)
      ? Fragment.from(paragraph.create(null, slice.content))
      : slice.content
    const replacement = exactBlockReplacement(range, content)
    if (!replacement) {
      super.replace(tr, slice)
      return
    }
    tr.step(new ReplaceStep(range.from, range.to, new Slice(replacement, 0, 0)))
    tr.setSelection(Selection.near(tr.doc.resolve(range.from + replacement.size), replacement.size ? -1 : 1))
  }

  override replaceWith(tr: Transaction, node: ProseMirrorNode): void {
    this.replace(tr, new Slice(Fragment.from(node), 0, 0))
  }

  override toJSON() {
    return { type: 'multiBlock', anchorBlockPos: this.anchorBlockPos, headBlockPos: this.headBlockPos }
  }

  static override fromJSON(doc: ProseMirrorNode, json: unknown): MultiBlockSelection {
    if (!json || typeof json !== 'object' || !('anchorBlockPos' in json) || !('headBlockPos' in json) ||
        typeof json.anchorBlockPos !== 'number' || typeof json.headBlockPos !== 'number') {
      throw new RangeError('Invalid multiBlock selection')
    }
    return this.create(doc, json.anchorBlockPos, json.headBlockPos)
  }
}

class BlockBookmark implements SelectionBookmark {
  constructor(private readonly from: number, private readonly to: number, private readonly backwards: boolean) {}

  map(mapping: Mappable): BlockBookmark {
    return new BlockBookmark(mapping.map(this.from, 1), mapping.map(this.to, -1), this.backwards)
  }

  resolve(doc: ProseMirrorNode): Selection {
    if (this.from < this.to && this.to <= doc.content.size) {
      const selection = selectInsertedBlocks(doc, this.from, this.to, this.backwards)
      if (selection) return selection
    }
    const $pos = doc.resolve(Math.max(0, Math.min(this.from, doc.content.size)))
    return Selection.findFrom($pos, 1, true) ?? Selection.findFrom($pos, -1, true) ?? Selection.near($pos)
  }
}

Selection.jsonID('multiBlock', MultiBlockSelection)

export function selectInsertedBlocks(doc: ProseMirrorNode, from: number, to: number, backwards = false) {
  const $to = doc.resolve(to)
  const last = $to.nodeBefore
  if (!last || $to.textOffset || from >= to) return null
  const lastPos = to - last.nodeSize
  if (lastPos < from) return null
  return MultiBlockSelection.tryCreate(doc, backwards ? lastPos : from, backwards ? from : lastPos)
}

function cloneWithoutIds(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isText) return node
  const attrs = Object.hasOwn(node.attrs, 'blockId') ? { ...node.attrs, blockId: null } : node.attrs
  return node.type.create(attrs, node.children.map(cloneWithoutIds), node.marks)
}

export function wrapBlockRange(tr: Transaction, range: BlockRange, type: NodeType, attrs?: Attrs, apply = true): boolean {
  const { $from, $to } = range
  const blocks = Fragment.fromArray([...range.blocks])
  if (!type.validContent(blocks) || !$from.parent.canReplaceWith($from.index(), $to.index(), type)) return false
  if (apply) {
    const shell = new Slice(Fragment.from(type.create(attrs)), 0, 0)
    tr.step(new ReplaceAroundStep(range.from, range.to, range.from, range.to, shell, 1, true))
    tr.setSelection(MultiBlockSelection.create(tr.doc, range.from))
  }
  return true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    multiBlockSelection: {
      selectBlock: (pos: number) => ReturnType
      selectBlockRange: (anchorPos: number, headPos: number) => ReturnType
      extendBlockSelection: (dir: -1 | 1) => ReturnType
      deleteSelectedBlocks: () => ReturnType
      duplicateSelectedBlocks: () => ReturnType
      wrapSelectedBlocksInCallout: (theme?: CalloutTheme) => ReturnType
      setSelectedBlocksBg: (bg: BlockBackground) => ReturnType
    }
  }
}

function blockBackground(value: unknown): BlockBackground {
  return BLOCK_BACKGROUNDS.find(bg => bg === value) ?? 'default'
}

export const MultiBlockSelectionExtension = Extension.create({
  name: 'multiBlockSelection',
  priority: 110,

  addGlobalAttributes() {
    return [{
      types: blockNodeTypes(this.extensions),
      attributes: {
        blockBg: {
          default: 'default',
          parseHTML: element => blockBackground(element.getAttribute('data-block-bg')),
          renderHTML: attrs => ({ 'data-block-bg': blockBackground(attrs.blockBg) }),
        },
      },
    }]
  },

  addCommands() {
    return {
      selectBlock: pos => ({ commands }) => commands.selectBlockRange(pos, pos),
      selectBlockRange: (anchor, head) => ({ tr, dispatch }) => {
        const selection = MultiBlockSelection.tryCreate(tr.doc, anchor, head)
        if (!selection) return false
        if (dispatch && !tr.selection.eq(selection)) tr.setSelection(selection)
        return true
      },
      extendBlockSelection: dir => ({ tr, dispatch }) => {
        const selection = tr.selection
        if (!(selection instanceof MultiBlockSelection) || (dir !== -1 && dir !== 1)) return false
        const head = blockAt(tr.doc, selection.headBlockPos)!
        const adjacent = head.$pos.parent.maybeChild(head.$pos.index() + dir)
        if (!adjacent) return false

        const next = head.pos + (dir < 0 ? -adjacent.nodeSize : head.node.nodeSize)
        const extended = MultiBlockSelection.tryCreate(tr.doc, selection.anchorBlockPos, next)
        if (!extended) return false
        if (dispatch) tr.setSelection(extended).scrollIntoView()
        return true
      },
      deleteSelectedBlocks: () => ({ tr, dispatch }) => {
        const selection = tr.selection
        if (!(selection instanceof MultiBlockSelection) ||
            !exactBlockReplacement(selection.blockRange, Fragment.empty)) return false
        if (dispatch) selection.replace(tr)
        return true
      },
      duplicateSelectedBlocks: () => ({ tr, dispatch }) => {
        const selection = tr.selection
        if (!(selection instanceof MultiBlockSelection)) return false
        const { blocks, $to, to } = selection.blockRange
        const copies = Fragment.fromArray(blocks.map(cloneWithoutIds))
        if (!$to.parent.canReplace($to.index(), $to.index(), copies)) return false
        if (dispatch) {
          tr.step(new ReplaceStep(to, to, new Slice(copies, 0, 0)))
          tr.setSelection(selectInsertedBlocks(tr.doc, to, to + copies.size,
            selection.anchorBlockPos > selection.headBlockPos)!)
        }
        return true
      },
      wrapSelectedBlocksInCallout: theme => ({ tr, state, dispatch }) => {
        const selection = tr.selection
        const type = state.schema.nodes.callout
        return selection instanceof MultiBlockSelection && !!type &&
          wrapBlockRange(tr, selection.blockRange, type, { theme: calloutTheme(theme) }, !!dispatch)
      },
      setSelectedBlocksBg: bg => ({ tr, dispatch }) => {
        const selection = tr.selection
        if (!(selection instanceof MultiBlockSelection) || !BLOCK_BACKGROUNDS.includes(bg)) return false
        if (dispatch) {
          let pos = selection.from
          for (const block of selection.blockRange.blocks) {
            if (block.attrs.blockBg !== bg) tr.setNodeAttribute(pos, 'blockBg', bg)
            pos += block.nodeSize
          }
        }
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    const { editor } = this
    const hasBlockSelection = () => editor.state.selection instanceof MultiBlockSelection
    const extend = (direction: -1 | 1) => () => {
      if (!hasBlockSelection()) return false
      if (editor.can().extendBlockSelection(direction)) editor.commands.extendBlockSelection(direction)
      return true
    }

    return {
      Escape: () => {
        const { selection, doc } = editor.state
        if (selection instanceof MultiBlockSelection) {
          const $headBlock = doc.resolve(selection.headBlockPos)
          const caret = Selection.findFrom($headBlock, 1, true) ??
            Selection.findFrom($headBlock, -1, true) ?? Selection.near($headBlock)
          editor.view.dispatch(editor.state.tr.setSelection(caret).scrollIntoView())
          return true
        }
        if (!(selection instanceof TextSelection)) return false
        const pos = nearestBlock(selection.$head)
        return pos !== null && editor.commands.selectBlock(pos)
      },
      'Shift-ArrowUp': extend(-1),
      'Shift-ArrowDown': extend(1),
      Backspace: () => hasBlockSelection() && editor.commands.deleteSelectedBlocks(),
      Delete: () => hasBlockSelection() && editor.commands.deleteSelectedBlocks(),
    }
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations({ doc, selection }) {
          if (!(selection instanceof MultiBlockSelection)) return null
          const decorations: Decoration[] = []
          let pos = selection.from
          for (const block of selection.blockRange.blocks) {
            decorations.push(Decoration.node(pos, pos + block.nodeSize, { class: 'lark-block-selected' }))
            pos += block.nodeSize
          }
          return DecorationSet.create(doc, decorations)
        },
        handleTextInput(view, _from, _to, text) {
          if (!(view.state.selection instanceof MultiBlockSelection) || !text) return false
          view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(text), false))
          return true
        },
      },
    })]
  },
})
