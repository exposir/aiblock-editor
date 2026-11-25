import type { CalloutAttributes } from '../types'
import { CalloutView } from '../views/callout-view'
import { CalloutSchema } from '../schema/callout'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: (attributes?: Partial<CalloutAttributes>) => ReturnType
    }
  }
}

export const Callout = CalloutSchema.extend({
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
    return CalloutView
  },
})
