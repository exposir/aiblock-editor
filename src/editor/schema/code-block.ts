import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block'
import { codeLanguage, isPreviewLanguage, viewModeFor } from '../extensions/code-languages'

export const CodeBlockSchema = BaseCodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: 'plaintext',
        parseHTML: element => codeLanguage(element.getAttribute('data-language') ??
          [...(element.firstElementChild?.classList ?? [])].find(name => name.startsWith('language-'))?.slice(9)),
        renderHTML: attrs => ({ 'data-language': codeLanguage(attrs.language) }),
      },
      viewMode: {
        default: 'preview',
        parseHTML: element => viewModeFor('mermaid', element.getAttribute('data-view-mode')),
        renderHTML: attrs => isPreviewLanguage(codeLanguage(attrs.language))
          ? { 'data-view-mode': viewModeFor(codeLanguage(attrs.language), attrs.viewMode) }
          : {},
      },
      wrap: {
        default: false,
        parseHTML: element => element.getAttribute('data-wrap') === 'true',
        renderHTML: attrs => ({ 'data-wrap': String(attrs.wrap === true) }),
      },
    }
  },
})
