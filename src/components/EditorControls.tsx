import { Check, Monitor, Moon, Palette, Sun, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from '../editor/components/editor-ui'
import { themePresetGroupLabels, themePresetList, themePresetPalette } from '../theme/theme-presets'
import type { ThemePresetGroup, ThemePresetId } from '../theme/theme-presets'
import { themeLabels } from '../theme/theme'
import type { ResolvedTheme, ThemeMode } from '../theme/theme'
import type { DocumentMode } from '../workspace/document-mode'

export type DocumentSource = 'document' | 'paseo'

export interface Appearance {
  readonly mode: ThemeMode
  readonly preset?: ThemePresetId
  readonly resolvedTheme?: ResolvedTheme
  setMode(mode: ThemeMode): void
  setPreset?(preset: ThemePresetId): void
}

const themeOptions = {
  light: { icon: Sun },
  dark: { icon: Moon },
  system: { icon: Monitor },
} as const
const themeOrder = ['light', 'dark', 'system'] as const

export function ThemeControl({ mode, setMode, preset, resolvedTheme, setPreset }: Appearance) {
  return <div className="theme-control-cluster">
    <ThemeModeControl mode={mode} setMode={setMode} />
    <PresetControl preset={preset} resolvedTheme={resolvedTheme} setPreset={setPreset} />
  </div>
}

function ThemeModeControl({ mode, setMode }: Pick<Appearance, 'mode' | 'setMode'>) {
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

function PresetControl({ preset = 'paper', resolvedTheme, setPreset }: {
  readonly preset?: ThemePresetId
  readonly resolvedTheme?: ResolvedTheme
  readonly setPreset?: (preset: ThemePresetId) => void
}) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<'all' | ThemePresetGroup>('all')
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const resolved = resolvedTheme ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const selected = themePresetPalette(preset, resolved)
  useAnchoredPosition(panel, open ? anchor : null, 'bottom-end')

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLButtonElement>('.theme-preset-card[aria-pressed="true"], .theme-preset-card')
        ?.focus({ preventScroll: true }))
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor?.contains(event.target)) {
        setOpen(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      anchor?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [anchor, open])

  const cards = category === 'all'
    ? themePresetList
    : themePresetList.filter(item => item.group === category)

  return <>
    <button type="button" ref={setAnchor}
      className="theme-preset-trigger" aria-label="配色主题" title="配色主题"
      aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(value => !value)}>
      <Palette size={14} aria-hidden="true" />
      <span className="theme-preset-dot" style={{ backgroundColor: selected.accent }} aria-hidden="true" />
    </button>
    {open && createPortal(
      <div ref={panel} className="theme-preset-panel" role="dialog" aria-label="配色主题">
        <div className="theme-preset-heading">
          <div>
            <h2>配色主题</h2>
            <small>{resolved === 'dark' ? '深色预览' : '浅色预览'}</small>
          </div>
          <button type="button" className="icon-control" aria-label="关闭配色主题" onClick={() => setOpen(false)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="theme-preset-tabs" role="group" aria-label="配色分类">
          {([
            ['all', '全部'],
            ['editorial', themePresetGroupLabels.editorial],
            ['brand', themePresetGroupLabels.brand],
            ['developer', themePresetGroupLabels.developer],
          ] as const).map(([value, label]) => <button type="button" key={value}
            aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>)}
        </div>
        <div className="theme-preset-grid">
          {cards.map(item => {
            const palette = themePresetPalette(item.id, resolved)
            const active = item.id === preset
            return <button type="button" key={item.id} className="theme-preset-card" data-preset={item.id}
              aria-label={`${item.name} ${item.englishName}`} aria-pressed={active}
              onClick={() => {
                setPreset?.(item.id)
                setOpen(false)
              }}>
              <span className="theme-preset-mini" style={{ backgroundColor: palette.workspace }}>
                <span className="theme-preset-mini-paper" style={{
                  backgroundColor: palette.paper,
                  borderColor: palette.borderPaper,
                }}>
                  <i style={{ backgroundColor: palette.accent }} />
                  <b style={{ backgroundColor: palette.ink }} />
                  <b style={{ backgroundColor: palette.inkSecondary }} />
                </span>
              </span>
              <span className="theme-preset-name"><strong>{item.name}</strong><small>{item.englishName}</small></span>
              {active && <Check className="theme-preset-check" size={14} aria-hidden="true" />}
            </button>
          })}
        </div>
      </div>,
      document.body,
    )}
  </>
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
