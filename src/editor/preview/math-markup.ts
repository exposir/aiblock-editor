interface MathMarkup {
  readonly raw: string
  readonly latex: string
}

export function inlineMathAt(source: string): MathMarkup | undefined {
  const first = source[1]
  if (source[0] !== '$' || !first || /[\s$]/u.test(first)) return
  // A price at a sentence break cannot borrow a dollar sign from the next phrase.
  if (/^\d+(?:[.,]\d+)*[，。；、：！？]/u.test(source.slice(1))) return
  if (first === '`') {
    const end = source.indexOf('`$', 2)
    if (end <= 2 || /[\r\n]/.test(source.slice(2, end))) return
    return { raw: source.slice(0, end + 2), latex: source.slice(2, end) }
  }
  for (let i = 1; i < source.length; i++) {
    const char = source[i]
    if (char === '\n' || char === '\r') return
    if (char === '\\' && /[$\\]/.test(source[i + 1] ?? '')) { i++; continue }
    if (char !== '$') continue
    if (i === 1 || /\s/u.test(source[i - 1]!) || /[$\d]/.test(source[i + 1] ?? '')) return
    return { raw: source.slice(0, i + 1), latex: source.slice(1, i) }
  }
}

export function findInlineMath(source: string): (MathMarkup & { readonly index: number }) | undefined {
  let index = source.indexOf('$')
  while (index >= 0) {
    let escapes = 0
    while (source[index - escapes - 1] === '\\') escapes++
    if (escapes % 2 === 0 && source[index - 1] !== '$') {
      const match = inlineMathAt(source.slice(index))
      if (match) return { ...match, index }
    }
    index = source.indexOf('$', index + 1)
  }
}

export function blockMathAt(source: string): MathMarkup | undefined {
  const multiline = /^ {0,3}\$\$[^\S\r\n]*\r?\n([\s\S]*?)^ {0,3}\$\$[^\S\r\n]*(?:\r?\n|$)/m.exec(source)
  if (multiline?.index === 0) {
    return { raw: multiline[0], latex: multiline[1]!.replace(/\r?\n$/, '') }
  }
  const single = /^ {0,3}\$\$([^$\r\n].*?)\$\$[^\S\r\n]*(?:\r?\n|$)/.exec(source)
  if (single) return { raw: single[0], latex: single[1]! }
}

export function hasMathMarkup(source: string): boolean {
  if (findInlineMath(source)) return true
  for (const opener of source.matchAll(/^ {0,3}\$\$/gm)) {
    if (blockMathAt(source.slice(opener.index))) return true
  }
  return false
}

export function inlineMathMarkdown(latex: string, next = ''): string {
  const plain = `$${latex}$`
  if (inlineMathAt(plain + next)?.latex === latex) return plain
  return '$`' + latex + '`$'
}
