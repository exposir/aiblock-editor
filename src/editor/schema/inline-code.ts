import InlineCode from '@tiptap/extension-code'

export const CommentableInlineCode = InlineCode.extend({
  excludes: 'code bold italic strike underline link textStyle highlight',
})
