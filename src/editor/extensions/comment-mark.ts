import { Mark, mergeAttributes } from '@tiptap/core'
import type { Mark as ProseMirrorMark, MarkType, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { textEdits } from './document-changes'

interface CommentState {
  readonly active: string | null
  readonly retired: ReadonlySet<string>
  readonly decorations: DecorationSet
}

interface CommentMeta {
  active?: string | null
  retirement?: ReadonlyMap<string, boolean>
  clearRetired?: boolean
}

const commentKey = new PluginKey<CommentState>('comments')

function setCommentMeta(tr: Transaction, meta: CommentMeta) {
  tr.setMeta(commentKey, { ...tr.getMeta(commentKey), ...meta })
}

function setRetirement(tr: Transaction, id: string, retired: boolean) {
  const previous: CommentMeta | undefined = tr.getMeta(commentKey)
  const retirement = new Map(previous?.retirement)
  retirement.set(id, retired)
  setCommentMeta(tr, { retirement })
  tr.setMeta('addToHistory', false)
}

function visitComments(
  doc: ProseMirrorNode,
  type: MarkType,
  visit: (mark: ProseMirrorMark, from: number, to: number) => void,
) {
  doc.descendants((node, pos) => {
    if (!node.isInline) return
    for (const mark of node.marks) {
      if (mark.type === type) visit(mark, pos, pos + node.nodeSize)
    }
  })
}

function removeComments(tr: Transaction, type: MarkType, ids: ReadonlySet<string>) {
  visitComments(tr.doc, type, (mark, from, to) => {
    if (ids.has(mark.attrs.commentId)) tr.removeMark(from, to, mark)
  })
}

export function commentAnchor(doc: ProseMirrorNode, id: string): number | null {
  const type = doc.type.schema.marks.comment
  if (!type) return null
  let anchor: number | null = null
  visitComments(doc, type, (mark, from) => {
    if (anchor === null && mark.attrs.commentId === id) anchor = from
  })
  return anchor
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      addCommentMark: (id: string) => ReturnType
      removeCommentMark: (id: string) => ReturnType
      setActiveComment: (id: string | null) => ReturnType
      clearRetiredComments: () => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attrs => attrs.commentId ? { 'data-comment-id': attrs.commentId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]
  },

  addCommands() {
    return {
      addCommentMark: id => ({ tr, dispatch }) => {
        const { selection } = tr
        if (!id.trim() || !(selection instanceof TextSelection) || selection.empty) return false
        const { from, to } = selection
        if (!dispatch) return true
        const steps = tr.steps.length
        tr.addMark(from, to, this.type.create({ commentId: id }))
        if (tr.steps.length === steps) return false
        setRetirement(tr, id, false)
        return true
      },
      removeCommentMark: id => ({ tr, dispatch }) => {
        if (!id) return false
        if (dispatch) {
          removeComments(tr, this.type, new Set([id]))
          setRetirement(tr, id, true)
        }
        return true
      },
      setActiveComment: id => ({ tr, dispatch }) => {
        if (dispatch) {
          setCommentMeta(tr, { active: id })
          tr.setMeta('addToHistory', false)
        }
        return true
      },
      clearRetiredComments: () => ({ tr, dispatch }) => {
        if (dispatch) setCommentMeta(tr, { clearRetired: true, retirement: new Map() })
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const { type } = this
    return [new Plugin({
      key: commentKey,
      state: {
        init: () => ({ active: null, retired: new Set<string>(), decorations: DecorationSet.empty }),
        apply(tr, last: CommentState) {
          const meta: CommentMeta | undefined = tr.getMeta(commentKey)
          if (!meta && !tr.docChanged) return last
          let retired = last.retired
          if (meta?.clearRetired || meta?.retirement) {
            const next = new Set(meta.clearRetired ? [] : last.retired)
            for (const [id, remove] of meta.retirement ?? []) {
              if (remove) next.add(id)
              else next.delete(id)
            }
            retired = next
          }
          const selected = meta?.active !== undefined ? meta.active : last.active
          const active = selected && !retired.has(selected) ? selected : null
          if (!active) return { active, retired, decorations: DecorationSet.empty }
          const edits = active === last.active ? textEdits(tr) : null
          if (edits) {
            let decorations = last.decorations.map(tr.mapping, tr.doc)
            for (const { node, pos } of edits) {
              const start = pos + 1
              const ranges: Decoration[] = []
              visitComments(node, type, (mark, from, to) => {
                if (mark.attrs.commentId === active) ranges.push(Decoration.inline(start + from, start + to, { class: 'comment-active' }))
              })
              decorations = decorations.remove(decorations.find(start, pos + node.nodeSize - 1)).add(tr.doc, ranges)
            }
            return { active, retired, decorations }
          }
          const ranges: Decoration[] = []
          visitComments(tr.doc, type, (mark, from, to) => {
            if (mark.attrs.commentId === active) ranges.push(Decoration.inline(from, to, { class: 'comment-active' }))
          })
          return { active, retired, decorations: DecorationSet.create(tr.doc, ranges) }
        },
      },
      props: { decorations: state => commentKey.getState(state)?.decorations },
      appendTransaction(transactions, _old, state) {
        const retired = commentKey.getState(state)?.retired
        if (!retired?.size || !transactions.some(tr => tr.docChanged)) return null
        const tr = state.tr
        const mayRestoreComment = transactions.some(transaction => {
          if (!transaction.docChanged) return false
          const edits = textEdits(transaction)
          return !edits || edits.some(({ node }) => node.children.some(child =>
            child.marks.some(mark => mark.type === type && retired.has(mark.attrs.commentId))))
        })
        if (!mayRestoreComment) return null
        removeComments(tr, type, retired)
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null
      },
    })]
  },
})
