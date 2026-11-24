import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { calloutTheme } from '../types'
import type { CalloutAttributes } from '../types'
import { CalloutView } from '../views/callout-view'

const defaultCallout: CalloutAttributes = { icon: '💡', theme: 'blue' }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: (attributes?: Partial<CalloutAttributes>) => ReturnType
    }
  }
}

export const Callout = Node.create({
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

  addCommands() {
    return {
      insertCallout: attributes => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: attributes,
        content: [{ type: 'paragraph' }],
      }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView, { attrs: ({ HTMLAttributes }) => HTMLAttributes })
  },
})
