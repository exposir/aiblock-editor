import {
  isThemePresetId, parseThemePreset, themePresetBackground, themePresetVariableNames, themePresetVariables,
} from './theme-presets.js'
import type { ThemePresetId } from './theme-presets.js'

export const themeModes = ['system', 'light', 'dark'] as const
export type ThemeMode = typeof themeModes[number]
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'aiblock-editor.theme.v1'
export const THEME_PRESET_STORAGE_KEY = 'aiblock-editor.theme-preset.v1'
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'
export const THEME_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
export const themeLabels: Record<ThemeMode, string> = { system: '跟随系统', light: '浅色', dark: '深色' }
export const themeBackgrounds: Record<ResolvedTheme, string> = { light: '#F5F4EF', dark: '#1B1A18' }

interface ThemeTransitionState {
  sequence: number
  active?: ViewTransition
  frame?: { readonly id: number; readonly animation: boolean }
}

const transitionStates = new WeakMap<Document, ThemeTransitionState>()

function transitionState(document: Document): ThemeTransitionState {
  let state = transitionStates.get(document)
  if (!state) {
    state = { sequence: 0 }
    transitionStates.set(document, state)
  }
  return state
}

function applyAppearance(document: Document, theme: ResolvedTheme, preset: ThemePresetId) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.themePreset = preset
  root.style.colorScheme = theme
  for (const name of themePresetVariableNames) root.style.removeProperty(name)
  const variables = themePresetVariables(preset, theme)
  for (const name of themePresetVariableNames) {
    const value = variables[name]
    if (value) root.style.setProperty(name, value)
  }
  root.style.removeProperty('background-color')
}

function interruptThemeTransition(host: Window, state: ThemeTransitionState) {
  const document = host.document
  const interrupted = Boolean(state.active)
  state.sequence++
  if (state.active) {
    try { state.active.skipTransition() } catch { /* A finished transition is already harmless. */ }
    state.active = undefined
  }
  if (state.frame !== undefined) {
    if (state.frame.animation) host.cancelAnimationFrame(state.frame.id)
    else host.clearTimeout(state.frame.id)
    state.frame = undefined
  }
  delete document.documentElement.dataset.themeTransitioning
  return interrupted
}

function clearTransitionAfterPaint(host: Window, state: ThemeTransitionState, sequence: number) {
  const document = host.document
  const clear = () => {
    if (state.sequence !== sequence) return
    delete document.documentElement.dataset.themeTransitioning
    state.frame = undefined
  }
  if (typeof host.requestAnimationFrame === 'function') {
    const id = host.requestAnimationFrame(() => {
      if (state.sequence !== sequence) return
      const next = host.requestAnimationFrame(clear)
      state.frame = { animation: true, id: next }
    })
    state.frame = { animation: true, id }
  } else {
    state.frame = { animation: false, id: host.setTimeout(clear, 0) }
  }
}

function commitAppearance(host: Window, theme: ResolvedTheme, preset: ThemePresetId, allowTransition: boolean) {
  const document = host.document
  const root = document.documentElement
  const previousTheme = root.dataset.theme
  const previousPreset = isThemePresetId(root.dataset.themePreset) ? root.dataset.themePreset : null
  const state = transitionState(document)
  const interrupted = interruptThemeTransition(host, state)
  const sequence = state.sequence
  const changed = (previousTheme === 'light' || previousTheme === 'dark') &&
    (previousTheme !== theme || previousPreset !== preset)
  if (!changed) {
    applyAppearance(document, theme, preset)
    return
  }

  const reduceMotion = host.matchMedia(THEME_REDUCED_MOTION_QUERY).matches
  if (allowTransition && !interrupted && !reduceMotion && typeof document.startViewTransition === 'function') {
    try {
      const transition = document.startViewTransition(() => {
        if (state.sequence !== sequence) return
        root.dataset.themeTransitioning = 'true'
        applyAppearance(document, theme, preset)
      })
      state.active = transition
      void transition.finished.catch(() => undefined).finally(() => {
        if (state.sequence !== sequence) return
        state.active = undefined
        delete root.dataset.themeTransitioning
      })
      return
    } catch {
      state.active = undefined
    }
  }

  root.dataset.themeTransitioning = 'true'
  applyAppearance(document, theme, preset)
  clearTransitionAfterPaint(host, state, sequence)
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function parseThemeMode(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : 'system'
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return mode === 'system' ? prefersDark ? 'dark' : 'light' : mode
}

export function toggleResolvedTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return resolveTheme(mode, prefersDark) === 'light' ? 'dark' : 'light'
}

export function readThemeMode(host: Window): ThemeMode {
  try {
    return parseThemeMode(host.desktop?.initialTheme ?? host.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function readThemePreset(host: Window): ThemePresetId {
  try {
    return parseThemePreset(host.desktop?.initialThemePreset ?? host.localStorage.getItem(THEME_PRESET_STORAGE_KEY))
  } catch {
    return 'paper'
  }
}

export function syncAppearance(host: Window, mode: ThemeMode, preset: ThemePresetId): () => void {
  const media = host.matchMedia(THEME_MEDIA_QUERY)
  const apply = () => commitAppearance(host, resolveTheme(mode, media.matches), preset, true)

  apply()
  try { host.localStorage.setItem(THEME_STORAGE_KEY, mode) } catch { /* The current tab can still change appearance. */ }
  try { host.localStorage.setItem(THEME_PRESET_STORAGE_KEY, preset) } catch { /* The current tab can still use the preset. */ }
  void host.desktop?.setTheme(mode).catch(error => console.error('Unable to set the native appearance', error))
  void host.desktop?.setThemePreset?.(preset).catch(error => console.error('Unable to set the native theme preset', error))

  if (mode === 'system') media.addEventListener('change', apply)
  return () => { if (mode === 'system') media.removeEventListener('change', apply) }
}

export function syncTheme(host: Window, mode: ThemeMode): () => void {
  return syncAppearance(host, mode, readThemePreset(host))
}

export function resolvedThemeBackground(preset: ThemePresetId, theme: ResolvedTheme): string {
  return themePresetBackground(preset, theme)
}
