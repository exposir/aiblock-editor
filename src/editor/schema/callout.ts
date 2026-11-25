import { Node, mergeAttributes } from '@tiptap/core'
import { calloutTheme } from '../types'
import type { CalloutAttributes } from '../types'

const defaultCallout: CalloutAttributes = { icon: '💡', theme: 'blue' }

export const CalloutSchema = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      icon: {
        default: defaultCallout.icon,
        parseHTML: element => element.getAttribute('data-icon') || defaultCallout.icon,
        renderHTML: attrs => ({ 'data-icon': attrs.icon }),
      },
      theme: {
        default: defaultCallout.theme,
        parseHTML: element => calloutTheme(element.getAttribute('data-theme')),
        renderHTML: attrs => ({ 'data-theme': calloutTheme(attrs.theme) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'aside[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },
})
