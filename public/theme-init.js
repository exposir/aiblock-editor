// Apply the saved appearance before the editor paints.
(() => {
  let mode = window.desktop?.initialTheme
  if (mode == null) {
    try { mode = localStorage.getItem('aiblock-editor.theme.v1') } catch {}
  }
  const resolved = mode === 'light' || mode === 'dark'
    ? mode
    : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
})()
