export const CODE_LANGUAGES = [
  'plaintext', 'typescript', 'javascript', 'python', 'rust', 'go',
  'sql', 'json', 'bash', 'css', 'html', 'markdown', 'mermaid', 'math',
] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

export const codeLanguageLabels: Record<CodeLanguage, string> = {
  plaintext: '纯文本', typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python',
  rust: 'Rust', go: 'Go', sql: 'SQL', json: 'JSON', bash: 'Bash', css: 'CSS', html: 'HTML', markdown: 'Markdown',
  mermaid: 'Mermaid', math: 'LaTeX',
}

const aliases: Record<string, CodeLanguage> = {
  text: 'plaintext', plain: 'plaintext', ts: 'typescript', js: 'javascript', py: 'python',
  rs: 'rust', sh: 'bash', shell: 'bash', xml: 'html', md: 'markdown',
  mmd: 'mermaid', latex: 'math', tex: 'math',
}

export function codeLanguage(value: unknown): CodeLanguage {
  if (typeof value !== 'string') return 'plaintext'
  const name = value.trim().toLowerCase()
  return CODE_LANGUAGES.find(language => language === name) ??
    (Object.hasOwn(aliases, name) ? aliases[name]! : 'plaintext')
}

export type PreviewLanguage = 'mermaid' | 'math'
export type CodeViewMode = 'preview' | 'split' | 'code'

export function isPreviewLanguage(language: unknown): language is PreviewLanguage {
  return language === 'mermaid' || language === 'math'
}

export function viewModeFor(language: unknown, value: unknown): CodeViewMode {
  if (!isPreviewLanguage(language)) return 'code'
  return value === 'split' || value === 'code' ? value : 'preview'
}
