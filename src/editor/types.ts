import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface OutlineEntry {
  readonly blockId: string
  readonly level: number
  readonly text: string
  readonly pos: number
}

export const CALLOUT_THEMES = ['blue', 'gray', 'yellow', 'green', 'red', 'purple'] as const

export type CalloutTheme = (typeof CALLOUT_THEMES)[number]

export function calloutTheme(value: unknown): CalloutTheme {
  return CALLOUT_THEMES.find(theme => theme === value) ?? 'blue'
}

export interface CalloutAttributes {
  icon: string
  theme: CalloutTheme
}

export interface ToggleAttributes {
  open: boolean
}

export type ColumnLayout = number | readonly (readonly ProseMirrorNode[])[]

export type ColumnEdgeTarget =
  | { blockPos: number; side: 'left' | 'right' }
  | { columnListPos: number; columnIndex: number; side: 'left' | 'right' }

export const BLOCK_BACKGROUNDS = ['default', 'gray', 'blue', 'green', 'yellow', 'red', 'purple'] as const

export type BlockBackground = (typeof BLOCK_BACKGROUNDS)[number]

export type BlockConversion =
  | { type: 'heading'; level: 1 | 2 | 3 }
  | { type: 'paragraph' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'callout' | 'toggle' | 'codeBlock' }
