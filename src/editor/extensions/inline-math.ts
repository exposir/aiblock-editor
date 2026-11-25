import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { findInlineMath, inlineMathMarkdown } from '../preview/math-markup'
import { renderMath } from '../preview/math'

export const inlineMathEditKey = new PluginKey<number | null>('inlineMathEdit')

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: element => element.getAttribute('data-latex') ?? '',
        renderHTML: attrs => ({ 'data-latex': attrs.latex }),
      },
    }
  },

  parseHTML() { return [{ tag: 'span[data-inline-math]' }] },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-inline-math': '', contenteditable: 'false' }), String(node.attrs.latex)]
  },

  renderText({ node }) { return inlineMathMarkdown(String(node.attrs.latex)) },

  addNodeView() {
    const { type } = this
    return ({ node, view }) => {
      const dom = view.dom.ownerDocument.createElement('span')
      dom.className = 'inline-math'
      dom.dataset.inlineMath = ''
      dom.contentEditable = 'false'
      let revision = 0
      let source: string | undefined
      function show(latex: string) {
        if (source === latex) return
        source = latex
        const current = ++revision
        dom.dataset.latex = latex
        dom.textContent = latex
        dom.classList.remove('code-preview-error')
        void renderMath(latex, false).then(markup => {
          if (current !== revision) return
          if (markup) dom.innerHTML = markup
          else dom.classList.add('code-preview-error')
        })
      }
      show(String(node.attrs.latex))
      return {
        dom,
        update(next) {
          if (next.type !== type) return false
          show(String(next.attrs.latex))
          return true
        },
        ignoreMutation: () => true,
        destroy() { revision++ },
      }
    }
  },

  addInputRules() {
    return [new InputRule({
      find: text => {
        let offset = 0
        while (offset < text.length) {
          const match = findInlineMath(text.slice(offset))
          if (!match) return null
          const index = offset + match.index
          offset = index + match.raw.length
          if (offset === text.length) return { index, text: match.raw, data: { latex: match.latex } }
        }
        return null
      },
      handler: ({ state, range, match }) => {
        state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match.data?.latex }))
      },
    })]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection, tr } = this.editor.state
        if (!(selection instanceof NodeSelection) || selection.node.type !== this.type || !this.editor.isEditable) return false
        this.editor.view.dispatch(tr.setMeta(inlineMathEditKey, selection.from))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const { editor, type } = this
    return [new Plugin<number | null>({
      key: inlineMathEditKey,
      state: {
        init: () => null,
        apply(tr, previous) {
          const requested: unknown = tr.getMeta(inlineMathEditKey)
          if (requested === null || typeof requested === 'number') return requested
          if (previous === null) return null
          const mapped = tr.mapping.mapResult(previous, 1)
          return !mapped.deleted && tr.doc.nodeAt(mapped.pos)?.type === type ? mapped.pos : null
        },
      },
      props: {
        handleClickOn(view, _pos, node, nodePos, _event, direct) {
          if (!direct || node.type !== type || !editor.isEditable) return false
          view.dispatch(view.state.tr
            .setSelection(NodeSelection.create(view.state.doc, nodePos))
            .setMeta(inlineMathEditKey, nodePos))
          return true
        },
      },
    })]
  },
})
