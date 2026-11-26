// Apply the saved appearance before the editor paints.
(() => {
  const backgrounds = {
    paper: { light: '#F5F4EF', dark: '#1B1A18' },
    notion: { light: '#F7F7F5', dark: '#191919' },
    lark: { light: '#F5F6F7', dark: '#14161A' },
    bear: { light: '#F8F4EC', dark: '#1E1C1A' },
    github: { light: '#F6F8FA', dark: '#0D1117' },
    twitter: { light: '#F7F9F9', dark: '#000000' },
    gopro: { light: '#F1F5F9', dark: '#0B0F14' },
    'space-ai': { light: '#F2F4FC', dark: '#070B14' },
    linear: { light: '#F6F7F9', dark: '#0B0C0E' },
    obsidian: { light: '#F4F2F8', dark: '#1E1E1E' },
    catppuccin: { light: '#EFF1F5', dark: '#1E1E2E' },
    'tokyo-night': { light: '#E6E7ED', dark: '#1A1B26' },
    nord: { light: '#ECEFF4', dark: '#2E3440' },
    solarized: { light: '#EEE8D5', dark: '#002B36' },
    gruvbox: { light: '#EBDBB2', dark: '#282828' },
    dracula: { light: '#F4F2F9', dark: '#21222C' },
  }
  let mode = window.desktop?.initialTheme
  if (mode == null) {
    try { mode = localStorage.getItem('aiblock-editor.theme.v1') } catch {}
  }
  let preset = window.desktop?.initialThemePreset
  if (preset == null) {
    try { preset = localStorage.getItem('aiblock-editor.theme-preset.v1') } catch {}
  }
  const resolved = mode === 'light' || mode === 'dark'
    ? mode
    : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const selected = backgrounds[preset] ? preset : 'paper'
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themePreset = selected
  document.documentElement.style.colorScheme = resolved
  document.documentElement.style.backgroundColor = backgrounds[selected][resolved]
})()
