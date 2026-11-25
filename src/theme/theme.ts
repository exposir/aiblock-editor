export const themeModes = ['system', 'light', 'dark'] as const
export type ThemeMode = typeof themeModes[number]
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'aiblock-editor.theme.v1'
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'
export const themeLabels: Record<ThemeMode, string> = { system: '跟随系统', light: '浅色', dark: '深色' }
export const themeBackgrounds: Record<ResolvedTheme, string> = { light: '#F5F4EF', dark: '#1B1A18' }

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function parseThemeMode(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : 'system'
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return mode === 'system' ? prefersDark ? 'dark' : 'light' : mode
}

export function readThemeMode(host: Window): ThemeMode {
  try {
    return parseThemeMode(host.desktop?.initialTheme ?? host.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function syncTheme(host: Window, mode: ThemeMode): () => void {
  const media = host.matchMedia(THEME_MEDIA_QUERY)
  const root = host.document.documentElement
  function apply() {
    const resolved = resolveTheme(mode, media.matches)
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
  }

  apply()
  try { host.localStorage.setItem(THEME_STORAGE_KEY, mode) } catch { /* The current tab can still change appearance. */ }
  void host.desktop?.setTheme(mode).catch(error => console.error('Unable to set the native appearance', error))

  if (mode === 'system') media.addEventListener('change', apply)
  return () => { if (mode === 'system') media.removeEventListener('change', apply) }
}
