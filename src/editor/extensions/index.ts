import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import InlineCode from '@tiptap/extension-code'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { BlockIdExtension } from './block-id'
import { BlockDragExtension } from './block-drag'
import { Callout } from './callout'
import { CodeBlock } from './code-block'
import { Column, ColumnList } from './columns'
import { CommentMark } from './comment-mark'
import { EnhancedTable, EnhancedTableCell, EnhancedTableHeader, TableRow } from './enhanced-table'
import { MultiBlockSelectionExtension } from './multi-block-selection'
import { SlashCommand } from './slash-command'
import { Toggle, ToggleContent, ToggleSummary } from './toggle'
import { PortalTaskItem } from '../views/task-item-view'

const CommentableInlineCode = InlineCode.extend({ excludes: 'code bold italic strike underline link textStyle highlight' })

export { BlockIdExtension, extractOutline } from './block-id'
export { BlockDragExtension, allowsColumnDrop, createBlockMoveTransaction, getBlockDropSide } from './block-drag'
export type { BlockDragSource, BlockDropSide, BlockDropTarget } from './block-drag'
export { Callout } from './callout'
export { Toggle, ToggleContent, ToggleSummary } from './toggle'
export { ColumnList, Column, createColumns, insertBlockIntoColumnEdge, removeColumn, resizeColumns, unwrapColumnList } from './columns'
export { MIN_COLUMN_WIDTH, MAX_COLUMNS, normalizeColumnWidths } from './column-widths'
export { MultiBlockSelection, MultiBlockSelectionExtension } from './multi-block-selection'
export { SlashCommand, openSlashMenu } from './slash-command'
export { EnhancedTable, EnhancedTableCell, EnhancedTableHeader } from './enhanced-table'
export { CodeBlock, CODE_LANGUAGES, highlightCode } from './code-block'
export { CommentMark, commentAnchor } from './comment-mark'

export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({ code: false, codeBlock: false, link: false, underline: false, trailingNode: false }),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node }) => node.type.name === 'toggleSummary' ? '输入折叠标题' : '输入正文',
    }),
    EnhancedTable,
    TableRow,
    EnhancedTableCell,
    EnhancedTableHeader,
    TaskList,
    PortalTaskItem,
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    CommentableInlineCode,
    Link.configure({ openOnClick: false }),
    Underline,
    Callout,
    Toggle,
    ToggleSummary,
    ToggleContent,
    ColumnList,
    Column,
    CodeBlock,
    CommentMark,
    SlashCommand,
    MultiBlockSelectionExtension,
    BlockDragExtension,
    BlockIdExtension,
  ]
}
