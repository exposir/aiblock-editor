import { Extension } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { hasMathMarkup } from '../preview/math-markup'
import { markdownToSlice } from './markdown-codec'

const markdownPasteKey = new PluginKey('markdownPaste')

function markdownCandidate(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 2_000_000) return false
  if (/^(?:{[\s\S]*}|\[[\s\S]*\])$/.test(trimmed)) {
    try {
      JSON.parse(trimmed)
      return false
    } catch { /* not JSON */ }
  }
  if (/^(?:https?|mailto|tel):\S+$/i.test(trimmed)) return false
  if (hasMathMarkup(text)) return true
  if (/^(?:```|~~~|>|#{1,6}\s|[-*+]\s|\s*\d+\.\s+\S|\|[^\n]*\||<details|::::columns|\[!\w+\]|==[^=\n]+==|`[^`\n]+`)/im.test(text)) return true
  if (/^\s*[-*+]\s+\[[ xX]\]\s+/m.test(text)) return true
  const lines = trimmed.split(/\r?\n/)
  const structural = lines.filter(line => /^(?:#{1,6}\s|>\s?|[-*+]\s+|\d+\.\s+|```|~~~|::::|:::column\b|<details|<\/details>|\|.*\|)/.test(line)).length
  if (structural >= 2) return true
  if (text.includes('\n') && /^\s*(?:[-*+]\s+|\d+\.\s+)/m.test(text)) return true
  if (/\[[^\]\n]+\]\([^()\s]*(?:\([^()\n]*\)[^()\s]*)*\)/.test(text)) return true
  if (/(?<![\p{L}\p{N}_*\\])\*\*(?=\S)[^*\n]+(?<!\*)\*\*(?![\p{L}\p{N}_*])/u.test(text)) return true
  if (/(?<![\p{L}\p{N}_*\\])\*(?=\S)[^*\n]+(?<!\*)\*(?![\p{L}\p{N}_*])/u.test(text)) return true
  if (/(?<![\p{L}\p{N}_*\\])_(?=\S)[^_\n]+_(?![\p{L}\p{N}_*])/u.test(text)) return true
  if (/`[^`\n]+`/.test(text)) return true
  if (/^#{1,6}\s+\S/m.test(text)) return true
  if (/^>\s*\[!\w+\]/im.test(text)) return true
  if (/^<details(\s+open)?>/im.test(text) || /^::::columns$/im.test(text)) return true
  return false
}

export function looksLikeMarkdown(text: string): boolean {
  return markdownCandidate(text)
}

function isPlainTextOnly(data: DataTransfer): boolean {
  const html = data.getData('text/html').trim()
  if (!html) return true
  const text = data.getData('text/plain').trim()
  if (!text) return false
  return !hasRichHtml(html) && isPlainTextHtml(html, text)
}

function inCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'codeBlock') return true
  }
  return false
}

function isPlainTextHtml(html: string, text: string): boolean {
  if (!html.trim()) return true
  if (!text.trim()) return false
  const plain = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
  return plain.trim() === text.trim()
}

function hasRichHtml(html: string): boolean {
  return /<(?:strong|b|em|i|span|a|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|blockquote|details|summary|pre|code)\b/i.test(html)
}

function insertMarkdown(state: EditorState, text: string): Transaction | null {
  const slice = markdownToSlice(state.schema, text)
  if (!slice.content.size) return null
  const tr = state.tr.replaceSelection(slice)
  tr.setMeta(markdownPasteKey, true)
  return tr
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  priority: 100,

  addProseMirrorPlugins() {
    return [new Plugin({
      key: markdownPasteKey,
      props: {
        handlePaste(view, event) {
          const data = event.clipboardData
          if (!data || inCodeBlock(view.state)) return false
          const text = data.getData('text/plain')
          if (!isPlainTextOnly(data)) return false
          if (!looksLikeMarkdown(text)) return false
          const tr = insertMarkdown(view.state, text)
          if (!tr) return false
          view.dispatch(tr)
          return true
        },
      },
    })]
  },
})
