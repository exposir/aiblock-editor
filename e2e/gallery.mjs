import assert from 'node:assert/strict'

export async function renderGallery(page, until, theme) {
  const selector = '.ProseMirror [data-preview-language="mermaid"]'
  const count = await page(selector => document.querySelectorAll(selector).length, selector)
  assert.equal(count, 10)
  for (let i = 0; i < count; i++) {
    await page(({ selector, i }) => {
      document.querySelectorAll(selector)[i].scrollIntoView({ block: 'center', behavior: 'instant' })
    }, { selector, i })
    await until(() => page(({ selector, i, theme }) => {
      const image = document.querySelectorAll(selector)[i].querySelector('img')
      if (!image?.complete || !image.naturalWidth) return false
      if (!theme) return true
      const ink = theme === 'dark' ? '#eceae4' : '#1f1e1d'
      return decodeURIComponent(image.src).toLowerCase().includes(ink)
    }, { selector, i, theme }), 'Mermaid preview ' + (i + 1) + ' did not render', 30000)
  }
  await page(() => document.querySelector('.ProseMirror [data-inline-math]')?.scrollIntoView({ block: 'center' }))
  await until(() => page(() => document.querySelectorAll('.ProseMirror .katex').length === 5), 'Gallery formulas did not render')
  const formulas = await page(() => ({
    count: document.querySelectorAll('.ProseMirror .katex').length,
    errors: document.querySelectorAll('.ProseMirror .katex-error, .ProseMirror .code-preview-error').length,
  }))
  assert.deepEqual(formulas, { count: 5, errors: 0 })
  await page(() => window.scrollTo(0, 0))
}
