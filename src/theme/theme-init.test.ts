// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { THEME_PRESET_STORAGE_KEY, THEME_STORAGE_KEY } from './theme'
import { themePresetBackground, themePresetIds } from './theme-presets'

const script = readFileSync(new URL('../../public/theme-init.js', import.meta.url), 'utf8')

function boot(initialPreset?: string, initialMode?: string, storedPreset?: string) {
  const root = { dataset: {} as Record<string, string>, style: { backgroundColor: '', colorScheme: '' } }
  const storage = new Map<string, string>()
  if (storedPreset) storage.set(THEME_PRESET_STORAGE_KEY, storedPreset)
  const window = { desktop: { initialThemePreset: initialPreset, initialTheme: initialMode } }
  runInNewContext(script, {
    window,
    document: { documentElement: root },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null },
    matchMedia: () => ({ matches: false }),
  })
  return root
}

describe('theme-init', () => {
  it.each(themePresetIds)('pre-tints %s with the runtime light workspace color', preset => {
    const root = boot(preset, 'light')
    expect(root.dataset.themePreset).toBe(preset)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.backgroundColor).toBe(themePresetBackground(preset, 'light'))
  })

  it('uses the saved preset when Electron does not provide one and falls back to paper', () => {
    const saved = boot(undefined, undefined, 'github')
    expect(saved.dataset.themePreset).toBe('github')
    expect(saved.style.backgroundColor).toBe('#F6F8FA')

    const invalid = boot(undefined, undefined, 'sepia')
    expect(invalid.dataset.themePreset).toBe('paper')
    expect(invalid.style.backgroundColor).toBe('#F5F4EF')
  })

  it('gives the Electron startup preset and mode precedence over browser storage', () => {
    const root = boot('space-ai', 'dark', 'github')
    expect(root.dataset.themePreset).toBe('space-ai')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    expect(root.style.backgroundColor).toBe('#070B14')
  })

  it('keeps the mode storage key separate from the preset key', () => {
    expect(THEME_STORAGE_KEY).not.toBe(THEME_PRESET_STORAGE_KEY)
  })
})
