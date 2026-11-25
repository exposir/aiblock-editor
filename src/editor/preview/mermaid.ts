import type { MermaidConfig } from 'mermaid'

export const diagramTemplates = [
  { id: 'flowchart', label: '流程图', source: 'flowchart LR\n  A[准备发布] --> B{通过验收?}\n  B -->|是| C[开放试点]\n  B -->|否| D[修正后重试]' },
  { id: 'sequence', label: '时序图', source: 'sequenceDiagram\n  participant A as 编辑器\n  participant B as 发布服务\n  A->>B: 请求发布\n  B-->>A: 返回结果' },
  { id: 'state', label: '状态图', source: 'stateDiagram-v2\n  state "草稿" as Draft\n  state "待验收" as Review\n  state "已发布" as Released\n  [*] --> Draft\n  Draft --> Review\n  Review --> Released\n  Released --> [*]' },
  { id: 'mindmap', label: '思维导图', source: 'mindmap\n  root((发布计划))\n    准备\n      权限校验\n    试点\n      反馈收集' },
  { id: 'er', label: 'ER 图', source: 'erDiagram\n  WORKSPACE ||--o{ PAGE : contains\n  PAGE ||--o{ COMMENT : has' },
  { id: 'gantt', label: '甘特图', source: 'gantt\n  title 发布排期\n  dateFormat YYYY-MM-DD\n  section 发布\n  验收 :2026-11-24, 1d\n  试点 :2026-11-25, 2d' },
] as const

export function mermaidConfig(dark: boolean): MermaidConfig {
  const paper = dark ? '#2B2926' : '#FAF7F2'
  const ink = dark ? '#ECEAE4' : '#1F1E1D'
  const line = dark ? '#8F8A80' : '#8E897F'
  const accent = dark ? '#D97757' : '#C96442'
  const [clay, olive, ochre, plum, slate] = dark
    ? ['#754B41', '#505A42', '#695537', '#645064', '#485B62']
    : ['#D9AC9A', '#C2C8A8', '#D9BF8E', '#CDB8CA', '#A8BFC2']
  const secondary = dark ? '#38302A' : '#F5E8DF'
  const tertiary = dark ? '#302D29' : '#F1ECE4'
  return {
    theme: 'base',
    securityLevel: 'strict',
    startOnLoad: false,
    suppressErrorRendering: true,
    htmlLabels: false,
    // Sequence actors specify their shadow directly on the SVG elements.
    themeCSS: '.actor, .actorPopupMenuPanel { filter: none !important; }',
    secure: [
      'secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'htmlLabels',
      'maxTextSize', 'maxEdges', 'dompurifyConfig', 'theme', 'themeVariables', 'themeCSS',
    ],
    themeVariables: {
      darkMode: dark, background: paper, primaryColor: paper, primaryTextColor: ink,
      primaryBorderColor: accent, nodeBorder: accent, lineColor: line, textColor: ink, mainBkg: paper,
      useGradient: false, dropShadow: 'none',
      secondaryColor: secondary, tertiaryColor: tertiary,
      edgeLabelBackground: paper, clusterBkg: paper,
      noteBkgColor: ochre, noteTextColor: ink, noteBorderColor: line,
      cScale0: clay, cScale1: olive, cScale2: ochre, cScale3: plum,
      git0: slate, git1: clay, git2: olive, git3: plum, branchLabelColor: ink,
      pie1: clay, pie2: olive, pie3: ochre, pie4: plum, pie5: slate,
      pieStrokeColor: paper, pieOuterStrokeColor: line, pieOpacity: '1',
      xyChart: { plotColorPalette: `${olive},${dark ? '#F2A78C' : '#A1472F'}` },
      sectionBkgColor: tertiary, altSectionBkgColor: paper, sectionBkgColor2: secondary,
      excludeBkgColor: dark ? '#403A32' : '#E5DDD0', gridColor: line,
      doneTaskBkgColor: olive, doneTaskBorderColor: olive,
      activeTaskBkgColor: ochre, activeTaskBorderColor: ochre,
      critBkgColor: clay, critBorderColor: accent,
    },
  }
}

let queue = Promise.resolve()
let diagramId = 0
const cache = new Map<string, DiagramResult>()
const maxCacheEntries = 24
const maxCachedDiagramLength = 160_000

export interface DiagramResult {
  readonly svg: string
}

export function renderMermaid(source: string, dark: boolean, wanted = () => true): Promise<DiagramResult | null> {
  const key = `${dark ? 'dark' : 'light'}\n${source}`
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return Promise.resolve(cached)
  }
  const result = queue.then(async () => {
    const alreadyRendered = cache.get(key)
    if (alreadyRendered) return alreadyRendered
    if (!wanted() || !source.trim()) return null
    try {
      const { default: mermaid } = await import('mermaid')
      if (!wanted()) return null
      // Mermaid's configuration is shared, so initialization and drawing must stay together.
      mermaid.initialize(mermaidConfig(dark))
      const { svg } = await mermaid.render(`lark-diagram-${++diagramId}`, source)
      const diagram = { svg }
      if (key.length + svg.length <= maxCachedDiagramLength) {
        cache.set(key, diagram)
        if (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value!)
      }
      return diagram
    } catch {
      return null
    }
  })
  queue = result.then(() => {})
  return result
}
