import { common, createLowlight } from 'lowlight'
import { codeLanguage, isPreviewLanguage } from './code-languages'

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

