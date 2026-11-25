import { describe, expect, it, vi } from 'vitest'
import { diagramTemplates, renderMermaid } from './mermaid'

const library = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: library }))

describe('Mermaid rendering', () => {
  // @partition security: strict SVG, no automatic DOM scan or event binding
  // @partition themes: drawing and initialization use one consistent palette
  // @partition failure: a malformed diagram does not stop the render queue
  // @partition reuse: a finished preview can be reopened without scheduling another draw
  it('applies the requested theme and security settings on each queued rendering', async () => {
    library.render.mockImplementation(async (_id, source) => ({
      svg: '<svg>' + source + '</svg>',
      bindFunctions: () => { throw new Error('Preview must not bind SVG events') },
    }))
    const [light, dark] = await Promise.all([renderMermaid('light source', false), renderMermaid('dark source', true)])
    expect(light?.svg).toBe('<svg>light source</svg>')
    expect(dark?.svg).toBe('<svg>dark source</svg>')
    const first = library.initialize.mock.calls.at(-2)?.[0]
    const second = library.initialize.mock.calls.at(-1)?.[0]
    for (const config of [first, second]) {
      expect(config).toMatchObject({ theme: 'base', securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true })
      expect(config.secure).toEqual(expect.arrayContaining(['secure', 'securityLevel', 'dompurifyConfig']))
    }
    expect(first.themeVariables).toMatchObject({
      primaryColor: '#FAF7F2', primaryTextColor: '#1F1E1D', lineColor: '#8E897F', primaryBorderColor: '#C96442',
    })
    expect(second.themeVariables).toMatchObject({
      darkMode: true, primaryColor: '#2B2926', primaryTextColor: '#ECEAE4', lineColor: '#8F8A80', primaryBorderColor: '#D97757',
    })
    const firstDraw = library.render.mock.invocationCallOrder.at(-2)!
    const darkTheme = library.initialize.mock.invocationCallOrder.at(-1)!
    expect(firstDraw).toBeLessThan(darkTheme)
  })

  it('returns a recoverable failure and renders the next valid diagram', async () => {
    library.render.mockRejectedValueOnce(new Error('Malformed diagram')).mockResolvedValueOnce({ svg: '<svg />' })
    expect(await renderMermaid('invalid', true)).toBeNull()
    expect(await renderMermaid('flowchart LR\nA-->B', false)).toEqual({ svg: '<svg />' })
  })

  it('passes the selected template through to the renderer without rewriting the diagram', async () => {
    library.render.mockResolvedValueOnce({ svg: '<svg />' })
    const template = diagramTemplates.find(item => item.id === 'sequence')!
    expect(await renderMermaid(template.source, false)).toEqual({ svg: '<svg />' })
    expect(library.render).toHaveBeenLastCalledWith(expect.any(String), expect.stringMatching(/^sequenceDiagram\n.*发布服务/s))
  })

  it('reuse: shares a finished render for the same source and renders a new theme', async () => {
    const source = 'flowchart TD\nA-->Cache'
    const before = library.render.mock.calls.length
    library.render.mockResolvedValueOnce({ svg: '<svg>light diagram</svg>' })
    library.render.mockResolvedValueOnce({ svg: '<svg>dark diagram</svg>' })
    expect(await renderMermaid(source, false)).toEqual({ svg: '<svg>light diagram</svg>' })
    expect(await renderMermaid(source, false)).toEqual({ svg: '<svg>light diagram</svg>' })
    expect(await renderMermaid(source, true)).toEqual({ svg: '<svg>dark diagram</svg>' })
    expect(library.render.mock.calls.length - before).toBe(2)
  })

  it('reuse: obsolete previews can leave the queue without drawing', async () => {
    const before = library.render.mock.calls.length
    expect(await renderMermaid('flowchart TD\nA-->NotVisible', false, () => false)).toBeNull()
    expect(library.render.mock.calls.length).toBe(before)
  })
})
