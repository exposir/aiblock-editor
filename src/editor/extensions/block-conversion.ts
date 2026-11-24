import { Fragment, Slice } from '@tiptap/pm/model'
import type { Attrs, Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { BlockConversion } from '../types'
import { exactBlockReplacement } from './block-range'
import { MultiBlockSelection, selectInsertedBlocks, wrapBlockRange } from './multi-block-selection'

const listItems = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' } as const

function isList(node: ProseMirrorNode): boolean {
  return Object.hasOwn(listItems, node.type.name)
}

function textBlocks(node: ProseMirrorNode): readonly ProseMirrorNode[] {
  if (node.isTextblock) return [node]
  const blocks: ProseMirrorNode[] = []
  node.descendants(child => {
    if (!child.isTextblock) return
    blocks.push(child)
    return false
  })
  return blocks
}

function convertText(node: ProseMirrorNode, type: NodeType, attrs?: Attrs): ProseMirrorNode {
  const properties = { ...node.attrs, ...attrs }
  if (type.spec.code) {
    const text = node.textBetween(0, node.content.size, '\n', '\n')
    return type.createChecked(properties, text ? type.schema.text(text) : null)
  }
  const children = node.isTextblock ? node.children.map(child => child.mark(type.allowedMarks(child.marks))) : []
  return type.createChecked(properties, children)
}

function convertList(blocks: readonly ProseMirrorNode[], type: NodeType, item: NodeType, paragraph: NodeType) {
  const items: ProseMirrorNode[] = []
  for (const block of blocks) {
    if (isList(block)) {
      for (const source of block.children) items.push(item.createChecked(source.attrs, source.content))
    } else if (block.isTextblock) {
      items.push(item.createChecked(null, convertText(block, paragraph)))
    } else {
      items.push(item.createChecked(null, [paragraph.create(), block]))
    }
  }
  return type.createChecked(isList(blocks[0]!) ? blocks[0]!.attrs : null, items)
}

function convertToggle(blocks: readonly ProseMirrorNode[], type: NodeType, paragraph: NodeType) {
  const { toggleSummary, toggleContent } = type.schema.nodes
  if (!toggleSummary || !toggleContent) return null
  const first = blocks[0]!
  const hasSummary = first.isTextblock
  const title = hasSummary
    ? toggleSummary.createChecked(null, first.children.map(child => child.mark(toggleSummary.allowedMarks(child.marks))))
    : toggleSummary.create()
  const remaining = hasSummary ? blocks.slice(1) : blocks
  const body = toggleContent.createChecked(null, remaining.length ? [...remaining] : paragraph.create())
  return type.createChecked(hasSummary ? first.attrs : null, [title, body])
}

export function convertBlockSelection(tr: Transaction, target: BlockConversion, apply: boolean): boolean {
  const selection = tr.selection
  if (!(selection instanceof MultiBlockSelection)) return false
  const { blockRange: range } = selection
  const schema = tr.doc.type.schema
  const type = schema.nodes[target.type]
  const paragraph = schema.nodes.paragraph
  if (!type || !paragraph) return false

  if (range.blocks.length === 1 && range.blocks[0]?.type === type &&
      (target.type !== 'heading' || range.blocks[0].attrs.level === target.level)) return true

  if (target.type === 'callout' || target.type === 'blockquote') {
    return wrapBlockRange(tr, range, type, undefined, apply)
  }

  let converted: readonly ProseMirrorNode[]
  switch (target.type) {
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const item = schema.nodes[listItems[target.type]]
      if (!item) return false
      converted = [convertList(range.blocks, type, item, paragraph)]
      break
    }
    case 'toggle': {
      const toggle = convertToggle(range.blocks, type, paragraph)
      if (!toggle) return false
      converted = [toggle]
      break
    }
    case 'codeBlock':
      converted = range.blocks.map(block => convertText(block, type))
      break
    default:
      converted = range.blocks.flatMap(block => {
        const leaves = textBlocks(block)
        const attrs = target.type === 'heading' ? { level: target.level } : undefined
        return (leaves.length ? leaves : [block]).map(leaf => convertText(leaf, type, attrs))
      })
  }

  const content = Fragment.fromArray([...converted])
  if (!exactBlockReplacement(range, content)) return false
  if (apply && !selection.content().content.eq(content)) {
    tr.step(new ReplaceStep(range.from, range.to, new Slice(content, 0, 0)))
    tr.setSelection(selectInsertedBlocks(tr.doc, range.from, range.from + content.size,
      selection.anchorBlockPos > selection.headBlockPos)!)
  }
  return true
}
