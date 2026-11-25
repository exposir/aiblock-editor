import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import App from '../App'
import { THEME_MEDIA_QUERY, THEME_STORAGE_KEY, parseThemeMode, readThemeMode, resolveTheme, syncTheme } from './theme'
import type { ThemeMode } from './theme'

function systemPreference(dark: boolean) {
  const media = new EventTarget()
  Object.defineProperty(media, 'matches', { get: () => dark })
  const original = window.matchMedia
  const match = vi.spyOn(window, 'matchMedia').mockImplementation(query =>
    query === THEME_MEDIA_QUERY ? media as unknown as MediaQueryList : original.call(window, query),
  )
  onTestFinished(() => match.mockRestore())
  return (value: boolean) => {
    dark = value
    media.dispatchEvent(new Event('change'))
  }
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
  document.documentElement.style.removeProperty('color-scheme')
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

  it('cycles all three modes with the keyboard and preserves the editor instance', async () => {
    const setSystem = systemPreference(false)
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    const user = userEvent.setup()
    const view = render(createElement(App))
    const editor = await screen.findByRole('textbox', { name: '文档正文' })
    const control = screen.getByRole('button', { name: '外观：跟随系统，切换为浅色' })
    control.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: '外观：浅色，切换为深色' })).toHaveFocus()
    await user.keyboard(' ')
    expectTheme('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    await user.keyboard('{Enter}')
    expectTheme('light')
    act(() => setSystem(true))
    expectTheme('dark')
    expect(screen.getByRole('textbox', { name: '文档正文' })).toBe(editor)
    view.unmount()
  })
})
