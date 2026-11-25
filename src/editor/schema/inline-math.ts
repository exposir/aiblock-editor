import { Node, mergeAttributes } from '@tiptap/core'
import { inlineMathMarkdown } from '../preview/math-markup'

export const InlineMathSchema = Node.create({
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
})
