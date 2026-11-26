import { Monitor, Moon, Sun } from 'lucide-react'
import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { themeLabels } from '../theme/theme'
import type { ThemeMode } from '../theme/theme'
import type { DocumentMode } from '../workspace/document-mode'

export type DocumentSource = 'document' | 'paseo'

export interface Appearance {
  readonly mode: ThemeMode
  setMode(mode: ThemeMode): void
}

const themeOptions = {
  light: { icon: Sun },
  dark: { icon: Moon },
  system: { icon: Monitor },
} as const
const themeOrder = ['light', 'dark', 'system'] as const

export function ThemeControl({ mode, setMode }: Appearance) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const index = themeOrder.indexOf(mode)
  return <div className="theme-segment" role="radiogroup" aria-label="外观主题" aria-orientation="horizontal"
    style={{ '--theme-index': index } as CSSProperties}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const current = themeOrder.indexOf(mode)
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = (current + delta + themeOrder.length) % themeOrder.length
      event.preventDefault()
      setMode(themeOrder[next]!)
      buttons.current[next]?.focus()
    }}>
    <span className="theme-segment-thumb" aria-hidden="true" />
    {themeOrder.map((option, optionIndex) => {
      const Icon = themeOptions[option].icon
      const selected = mode === option
      return <button key={option} ref={button => { buttons.current[optionIndex] = button }} type="button"
        role="radio" aria-checked={selected} aria-label={themeLabels[option]} title={themeLabels[option]}
        tabIndex={selected ? 0 : -1} className="theme-option" onClick={() => setMode(option)}>
        <Icon size={14} aria-hidden="true" />
      </button>
    })}
  </div>
}

const modeOrder = ['preview', 'edit'] as const
const modeLabels: Record<DocumentMode, string> = { preview: '预览', edit: '编辑' }

export function ModeControl({ mode, setMode }: { readonly mode: DocumentMode; setMode: (mode: DocumentMode) => void }) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const index = modeOrder.indexOf(mode)
  return <div className="mode-segment" role="radiogroup" aria-label="文档模式" aria-orientation="horizontal"
    style={{ '--mode-index': index } as CSSProperties}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + modeOrder.length) % modeOrder.length
      event.preventDefault()
      setMode(modeOrder[next]!)
      buttons.current[next]?.focus()
    }}>
    <span className="mode-segment-thumb" aria-hidden="true" />
    {modeOrder.map((option, optionIndex) => <button key={option} ref={button => { buttons.current[optionIndex] = button }}
      type="button" role="radio" aria-checked={mode === option} aria-label={modeLabels[option]} title={modeLabels[option]}
      tabIndex={mode === option ? 0 : -1} className="mode-option" onClick={() => setMode(option)}>
      {modeLabels[option]}
    </button>)}
  </div>
}

const sourceOrder = ['document', 'paseo'] as const
const sourceLabels: Record<DocumentSource, string> = { document: '文档', paseo: 'Paseo' }

export function SourceControl({ source, setSource }: {
  readonly source: DocumentSource
  setSource(source: DocumentSource): void
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const index = sourceOrder.indexOf(source)
  return <div className="source-segment" role="radiogroup" aria-label="内容来源" aria-orientation="horizontal"
    style={{ '--source-index': index } as CSSProperties}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + sourceOrder.length) % sourceOrder.length
      event.preventDefault()
      setSource(sourceOrder[next]!)
      buttons.current[next]?.focus()
    }}>
    <span className="source-segment-thumb" aria-hidden="true" />
    {sourceOrder.map((option, optionIndex) => <button key={option} ref={button => { buttons.current[optionIndex] = button }}
      type="button" role="radio" aria-checked={source === option} aria-label={sourceLabels[option]} title={sourceLabels[option]}
      tabIndex={source === option ? 0 : -1} className="source-option" onClick={() => setSource(option)}>
      {sourceLabels[option]}
    </button>)}
  </div>
}
