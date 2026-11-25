import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { registerCodeBlockAnchor } from '../components/code-block-anchors'
import { codeLanguage, isPreviewLanguage, viewModeFor } from '../extensions/code-languages'
import { isHugeCode } from '../extensions/long-code-highlight'
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
  view: EditorView,
): NodeView {
  const rich = isPreviewLanguage(codeLanguage(initial.attrs.language))
  const { pre, code } = sourceDOM(owner, initial)
  const dom = rich ? owner.createElement('div') : pre
  const panel = rich ? owner.createElement('div') : null
  const preview = panel && attachCodePreview(panel)
  let node = initial
  let unregister = registerCodeBlockAnchor(view, node, dom)

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
    if (isHugeCode(next)) pre.dataset.longCode = 'true'
    else delete pre.dataset.longCode
    if (!panel) return
    pre.dataset.codeSource = ''
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
      const changed = !node.eq(next)
      if (changed) apply(next)
      node = next
      if (changed) {
        unregister()
        unregister = registerCodeBlockAnchor(view, next, dom)
      }
      return true
    },
    ignoreMutation(mutation) {
      return mutation.type !== 'selection' && !code.contains(mutation.target)
    },
    destroy() {
      unregister()
      preview?.destroy()
    },
  }
}
