import { InputRule } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { findInlineMath } from '../preview/math-markup'
import { observeViewport } from '../components/viewport'
import { renderMath } from '../preview/math'
import { InlineMathSchema } from '../schema/inline-math'

export const inlineMathEditKey = new PluginKey<number | null>('inlineMathEdit')

export const InlineMath = InlineMathSchema.extend({
  addNodeView() {
    const { type } = this
    return ({ node, view }) => {
      const dom = view.dom.ownerDocument.createElement('span')
      dom.className = 'inline-math'
      dom.dataset.inlineMath = ''
      dom.contentEditable = 'false'
      let revision = 0
      let source = String(node.attrs.latex)
      let near = false
      let rendered = false
      function placeholder() {
        dom.dataset.latex = source
        dom.textContent = source
        dom.classList.remove('code-preview-error')
      }
      function draw() {
        if (!near || rendered) return
        const current = ++revision
        void renderMath(source, false).then(markup => {
          if (current !== revision || !near) return
          rendered = true
          if (markup) dom.innerHTML = markup
          else dom.classList.add('code-preview-error')
        })
      }
      placeholder()
      const stop = observeViewport(dom, 300, visible => {
        near = visible
        if (near) draw()
        else revision++
      })
      return {
        dom,
        update(next) {
          if (next.type !== type) return false
          const latex = String(next.attrs.latex)
          if (latex !== source) {
            revision++
            source = latex
            rendered = false
            placeholder()
            draw()
          }
          return true
        },
        ignoreMutation: () => true,
        destroy() { revision++; stop() },
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
