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

  it('reuse: caches diagrams above the legacy 160KB limit', async () => {
    vi.resetModules()
    const { renderMermaid: freshRenderMermaid } = await import('./mermaid')
    library.render.mockReset()
    const svg = `<svg>${'x'.repeat(180_000)}</svg>`
    library.render.mockResolvedValue({ svg })
    const before = library.render.mock.calls.length
    const source = 'flowchart TD\nA-->LargeDiagramCache'
    expect(await freshRenderMermaid(source, false)).toEqual({ svg })
    expect(await freshRenderMermaid(source, false)).toEqual({ svg })
    expect(library.render.mock.calls.length - before).toBe(1)
  })

  it('reuse: evicts the least recently used diagram when the total byte budget is exceeded', async () => {
    vi.resetModules()
    const { renderMermaid: freshRenderMermaid } = await import('./mermaid')
    library.render.mockReset()
    const svg = `<svg>${'x'.repeat(450_000)}</svg>`
    library.render.mockResolvedValue({ svg })
    const source = (index: number) => `flowchart TD\nA-->Budget${index}`
    const before = library.render.mock.calls.length
    for (let index = 0; index < 18; index++) await freshRenderMermaid(source(index), false)
    expect(library.render.mock.calls.length - before).toBe(18)
    await freshRenderMermaid(source(0), false)
    await freshRenderMermaid(source(18), false)
    expect(library.render.mock.calls.length - before).toBe(19)
    await freshRenderMermaid(source(0), false)
    expect(library.render.mock.calls.length - before).toBe(19)
    await freshRenderMermaid(source(1), false)
    expect(library.render.mock.calls.length - before).toBe(20)
  })

  it('reuse: obsolete previews can leave the queue without drawing', async () => {
    const before = library.render.mock.calls.length
    expect(await renderMermaid('flowchart TD\nA-->NotVisible', false, () => false)).toBeNull()
    expect(library.render.mock.calls.length).toBe(before)
  })

  it('scheduling: yields between expensive uncached renders', async () => {
    library.render.mockResolvedValue({ svg: '<svg />' })
    const before = library.render.mock.calls.length
    const first = renderMermaid('flowchart TD\nA-->YieldFirst', false)
    const second = renderMermaid('flowchart TD\nA-->YieldSecond', false)
    await first
    expect(library.render.mock.calls.length - before).toBe(1)
    expect(await second).toEqual({ svg: '<svg />' })
    expect(library.render.mock.calls.length - before).toBe(2)
  })

  it('scheduling: skips an off-screen task that leaves before its frame starts', async () => {
    let release!: (value: { svg: string }) => void
    library.render.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const before = library.render.mock.calls.length
    const first = renderMermaid('flowchart TD\nA-->Blocking', false)
    const skipped = renderMermaid('flowchart TD\nA-->Skipped', false, () => false)
    await vi.waitFor(() => expect(library.render.mock.calls.length - before).toBe(1))
    release({ svg: '<svg>blocking</svg>' })
    await first
    expect(await skipped).toBeNull()
    expect(library.render.mock.calls.length - before).toBe(1)
  })
})
