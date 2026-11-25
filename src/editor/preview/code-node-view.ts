import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { codeLanguage, isPreviewLanguage, viewModeFor } from '../extensions/code-languages'
import { attachCodePreview } from './code-preview'

function sourceDOM(owner: Document, node: ProseMirrorNode) {
  const { dom, contentDOM } = DOMSerializer.renderSpec(owner, node.type.spec.toDOM!(node))
  return { pre: dom as HTMLPreElement, code: contentDOM as HTMLElement }
}

function syncAttributes(element: HTMLElement, attrs: NamedNodeMap) {
  const selected = element.classList.contains('ProseMirror-selectednode')
  for (const { name } of Array.from(element.attributes)) {
    if (!attrs.getNamedItem(name)) element.removeAttribute(name)
  }
  for (const { name, value } of Array.from(attrs)) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value)
  }
  if (selected) element.classList.add('ProseMirror-selectednode')
}

export function codeNodeView(
  owner: Document,
  initial: ProseMirrorNode,
): NodeView {
  const rich = isPreviewLanguage(codeLanguage(initial.attrs.language))
  const { pre, code } = sourceDOM(owner, initial)
  const dom = rich ? owner.createElement('div') : pre
  const panel = rich ? owner.createElement('div') : null
  const preview = panel && attachCodePreview(panel)
  let node = initial

  if (panel) {
    dom.className = 'rich-code-block'
    panel.className = 'rich-code-preview'
    panel.contentEditable = 'false'
    dom.append(panel, pre)
  }

  function apply(next: ProseMirrorNode) {
    if (!node.sameMarkup(next)) {
      const replacement = sourceDOM(owner, next)
      syncAttributes(pre, replacement.pre.attributes)
      syncAttributes(code, replacement.code.attributes)
    }
    if (!panel) return
    const language = codeLanguage(next.attrs.language)
    const mode = viewModeFor(language, next.attrs.viewMode)
    dom.dataset.viewMode = mode
    dom.dataset.previewLanguage = language
    for (const attr of ['data-block-id', 'data-block-bg']) {
      const value = pre.getAttribute(attr)
      if (value === null) continue
      dom.setAttribute(attr, value)
      pre.removeAttribute(attr)
    }
    pre.dataset.codeSource = ''
    panel.hidden = mode === 'code'
    pre.hidden = mode === 'preview'
    preview?.update(mode !== 'code' && isPreviewLanguage(language) ? language : undefined, next.textContent)
  }

  apply(initial)
  return {
    dom,
    contentDOM: code,
    update(next) {
      if (next.type !== node.type || rich !== isPreviewLanguage(codeLanguage(next.attrs.language))) return false
      if (!node.eq(next)) apply(next)
      node = next
      return true
    },
    ignoreMutation(mutation) {
      return mutation.type !== 'selection' && !code.contains(mutation.target)
    },
    destroy() { preview?.destroy() },
  }
}
