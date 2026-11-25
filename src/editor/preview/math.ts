export const exampleFormula = String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`

export async function renderMath(latex: string, displayMode: boolean): Promise<string | null> {
  if (!latex.trim()) return null
  try {
    const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    return katex.renderToString(latex, { displayMode, trust: false, maxExpand: 1000, maxSize: 24 })
  } catch {
    return null
  }
}
