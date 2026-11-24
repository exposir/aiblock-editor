import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { common, createLowlight } from 'lowlight'

export const CODE_LANGUAGES = [
  'plaintext', 'typescript', 'javascript', 'python', 'rust', 'go',
  'sql', 'json', 'bash', 'css', 'html', 'markdown',
] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

const aliases: Record<string, CodeLanguage> = {
  text: 'plaintext', plain: 'plaintext', ts: 'typescript', js: 'javascript', py: 'python',
  rs: 'rust', sh: 'bash', shell: 'bash', xml: 'html', md: 'markdown',
}

export function codeLanguage(value: unknown): CodeLanguage {
  if (typeof value !== 'string') return 'plaintext'
  const name = value.trim().toLowerCase()
  return CODE_LANGUAGES.find(language => language === name) ??
    (Object.hasOwn(aliases, name) ? aliases[name]! : 'plaintext')
}

const highlighter = createLowlight(common)

export interface CodeToken {
  readonly from: number
  readonly to: number
  readonly className: string
}

export function highlightCode(language: unknown, text: string): CodeToken[] {
  const grammar = codeLanguage(language)
  if (grammar === 'plaintext' || !text) return []

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
      updateCodeBlock: (pos: number, attrs: { language?: CodeLanguage; wrap?: boolean }) => ReturnType
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
          if (attrs.language !== undefined && attrs.language !== node.attrs.language) {
            tr.setNodeAttribute(pos, 'language', codeLanguage(attrs.language))
          }
          if (attrs.wrap !== undefined && attrs.wrap !== node.attrs.wrap) tr.setNodeAttribute(pos, 'wrap', attrs.wrap)
        }
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const { editor, type } = this
    const cache = new WeakMap<ProseMirrorNode, readonly CodeToken[]>()

    function decorate(doc: ProseMirrorNode) {
      const decorations: Decoration[] = []
      doc.descendants((node, pos) => {
        if (node.type !== type) return
        let tokens = cache.get(node)
        if (!tokens) {
          tokens = highlightCode(node.attrs.language, node.textContent)
          cache.set(node, tokens)
        }
        for (const token of tokens) {
          decorations.push(Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }))
        }
        return false
      })
      return DecorationSet.create(doc, decorations)
    }

    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: codeHighlightKey,
        state: {
          init: (_, state) => decorate(state.doc),
          apply(tr, previous) {
            if (!tr.docChanged && !tr.getMeta(codeHighlightKey)) return previous
            return editor.isInitialized && editor.view.composing
              ? previous.map(tr.mapping, tr.doc)
              : decorate(tr.doc)
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
