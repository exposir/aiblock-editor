import { getSchema } from '@tiptap/core'
import type { Extensions } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { BlockIdExtension } from '../extensions/block-id'
import { MultiBlockSelectionExtension } from '../extensions/multi-block-selection'
import { CommentMark } from '../extensions/comment-mark'
import { EnhancedTable, EnhancedTableCell, EnhancedTableHeader, TableRow } from '../extensions/enhanced-table'
import { CalloutSchema } from './callout'
import { ToggleSchema, ToggleSummarySchema, ToggleContentSchema } from './toggle'
import { ColumnListSchema, ColumnSchema } from './columns'
import { CodeBlockSchema } from './code-block'
import { InlineMathSchema } from './inline-math'
import { ImageBlockSchema } from './image-block'
import { CommentableInlineCode } from './inline-code'

export function createSchemaExtensions(): Extensions {
  return [
    StarterKit.configure({ code: false, codeBlock: false, link: false, underline: false, trailingNode: false }),
    EnhancedTable,
    TableRow,
    EnhancedTableCell,
    EnhancedTableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    CommentableInlineCode,
    Link.configure({ openOnClick: false }),
    Underline,
    CalloutSchema,
    ToggleSchema,
    ToggleSummarySchema,
    ToggleContentSchema,
    ColumnListSchema,
    ColumnSchema,
    CodeBlockSchema,
    InlineMathSchema,
    ImageBlockSchema,
    CommentMark,
    MultiBlockSelectionExtension,
    BlockIdExtension,
  ]
}

export function createDocumentSchema(): Schema {
  return getSchema(createSchemaExtensions())
}
