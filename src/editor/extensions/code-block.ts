import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { codeNodeView } from '../preview/code-node-view'
import { codeLanguage, isPreviewLanguage, viewModeFor } from './code-languages'
import type { CodeLanguage, CodeViewMode } from './code-languages'
import { changedNodes, createNodeIndex, textEdits } from './document-changes'
import { highlightCode } from './code-syntax'
import type { CodeToken } from './code-syntax'
import { codeHighlightWorker, isLongCode, windowOfTokens } from './long-code-highlight'
import { CodeBlockSchema } from '../schema/code-block'

export { highlightCode } from './code-syntax'

export { CODE_LANGUAGES, codeLanguage } from './code-languages'
export type { CodeLanguage } from './code-languages'

export const codeHighlightKey = new PluginKey<DecorationSet>('codeHighlight')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enhancedCodeBlock: {
      updateCodeBlock: (pos: number, attrs: { language?: CodeLanguage; wrap?: boolean; viewMode?: CodeViewMode }) => ReturnType
    }
  }
}

export const CodeBlock = CodeBlockSchema.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      updateCodeBlock: (pos, attrs) => ({ tr, dispatch }) => {
        if (!Number.isInteger(pos) || pos < 0 || pos >= tr.doc.content.size) return false
        const node = tr.doc.nodeAt(pos)
        if (node?.type !== this.type) return false
        if (dispatch) {
          const currentLanguage = codeLanguage(node.attrs.language)
          const language = codeLanguage(attrs.language ?? currentLanguage)
          if (attrs.language !== undefined && language !== node.attrs.language) tr.setNodeAttribute(pos, 'language', language)
          const enteringPreview = !isPreviewLanguage(currentLanguage) && isPreviewLanguage(language)
          if (isPreviewLanguage(language) && (attrs.viewMode !== undefined || enteringPreview)) {
            const mode = viewModeFor(language, attrs.viewMode)
            if (node.attrs.viewMode !== mode) tr.setNodeAttribute(pos, 'viewMode', mode)
          }
          if (attrs.wrap !== undefined && attrs.wrap !== node.attrs.wrap) tr.setNodeAttribute(pos, 'wrap', attrs.wrap)
        }
        return true
      },
    }
  },

  addNodeView() {
    return ({ node, view }) => codeNodeView(view.dom.ownerDocument, node)
  },

  addProseMirrorPlugins() {
    const { editor, type } = this
    const cache = new WeakMap<ProseMirrorNode, readonly CodeToken[]>()
    const codes = createNodeIndex(node => node.type === type)

    function asDecorations(tokens: readonly CodeToken[], pos: number) {
      return tokens.map(token =>
        Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }))
    }

    function decorationsAt(node: ProseMirrorNode, pos: number) {
      if (isLongCode(node)) return []
      let tokens = cache.get(node)
      if (!tokens) {
        tokens = highlightCode(node.attrs.language, node.textContent)
        cache.set(node, tokens)
      }
      return asDecorations(tokens, pos)
    }

    function decorate(doc: ProseMirrorNode) {
      return DecorationSet.create(doc, codes(doc).flatMap(({ node, pos }) => decorationsAt(node, pos)))
    }

    function removeBlock(set: DecorationSet, node: ProseMirrorNode, pos: number) {
      return set.remove(set.find(pos + 1, pos + node.nodeSize - 1))
    }

    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: codeHighlightKey,
        appendTransaction(_transactions, _previous, state) {
          const { selection } = state
          if (!(selection instanceof TextSelection) || !selection.empty) return null
          const { $head } = selection
          if ($head.parent.type !== type ||
              viewModeFor(codeLanguage($head.parent.attrs.language), $head.parent.attrs.viewMode) !== 'preview') return null
          return state.tr.setSelection(NodeSelection.create(state.doc, $head.before()))
        },
        state: {
          init: (_, state) => decorate(state.doc),
          apply(tr, previous) {
            const request = tr.getMeta(codeHighlightKey) as true | { node: ProseMirrorNode; pos: number; tokens: readonly CodeToken[] } | undefined
            if (!tr.docChanged && !request) return previous
            if (request === true) return decorate(tr.doc)
            if (request && tr.doc.nodeAt(request.pos) === request.node) {
              return removeBlock(previous, request.node, request.pos).add(tr.doc, asDecorations(request.tokens, request.pos))
            }
            let next = previous.map(tr.mapping, tr.doc)
            if (editor.isInitialized && editor.view.composing) return next
            const edits = textEdits(tr)
            function update(node: ProseMirrorNode, pos: number) {
              if (node.type === type) next = removeBlock(next, node, pos).add(tr.doc, decorationsAt(node, pos))
            }
            if (edits) for (const { node, pos } of edits) update(node, pos)
            else changedNodes(tr.before, tr.doc, update)
            return next
          },
        },
        view(view) {
          const owner = view.dom.ownerDocument
          const win = owner.defaultView
          const highlights = new WeakMap<ProseMirrorNode, readonly CodeToken[]>()
          const applied = new WeakMap<ProseMirrorNode, { from: number; to: number }>()
          const worker = codeHighlightWorker()
          let timer: ReturnType<typeof setTimeout> | undefined
          let running = false
          const failed = new WeakSet<ProseMirrorNode>()
          let long = false
          let closed = false

          function schedule() {
            clearTimeout(timer)
            timer = setTimeout(render, 140)
          }

          function apply(node: ProseMirrorNode, pos: number, tokens: readonly CodeToken[], offset: number) {
            const window = windowOfTokens(tokens, offset, applied.get(node))
            if (!window) return
            applied.set(node, window)
            view.dispatch(view.state.tr.setMeta(codeHighlightKey, { node, pos, tokens: tokens.slice(window.from, window.to) })
              .setMeta('addToHistory', false))
          }

          function render() {
            if (closed || view.composing) return
            const { doc, selection } = view.state
            const blocks = codes(doc).filter(({ node }) => isLongCode(node))
            long = !!blocks.length
            for (const { node, pos } of blocks) {
              const dom = view.nodeDOM(pos)
              if (!(dom instanceof HTMLElement)) continue
              const rect = dom.getBoundingClientRect()
              const editing = selection.head > pos && selection.head < pos + node.nodeSize
              const height = win?.innerHeight ?? 0
              if (!editing && (rect.bottom < -300 || rect.top > height + 300)) continue
              const viewport = rect.top < 0 && rect.bottom > 0 && typeof owner.elementFromPoint === 'function'
                ? view.posAtCoords({ left: Math.max(rect.left + 22, 0), top: Math.min(rect.bottom - 1, 80) })?.pos
                : undefined
              const offset = viewport !== undefined && viewport > pos && viewport < pos + node.nodeSize
                ? viewport - pos - 1 : editing ? selection.head - pos - 1 : 0
              const cached = highlights.get(node)
              if (cached) {
                apply(node, pos, cached, offset)
              } else if (!running && !failed.has(node)) {
                running = true
                void worker.color(node.attrs.language, node.textContent).then(tokens => {
                  if (closed) return
                  highlights.set(node, tokens)
                  if (view.state.doc.nodeAt(pos) === node && !view.composing) apply(node, pos, tokens, offset)
                }).catch(() => { failed.add(node) }).finally(() => {
                  running = false
                  if (!closed) schedule()
                })
              }
            }
          }

          const onScroll = () => { if (long) schedule() }
          win?.addEventListener('scroll', onScroll, { passive: true })
          schedule()
          return {
            update(_view, previous) {
              if (previous.doc !== view.state.doc || !previous.selection.eq(view.state.selection)) schedule()
            },
            destroy() {
              closed = true
              clearTimeout(timer)
              win?.removeEventListener('scroll', onScroll)
              worker.destroy()
            },
          }
        },
        props: {
          decorations: state => codeHighlightKey.getState(state),
          handleDOMEvents: {
            compositionend(view) {
              queueMicrotask(() => {
                if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(codeHighlightKey, true))
              })
              return false
            },
          },
        },
      }),
    ]
  },
}).configure({ defaultLanguage: 'plaintext' })
