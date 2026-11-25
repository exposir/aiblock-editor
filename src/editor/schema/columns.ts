import { Node, mergeAttributes } from '@tiptap/core'

export const ColumnListSchema = Node.create({
  name: 'columnList',
  group: 'block',
  content: 'column+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-column-list]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column-list': '' }), 0]
  },
})

export const ColumnSchema = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: element => {
          const width = Number(element.getAttribute('data-width'))
          return Number.isFinite(width) && width > 0 ? width : null
        },
        renderHTML: attrs => typeof attrs.width === 'number' ? { 'data-width': attrs.width } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-column]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '' }), 0]
  },
})
