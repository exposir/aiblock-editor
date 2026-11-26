import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import App from '../App'
import {
  THEME_MEDIA_QUERY, THEME_PRESET_STORAGE_KEY, THEME_REDUCED_MOTION_QUERY, THEME_STORAGE_KEY,
  parseThemeMode, readThemeMode, readThemePreset, resolveTheme, syncAppearance, syncTheme, toggleResolvedTheme,
} from './theme'
import type { ThemeMode } from './theme'
import {
  contrastRatio, parseThemePreset, themePresetList, themePresetPalette, themePresetVariableNames,
  themePresetVariables,
} from './theme-presets'

function systemPreference(dark: boolean, reduced = false) {
  const media = new EventTarget()
  Object.defineProperty(media, 'matches', { get: () => dark })
  const reducedMedia = { matches: reduced } as MediaQueryList
  const original = window.matchMedia
  const match = vi.spyOn(window, 'matchMedia').mockImplementation(query =>
    query === THEME_MEDIA_QUERY ? media as unknown as MediaQueryList
      : query === THEME_REDUCED_MOTION_QUERY ? reducedMedia
      : original.call(window, query),
  )
  onTestFinished(() => match.mockRestore())
  return (value: boolean) => {
    dark = value
    media.dispatchEvent(new Event('change'))
  }
}

function viewTransitionSupport() {
  let resolveFinished!: () => void
  const finished = new Promise<void>(resolve => { resolveFinished = resolve })
  const skipTransition = vi.fn(() => resolveFinished())
  const startViewTransition = vi.fn((callback: () => void) => {
    callback()
    return { finished, skipTransition } as unknown as ViewTransition
  })
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: startViewTransition,
  })
  onTestFinished(() => { Reflect.deleteProperty(document, 'startViewTransition') })
  return { startViewTransition, skipTransition, finish: resolveFinished }
}

function expectTheme(theme: 'light' | 'dark') {
  expect(document.documentElement).toHaveAttribute('data-theme', theme)
  expect(document.documentElement.style.colorScheme).toBe(theme)
}

beforeEach(() => localStorage.clear())

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  history.replaceState(null, '', '/')
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themePreset
  delete document.documentElement.dataset.themeTransitioning
  for (const name of themePresetVariableNames) document.documentElement.style.removeProperty(name)
  document.documentElement.style.removeProperty('background-color')
  document.documentElement.style.removeProperty('color-scheme')
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('theme preference', () => {
  // @partition resolution: pinned colors and both system settings
  // @partition persistence: missing, corrupt, blocked, and desktop preference
  // @partition synchronization: live OS changes, DOM, and the trusted desktop capability
  it.each([
    ['system', false, 'light'], ['system', true, 'dark'],
    ['light', false, 'light'], ['light', true, 'light'],
    ['dark', false, 'dark'], ['dark', true, 'dark'],
  ] as const)('resolves %s with OS dark=%s to %s', (mode, dark, expected) => {
    expect(parseThemeMode(mode)).toBe(mode)
    expect(resolveTheme(mode, dark)).toBe(expected)
  })

  it.each([
    ['system', false, 'dark'], ['system', true, 'light'],
    ['light', false, 'dark'], ['light', true, 'dark'],
    ['dark', false, 'light'], ['dark', true, 'light'],
  ] as const)('toggles %s with OS dark=%s to the opposite resolved theme %s', (mode, dark, expected) => {
    expect(toggleResolvedTheme(mode, dark)).toBe(expected)
  })

  it.each([null, undefined, '', 'sepia', 'Dark', { mode: 'dark' }])('falls back to system for %j', value => {
    expect(parseThemeMode(value)).toBe('system')
  })

  it('reads the public storage key and writes each explicit preference', () => {
    systemPreference(true)
    const key = ['aiblock-editor', 'theme', 'v1'].join('.')
    expect(readThemeMode(window)).toBe('system')
    localStorage.setItem(key, 'light')
    expect(readThemeMode(window)).toBe('light')
    localStorage.setItem(key, '{bad')
    expect(readThemeMode(window)).toBe('system')
    const modes: ThemeMode[] = ['light', 'dark', 'system']
    for (const mode of modes) {
      const stop = syncTheme(window, mode)
      expect(localStorage.getItem(key)).toBe(mode)
      expect(readThemeMode(window)).toBe(mode)
      stop()
    }
  })

  it('can apply the theme when browser storage is blocked', () => {
    systemPreference(false)
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked') })
    onTestFinished(() => { get.mockRestore(); set.mockRestore() })
    expect(readThemeMode(window)).toBe('system')
    syncTheme(window, 'dark')()
    expectTheme('dark')
  })

  it('follows live system changes until the mode is pinned or disconnected', () => {
    const setSystem = systemPreference(false)
    const disconnect = syncTheme(window, 'system')
    expectTheme('light')
    setSystem(true)
    expectTheme('dark')
    disconnect()
    setSystem(false)
    expectTheme('dark')

    const pinned = syncTheme(window, 'light')
    setSystem(true)
    expectTheme('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    pinned()
  })

  it('uses the window startup preference and gives Electron the unresolved system mode', () => {
    const setSystem = systemPreference(true)
    const setTheme = vi.fn<(mode: ThemeMode) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('desktop', { initialTheme: 'dark', setTheme })
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    syncTheme(window, readThemeMode(window))()
    expectTheme('dark')
    expect(setTheme).toHaveBeenCalledExactlyOnceWith('dark')
    const stop = syncTheme(window, 'system')
    setSystem(false)
    expectTheme('light')
    expect(setTheme.mock.calls).toEqual([['dark'], ['system']])
    stop()
  })

  it('shows three visible theme choices and selects each without rebuilding the editor', async () => {
    const setSystem = systemPreference(false)
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const user = userEvent.setup()
    const view = render(createElement(App))
    const editor = await screen.findByRole('textbox', { name: '文档正文' })
    const group = screen.getByRole('radiogroup', { name: '外观主题' })
    const radios = within(group).getAllByRole('radio')
    const thumb = group.querySelector('.theme-segment-thumb')
    expect(radios.map(radio => radio.getAttribute('aria-label'))).toEqual(['浅色', '深色', '跟随系统'])
    expect(radios.map(radio => radio.getAttribute('title'))).toEqual(['浅色', '深色', '跟随系统'])
    expect(thumb).toHaveAttribute('aria-hidden', 'true')
    expect(group.style.getPropertyValue('--theme-index')).toBe('2')
    const [light, dark, system] = radios as [HTMLElement, HTMLElement, HTMLElement]
    expect(system).toHaveAttribute('aria-checked', 'true')

    await user.click(light)
    expect(light).toHaveAttribute('aria-checked', 'true')
    expect(group.style.getPropertyValue('--theme-index')).toBe('0')
    expectTheme('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    await user.click(dark)
    expect(dark).toHaveAttribute('aria-checked', 'true')
    expect(group.style.getPropertyValue('--theme-index')).toBe('1')
    expectTheme('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    await user.click(system)
    expect(system).toHaveAttribute('aria-checked', 'true')
    expect(group.style.getPropertyValue('--theme-index')).toBe('2')
    act(() => setSystem(true))
    expectTheme('dark')
    expect(screen.getByRole('textbox', { name: '文档正文' })).toBe(editor)
    view.unmount()
  })

  it('does not start a View Transition on the first theme application', async () => {
    systemPreference(false)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const transition = viewTransitionSupport()
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const view = render(createElement(App))
    await screen.findByRole('textbox', { name: '文档正文' })
    expectTheme('dark')
    expect(transition.startViewTransition).not.toHaveBeenCalled()
    view.unmount()
  })

  it('does not start a View Transition when the resolved theme does not change', async () => {
    systemPreference(false)
    const transition = viewTransitionSupport()
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const user = userEvent.setup()
    const view = render(createElement(App))
    await screen.findByRole('textbox', { name: '文档正文' })
    const group = screen.getByRole('radiogroup', { name: '外观主题' })
    await user.click(within(group).getByRole('radio', { name: '浅色' }))
    expect(group.style.getPropertyValue('--theme-index')).toBe('0')
    expectTheme('light')
    expect(transition.startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement).not.toHaveAttribute('data-theme-transitioning')
    view.unmount()
  })

  it('cross-fades an actual theme change and clears the transition attribute when finished', async () => {
    systemPreference(false)
    const transition = viewTransitionSupport()
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const user = userEvent.setup()
    const view = render(createElement(App))
    await screen.findByRole('textbox', { name: '文档正文' })
    const group = screen.getByRole('radiogroup', { name: '外观主题' })
    await user.click(within(group).getByRole('radio', { name: '深色' }))
    expect(transition.startViewTransition).toHaveBeenCalledOnce()
    expectTheme('dark')
    expect(document.documentElement).toHaveAttribute('data-theme-transitioning', 'true')
    transition.finish()
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-theme-transitioning'))
    view.unmount()
  })

  it('skips View Transition when reduced motion is requested', async () => {
    systemPreference(false, true)
    const transition = viewTransitionSupport()
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const user = userEvent.setup()
    const view = render(createElement(App))
    await screen.findByRole('textbox', { name: '文档正文' })
    const group = screen.getByRole('radiogroup', { name: '外观主题' })
    await user.click(within(group).getByRole('radio', { name: '深色' }))
    expectTheme('dark')
    expect(transition.startViewTransition).not.toHaveBeenCalled()
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-theme-transitioning'))
    view.unmount()
  })

  it('interrupts an active View Transition and leaves the latest theme without a stale attribute', async () => {
    systemPreference(false)
    const transition = viewTransitionSupport()
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const user = userEvent.setup()
    const view = render(createElement(App))
    await screen.findByRole('textbox', { name: '文档正文' })
    const group = screen.getByRole('radiogroup', { name: '外观主题' })
    await user.click(within(group).getByRole('radio', { name: '深色' }))
    expectTheme('dark')
    await user.click(within(group).getByRole('radio', { name: '浅色' }))
    expect(transition.skipTransition).toHaveBeenCalledOnce()
    expect(transition.startViewTransition).toHaveBeenCalledOnce()
    expectTheme('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-theme-transitioning'))
    view.unmount()
  })

  it('moves between theme radios with arrow keys and supports Enter and Space selection', async () => {
    systemPreference(false)
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const user = userEvent.setup()
    const view = render(createElement(App))
    await screen.findByRole('textbox', { name: '文档正文' })
    const group = screen.getByRole('radiogroup', { name: '外观主题' })
    const [light, dark, system] = within(group).getAllByRole('radio') as [HTMLElement, HTMLElement, HTMLElement]

    system.focus()
    await user.keyboard('{ArrowLeft}')
    expect(dark).toHaveFocus()
    expect(dark).toHaveAttribute('aria-checked', 'true')
    expectTheme('dark')

    await user.keyboard('{ArrowLeft}')
    expect(light).toHaveFocus()
    expect(light).toHaveAttribute('aria-checked', 'true')
    expectTheme('light')

    await user.keyboard('{ArrowRight}')
    expect(dark).toHaveFocus()
    expect(dark).toHaveAttribute('aria-checked', 'true')

    light.focus()
    await user.keyboard('{Enter}')
    expect(light).toHaveAttribute('aria-checked', 'true')
    expectTheme('light')

    system.focus()
    await user.keyboard(' ')
    expect(system).toHaveAttribute('aria-checked', 'true')
    view.unmount()
  })

  it.each([
    ['system', false, 'dark', 'ctrlKey'],
    ['system', true, 'light', 'metaKey'],
    ['light', false, 'dark', 'ctrlKey'],
    ['dark', true, 'light', 'metaKey'],
  ] as const)('flips %s with OS dark=%s to %s using Cmd/Ctrl+Shift+D', async (mode, prefersDark, expected, modifier) => {
    systemPreference(prefersDark)
    localStorage.setItem(THEME_STORAGE_KEY, mode)
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const view = render(createElement(App))
    const editor = await screen.findByRole('textbox', { name: '文档正文' })
    fireEvent.keyDown(window, { key: 'd', shiftKey: true, [modifier]: true })
    expectTheme(expected)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(expected)
    expect(screen.getByRole('textbox', { name: '文档正文' })).toBe(editor)
    view.unmount()
  })
})

describe('theme presets', () => {
  it('ships 16 presets with orthogonal light and dark palettes', () => {
    expect(themePresetList).toHaveLength(16)
    expect(themePresetList.map(preset => preset.id)).toEqual([
      'paper', 'notion', 'cloud-blue', 'bear', 'github', 'twitter', 'gopro', 'space-ai',
      'linear', 'obsidian', 'catppuccin', 'tokyo-night', 'nord', 'solarized', 'gruvbox', 'dracula',
    ])
    expect(themePresetList.filter(preset => preset.group === 'editorial')).toHaveLength(4)
    expect(themePresetList.filter(preset => preset.group === 'brand')).toHaveLength(6)
    expect(themePresetList.filter(preset => preset.group === 'developer')).toHaveLength(6)
    for (const preset of themePresetList) {
      for (const variant of ['light', 'dark'] as const) {
        expect(themePresetPalette(preset.id, variant).workspace).toMatch(/^#[0-9A-F]{6}$/i)
      }
    }
  })

  it('meets the WCAG contrast gates for all 32 preset variants', () => {
    for (const preset of themePresetList) {
      for (const variant of ['light', 'dark'] as const) {
        const palette = themePresetPalette(preset.id, variant)
        const label = `${preset.id}:${variant}`
        expect(contrastRatio(palette.inkStrong, palette.paper), `${label} inkStrong`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(palette.ink, palette.paper), `${label} ink`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(palette.inkSecondary, palette.paper), `${label} inkSecondary`).toBeGreaterThanOrEqual(3.2)
        expect(contrastRatio(palette.inkOnAccent, palette.accent), `${label} inkOnAccent`).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(palette.syntax.keyword, palette.code), `${label} keyword`).toBeGreaterThanOrEqual(3.5)
        expect(contrastRatio(palette.syntax.string, palette.code), `${label} string`).toBeGreaterThanOrEqual(3.5)
        expect(contrastRatio(palette.syntax.title, palette.code), `${label} title`).toBeGreaterThanOrEqual(3.5)
      }
    }
  })

  it('reads and persists presets with invalid values falling back to paper', () => {
    systemPreference(false)
    expect(parseThemePreset(null)).toBe('paper')
    expect(parseThemePreset('sepia')).toBe('paper')
    expect(parseThemePreset('notion')).toBe('notion')
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, 'github')
    expect(readThemePreset(window)).toBe('github')
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, 'sepia')
    expect(readThemePreset(window)).toBe('paper')

    const stop = syncAppearance(window, 'light', 'notion')
    expect(document.documentElement).toHaveAttribute('data-theme-preset', 'notion')
    expect(localStorage.getItem(THEME_PRESET_STORAGE_KEY)).toBe('notion')
    stop()
  })

  it('uses the Electron startup preset ahead of browser storage', () => {
    systemPreference(false)
    vi.stubGlobal('desktop', { initialThemePreset: 'space-ai' })
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, 'notion')
    expect(readThemePreset(window)).toBe('space-ai')
  })

  it('applies preset variables, refreshes them across light and dark, and clears overrides for paper', () => {
    systemPreference(false)
    const lightStop = syncAppearance(window, 'light', 'notion')
    expect(document.documentElement).toHaveAttribute('data-theme-preset', 'notion')
    expect(document.documentElement.style.getPropertyValue('--bg-workspace')).toBe('#F7F7F5')
    expect(document.documentElement.style.getPropertyValue('--bg-paper')).toBe('#FFFFFF')
    lightStop()

    const darkStop = syncAppearance(window, 'dark', 'notion')
    expect(document.documentElement.style.getPropertyValue('--bg-workspace')).toBe('#191919')
    expect(document.documentElement.style.getPropertyValue('--bg-paper')).toBe('#202020')
    darkStop()

    const paperStop = syncAppearance(window, 'light', 'paper')
    expect(document.documentElement).toHaveAttribute('data-theme-preset', 'paper')
    for (const name of themePresetVariableNames) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe('')
    }
    paperStop()
  })

  it('uses the shared View Transition coordinator for preset changes', async () => {
    systemPreference(false)
    const initial = syncAppearance(window, 'light', 'paper')
    const transition = viewTransitionSupport()
    const next = syncAppearance(window, 'light', 'github')
    expect(transition.startViewTransition).toHaveBeenCalledOnce()
    expect(document.documentElement).toHaveAttribute('data-theme-transitioning', 'true')
    expect(document.documentElement.style.getPropertyValue('--bg-workspace')).toBe('#F6F8FA')
    transition.finish()
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-theme-transitioning'))
    initial()
    next()
  })

  it('interrupts a rapid preset switch and leaves the newest preset applied', async () => {
    systemPreference(false)
    const initial = syncAppearance(window, 'light', 'paper')
    const transition = viewTransitionSupport()
    const notion = syncAppearance(window, 'light', 'notion')
    expect(transition.startViewTransition).toHaveBeenCalledOnce()
    const github = syncAppearance(window, 'light', 'github')
    expect(transition.skipTransition).toHaveBeenCalledOnce()
    expect(document.documentElement).toHaveAttribute('data-theme-preset', 'github')
    expect(document.documentElement.style.getPropertyValue('--bg-workspace')).toBe('#F6F8FA')
    transition.finish()
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-theme-transitioning'))
    initial()
    notion()
    github()
  })

  it('returns a complete variable map for every non-paper preset and an empty paper override', () => {
    for (const preset of themePresetList) {
      for (const variant of ['light', 'dark'] as const) {
        const variables = themePresetVariables(preset.id, variant)
        if (preset.id === 'paper') expect(variables).toEqual({})
        else {
          expect(Object.keys(variables).sort()).toEqual([...themePresetVariableNames].sort())
          for (const name of themePresetVariableNames) expect(variables[name]).toBeTruthy()
        }
      }
    }
  })
})
