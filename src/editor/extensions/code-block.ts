import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { common, createLowlight } from 'lowlight'
import { codeNodeView } from '../preview/code-node-view'
import { codeLanguage, isPreviewLanguage, viewModeFor } from './code-languages'
import type { CodeLanguage, CodeViewMode } from './code-languages'
import { createNodeIndex, textEdits } from './document-changes'

export { CODE_LANGUAGES, codeLanguage } from './code-languages'
export type { CodeLanguage } from './code-languages'

const highlighter = createLowlight(common)

export interface CodeToken {
  readonly from: number
  readonly to: number
  readonly className: string
}

export function highlightCode(language: unknown, text: string): CodeToken[] {
  const grammar = codeLanguage(language)
  if (grammar === 'plaintext' || isPreviewLanguage(grammar) || !text) return []

  const root = highlighter.highlight(grammar === 'html' ? 'xml' : grammar, text)
  const tokens: CodeToken[] = []
  let offset = 0

  function visit(node: (typeof root.children)[number], classes: readonly string[]) {
    if (node.type === 'text') {
      const from = offset
      offset += node.value.length
      if (classes.length && offset > from) tokens.push({ from, to: offset, className: classes.join(' ') })
    } else if (node.type === 'element') {
      const own = node.properties.className
      const next = Array.isArray(own) ? [...classes, ...own.filter(value => typeof value === 'string')] : classes
      for (const child of node.children) visit(child, next)
    }
  }

  for (const child of root.children) visit(child, [])
  return tokens
}

export const codeHighlightKey = new PluginKey<DecorationSet>('codeHighlight')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enhancedCodeBlock: {
      updateCodeBlock: (pos: number, attrs: { language?: CodeLanguage; wrap?: boolean; viewMode?: CodeViewMode }) => ReturnType
    }
  }
}

export const CodeBlock = BaseCodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: 'plaintext',
        parseHTML: element => codeLanguage(element.getAttribute('data-language') ??
          [...(element.firstElementChild?.classList ?? [])].find(name => name.startsWith('language-'))?.slice(9)),
        renderHTML: attrs => ({ 'data-language': codeLanguage(attrs.language) }),
      },
      viewMode: {
        default: 'preview',
        parseHTML: element => viewModeFor('mermaid', element.getAttribute('data-view-mode')),
        renderHTML: attrs => isPreviewLanguage(codeLanguage(attrs.language))
          ? { 'data-view-mode': viewModeFor(codeLanguage(attrs.language), attrs.viewMode) }
          : {},
      },
      wrap: {
        default: false,
        parseHTML: element => element.getAttribute('data-wrap') === 'true',
        renderHTML: attrs => ({ 'data-wrap': String(attrs.wrap === true) }),
      },
    }
  },

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

    function decorationsAt(node: ProseMirrorNode, pos: number) {
      let tokens = cache.get(node)
      if (!tokens) {
        tokens = highlightCode(node.attrs.language, node.textContent)
        cache.set(node, tokens)
      }
      return tokens.map(token =>
        Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }))
    }

    function decorate(doc: ProseMirrorNode) {
      return DecorationSet.create(doc, codes(doc).flatMap(({ node, pos }) => decorationsAt(node, pos)))
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
            if (!tr.docChanged && !tr.getMeta(codeHighlightKey)) return previous
            if (editor.isInitialized && editor.view.composing) return previous.map(tr.mapping, tr.doc)
            const edits = tr.getMeta(codeHighlightKey) ? null : textEdits(tr)
            if (!edits) return decorate(tr.doc)
            let next = previous.map(tr.mapping, tr.doc)
            for (const { node, pos } of edits) {
              if (node.type !== type) continue
              next = next.remove(next.find(pos + 1, pos + node.nodeSize - 1))
                .add(tr.doc, decorationsAt(node, pos))
            }
            return next
          },
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
