import { Palette } from 'lucide-react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { FloatingBlockControl } from '../components/FloatingBlockControl'
import { CALLOUT_THEMES, calloutTheme } from '../types'

const themeNames = {
  blue: '蓝色',
  gray: '灰色',
  yellow: '黄色',
  green: '绿色',
  red: '红色',
  purple: '紫色',
}

export function CalloutView({ editor, node, updateAttributes }: NodeViewProps) {
  const theme = calloutTheme(node.attrs.theme)
  const nextTheme = CALLOUT_THEMES[(CALLOUT_THEMES.indexOf(theme) + 1) % CALLOUT_THEMES.length]!

  return (
    <NodeViewWrapper className="callout" data-theme={theme}>
      <span className="callout-icon" contentEditable={false} aria-hidden="true">{node.attrs.icon}</span>
      <NodeViewContent className="callout-content" />
      {editor.isEditable && (
        <FloatingBlockControl
          revealOnHover
          className="block-control callout-theme"
          title={`切换至${themeNames[nextTheme]}`}
          aria-label={`将高亮块主题切换至${themeNames[nextTheme]}`}
          onMouseDown={event => event.preventDefault()}
          onClick={() => updateAttributes({ theme: nextTheme })}
        >
          <Palette size={16} aria-hidden="true" />
        </FloatingBlockControl>
      )}
    </NodeViewWrapper>
  )
}
