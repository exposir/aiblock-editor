import { Node, mergeAttributes } from '@tiptap/core'

export const ToggleSchema = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: element => element.getAttribute('data-open') !== 'false',
        renderHTML: attrs => ({ 'data-open': String(attrs.open !== false) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '' }), 0]
  },
})

export const ToggleSummarySchema = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-toggle-summary]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-summary': '' }), 0]
  },
})

export const ToggleContentSchema = Node.create({
  name: 'toggleContent',
  content: 'block+',

  parseHTML() {
    return [{
      tag: 'div[data-toggle-content]',
      contentElement: element => element.querySelector<HTMLElement>(':scope > .toggle-body-inner') ?? element,
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div', mergeAttributes(HTMLAttributes, { 'data-toggle-content': '' }),
      ['div', { class: 'toggle-body-inner' }, 0],
    ]
  },
})
