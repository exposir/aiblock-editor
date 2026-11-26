export type ThemeVariant = 'light' | 'dark'
export type ThemePresetGroup = 'editorial' | 'brand' | 'developer'

export const themePresetIds = [
  'paper', 'notion', 'lark', 'bear',
  'github', 'twitter', 'gopro', 'space-ai', 'linear', 'obsidian',
  'catppuccin', 'tokyo-night', 'nord', 'solarized', 'gruvbox', 'dracula',
] as const

export type ThemePresetId = typeof themePresetIds[number]

export const themePresetGroupLabels: Record<ThemePresetGroup, string> = {
  editorial: '写作',
  brand: '品牌',
  developer: '开发者',
}

type SyntaxSeed = readonly [
  keyword: string,
  string: string,
  title: string,
  number: string,
  comment: string,
  punctuation: string,
]

interface ThemeSeed {
  readonly workspace: string
  readonly paper: string
  readonly accent: string
  readonly inkStrong: string
  readonly ink: string
  readonly inkSecondary: string
  readonly danger: string
  readonly syntax: SyntaxSeed
  readonly purple: string
}

export interface ThemePalette {
  readonly workspace: string
  readonly paper: string
  readonly menu: string
  readonly hover: string
  readonly selected: string
  readonly code: string
  readonly codeBar: string
  readonly inlineCode: string
  readonly header: string
  readonly tableHeader: string
  readonly input: string
  readonly control: string
  readonly controlActive: string
  readonly key: string
  readonly comment: string
  readonly hoverSubtle: string
  readonly tableHandle: string
  readonly backdrop: string
  readonly inkStrong: string
  readonly ink: string
  readonly inkSecondary: string
  readonly inkMuted: string
  readonly inkSubtle: string
  readonly inkQuote: string
  readonly inkCodeControl: string
  readonly inkTableHandle: string
  readonly inkInlineCode: string
  readonly inkResolved: string
  readonly inkOnAccent: string
  readonly inkOnDanger: string
  readonly line: string
  readonly lineStrong: string
  readonly lineSoft: string
  readonly borderPaper: string
  readonly borderHeader: string
  readonly borderCode: string
  readonly borderControl: string
  readonly borderTask: string
  readonly borderSwatch: string
  readonly borderSwatchHover: string
  readonly borderOverlay: string
  readonly scrollThumb: string
  readonly scrollThumbLegacy: string
  readonly scrollThumbHover: string
  readonly accent: string
  readonly accentHover: string
  readonly terracotta: string
  readonly terracottaDeep: string
  readonly terracottaWash: string
  readonly terracottaLine: string
  readonly terracottaBorder: string
  readonly amberUnderline: string
  readonly amberActive: string
  readonly danger: string
  readonly dangerButton: string
  readonly dangerButtonHover: string
  readonly textSelection: string
  readonly blockSelection: string
  readonly blockSelectionLine: string
  readonly tableSelection: string
  readonly marqueeBorder: string
  readonly accentUnderline: string
  readonly accentInputBorder: string
  readonly focusGlow: string
  readonly syntax: Readonly<Record<'keyword' | 'string' | 'title' | 'number' | 'comment' | 'punctuation', string>>
  readonly block: Readonly<Record<'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple', string>>
  readonly callout: Readonly<Record<'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple', string>>
  readonly calloutBorder: Readonly<Record<'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple', string>>
  readonly paletteInk: Readonly<Record<'neutral' | 'gray' | 'blue' | 'green' | 'red' | 'purple', string>>
  readonly highlights: Readonly<Record<'yellow' | 'blue' | 'green' | 'pink' | 'purple', string>>
}

export interface ThemePresetDefinition {
  readonly id: ThemePresetId
  readonly group: ThemePresetGroup
  readonly name: string
  readonly englishName: string
  readonly light: ThemeSeed
  readonly dark: ThemeSeed
}

const seed = (
  workspace: string,
  paper: string,
  accent: string,
  inkStrong: string,
  ink: string,
  inkSecondary: string,
  danger: string,
  syntax: SyntaxSeed,
  purple: string,
): ThemeSeed => ({ workspace, paper, accent, inkStrong, ink, inkSecondary, danger, syntax, purple })

export const themePresets: Readonly<Record<ThemePresetId, ThemePresetDefinition>> = {
  paper: {
    id: 'paper', group: 'editorial', name: '暖纸陶土', englishName: 'Warm Paper',
    light: seed('#F5F4EF', '#FFFDFB', '#C96442', '#1F1E1D', '#2B2A27', '#6E6A63', '#A94736',
      ['#8F355C', '#2E6B47', '#2D5A88', '#A65222', '#8B867C', '#6E6A63'], '#713DB6'),
    dark: seed('#1B1A18', '#232220', '#D97757', '#ECEAE4', '#DBD8D0', '#A39E93', '#ED9A87',
      ['#DF8EB2', '#8BC49E', '#86B8E8', '#E5A978', '#847F75', '#A39E93'], '#CAA9E0'),
  },
  notion: {
    id: 'notion', group: 'editorial', name: 'Notion 文档', englishName: 'Notion',
    light: seed('#F7F7F5', '#FFFFFF', '#2383E2', '#191919', '#37352F', '#787774', '#D44C47',
      ['#D44C47', '#0F7B6C', '#0550AE', '#B45309', '#6B6F76', '#37352F'], '#6940A5'),
    dark: seed('#191919', '#202020', '#529CCA', '#FFFFFF', '#E9E9E7', '#9B9B9B', '#FF7369',
      ['#FF7369', '#4DD4AC', '#82B1F6', '#F5B86D', '#9B9B9B', '#E9E9E7'], '#D2A8FF'),
  },
  lark: {
    id: 'lark', group: 'editorial', name: '飞书文档', englishName: 'Lark',
    light: seed('#F5F6F7', '#FFFFFF', '#3370FF', '#1F2329', '#2B2F36', '#646A73', '#D83931',
      ['#D83931', '#237A1D', '#245BDB', '#B76A00', '#646A73', '#1F2329'], '#7B4DDB'),
    dark: seed('#14161A', '#1D2026', '#5E92FF', '#E5E6EB', '#C9CDD4', '#A9AEB8', '#F76964',
      ['#F76964', '#6ED47C', '#6A9AFF', '#F5B35C', '#A9AEB8', '#E5E6EB'], '#B69CFF'),
  },
  bear: {
    id: 'bear', group: 'editorial', name: 'Bear 暖笺', englishName: 'Bear',
    light: seed('#F8F4EC', '#FFFDF8', '#D94F4F', '#3B3028', '#4A3F36', '#8A7460', '#B93636',
      ['#B93636', '#3F7D5C', '#456E9E', '#B56B22', '#8B7765', '#4A3F36'], '#8A5D9E'),
    dark: seed('#1E1C1A', '#262321', '#EC7070', '#F2EEE8', '#DDD4CA', '#B4A79A', '#FF8F86',
      ['#EC7070', '#8FCB9B', '#9DB8E8', '#E6B15C', '#B8A89A', '#E9E3DB'], '#D4A2E8'),
  },
  github: {
    id: 'github', group: 'brand', name: 'GitHub', englishName: 'GitHub',
    light: seed('#F6F8FA', '#FFFFFF', '#0969DA', '#1F2328', '#24292F', '#59636E', '#CF222E',
      ['#CF222E', '#116329', '#0550AE', '#953800', '#6E7781', '#57606A'], '#8250DF'),
    dark: seed('#0D1117', '#161B22', '#58A6FF', '#F0F6FC', '#C9D1D9', '#8B949E', '#FF7B72',
      ['#FF7B72', '#7EE787', '#79C0FF', '#FFA657', '#8B949E', '#C9D1D9'], '#D2A8FF'),
  },
  twitter: {
    id: 'twitter', group: 'brand', name: 'Twitter / X', englishName: 'Twitter / X',
    light: seed('#F7F9F9', '#FFFFFF', '#1D9BF0', '#0F1419', '#202327', '#536471', '#F4212E',
      ['#F4212E', '#007D5C', '#0A73B3', '#C25E00', '#536471', '#0F1419'], '#7856FF'),
    dark: seed('#000000', '#16181C', '#1D9BF0', '#E7E9EA', '#D6D9DB', '#8B98A5', '#F4212E',
      ['#FF6B70', '#00D1B2', '#67C5FF', '#FFB95C', '#8B98A5', '#E7E9EA'], '#B18CFF'),
  },
  gopro: {
    id: 'gopro', group: 'brand', name: 'GoPro', englishName: 'GoPro',
    light: seed('#F1F5F9', '#FFFFFF', '#0099D8', '#0F172A', '#1E293B', '#475569', '#C81E5B',
      ['#C81E5B', '#087F5B', '#0077B6', '#B45309', '#64748B', '#1E293B'], '#7C3AED'),
    dark: seed('#0B0F14', '#121922', '#00B4F0', '#E2E8F0', '#CBD5E1', '#94A3B8', '#FF6B9D',
      ['#FF6B9D', '#35D48F', '#5ED2FF', '#FFB347', '#94A3B8', '#E2E8F0'], '#C084FC'),
  },
  'space-ai': {
    id: 'space-ai', group: 'brand', name: 'Space AI', englishName: 'Space AI',
    light: seed('#F2F4FC', '#FFFFFF', '#4F46E5', '#151A36', '#252A4C', '#5B6178', '#C2416B',
      ['#B42373', '#0F8A7A', '#4F46E5', '#B45309', '#6B7280', '#252A4C'], '#7C3AED'),
    dark: seed('#070B14', '#101628', '#818CF8', '#E8EAF6', '#C7CBE3', '#9DA4C0', '#F472B6',
      ['#F472B6', '#5EEAD4', '#818CF8', '#FBBF24', '#94A3B8', '#E0E7FF'], '#C4B5FD'),
  },
  linear: {
    id: 'linear', group: 'brand', name: 'Linear', englishName: 'Linear',
    light: seed('#F6F7F9', '#FFFFFF', '#5E6AD2', '#16181D', '#26282F', '#5C616B', '#C5264B',
      ['#B4236B', '#067647', '#5E6AD2', '#B25E09', '#667085', '#343A46'], '#7C5CE6'),
    dark: seed('#0B0C0E', '#141518', '#828FFF', '#F4F5F7', '#D0D6E0', '#9CA3AF', '#FF6781',
      ['#F071B1', '#55D6A0', '#828FFF', '#F5B36A', '#8B93A7', '#D9DCFF'], '#B69CFF'),
  },
  obsidian: {
    id: 'obsidian', group: 'brand', name: 'Obsidian', englishName: 'Obsidian',
    light: seed('#F4F2F8', '#FFFFFF', '#7C3AED', '#231A33', '#30263F', '#716B7D', '#C0263E',
      ['#A21CAF', '#15803D', '#6D28D9', '#B45309', '#716B7D', '#30263F'], '#7C3AED'),
    dark: seed('#1E1E1E', '#262626', '#A882FF', '#F2F2F2', '#D6D6D6', '#A6A6A6', '#FF707C',
      ['#E879F9', '#6EE7B7', '#A882FF', '#FBBF24', '#9E95B3', '#F0EDFF'], '#C4A7FF'),
  },
  catppuccin: {
    id: 'catppuccin', group: 'developer', name: 'Catppuccin', englishName: 'Catppuccin',
    light: seed('#EFF1F5', '#F8F9FC', '#8839EF', '#303446', '#4C4F69', '#72758D', '#D20F39',
      ['#D20F39', '#3E7A36', '#1E66F5', '#B35C00', '#72758D', '#4C4F69'], '#8839EF'),
    dark: seed('#1E1E2E', '#24273A', '#CBA6F7', '#CDD6F4', '#BAC2DE', '#A6ADC8', '#F38BA8',
      ['#F38BA8', '#A6E3A1', '#89B4FA', '#FAB387', '#7F849C', '#CDD6F4'], '#CBA6F7'),
  },
  'tokyo-night': {
    id: 'tokyo-night', group: 'developer', name: 'Tokyo Night', englishName: 'Tokyo Night',
    light: seed('#E6E7ED', '#F5F6FA', '#2E7DE9', '#343B58', '#4C505E', '#6172A6', '#B42354',
      ['#8C4351', '#485E30', '#34548A', '#965027', '#6172A6', '#4C505E'], '#7847BD'),
    dark: seed('#1A1B26', '#24283B', '#7AA2F7', '#C0CAF5', '#A9B1D6', '#9AA5CE', '#F7768E',
      ['#BB9AF7', '#9ECE6A', '#7AA2F7', '#FF9E64', '#565F89', '#A9B1D6'], '#BB9AF7'),
  },
  nord: {
    id: 'nord', group: 'developer', name: 'Nord', englishName: 'Nord',
    light: seed('#ECEFF4', '#F8FAFC', '#4C6E9B', '#2E3440', '#3B4252', '#4C566A', '#B84851',
      ['#9E3F4B', '#4F7B55', '#4C6E9B', '#9A5B2E', '#687181', '#3B4252'], '#8064A2'),
    dark: seed('#2E3440', '#3B4252', '#88C0D0', '#ECEFF4', '#D8DEE9', '#A3ABB8', '#BF616A',
      ['#FF8D9A', '#A3D98F', '#88C0D0', '#F0A36B', '#7B8799', '#D8DEE9'], '#B48EAD'),
  },
  solarized: {
    id: 'solarized', group: 'developer', name: 'Solarized', englishName: 'Solarized',
    light: seed('#EEE8D5', '#FDF6E3', '#268BD2', '#073642', '#586E75', '#657B83', '#DC322F',
      ['#657B00', '#167A73', '#0068A6', '#8A6500', '#657B83', '#586E75'], '#6C3FA0'),
    dark: seed('#002B36', '#073642', '#2AA198', '#EEE8D5', '#93A1A1', '#839496', '#CB4B16',
      ['#859900', '#2AA198', '#268BD2', '#B58900', '#839496', '#93A1A1'], '#6C71C4'),
  },
  gruvbox: {
    id: 'gruvbox', group: 'developer', name: 'Gruvbox', englishName: 'Gruvbox',
    light: seed('#EBDBB2', '#FBF1C7', '#AF3A03', '#3C3836', '#504945', '#665C54', '#9D261D',
      ['#9D261D', '#3F6B47', '#075E6B', '#8F5E14', '#665C54', '#504945'], '#8F3F71'),
    dark: seed('#282828', '#32302F', '#FE8019', '#EBDBB2', '#D5C4A1', '#A89984', '#FB4934',
      ['#FB4934', '#B8BB26', '#83A598', '#FABD2F', '#928374', '#D5C4A1'], '#D3869B'),
  },
  dracula: {
    id: 'dracula', group: 'developer', name: 'Dracula', englishName: 'Dracula',
    light: seed('#F4F2F9', '#FFFDFE', '#644AC9', '#1F1F1F', '#3D3D3D', '#635A6B', '#A3144D',
      ['#644AC9', '#14710A', '#036A96', '#846A00', '#635A6B', '#3D3D3D'], '#644AC9'),
    dark: seed('#21222C', '#282A36', '#BD93F9', '#F8F8F2', '#E2E2DC', '#B8B9C4', '#FF5555',
      ['#FF79C6', '#50FA7B', '#8BE9FD', '#FFB86C', '#6272A4', '#F8F8F2'], '#BD93F9'),
  },
}

export const themePresetList = themePresetIds.map(id => themePresets[id])

function hexRgb(value: string): [number, number, number] {
  const hex = value.replace('#', '')
  const normalized = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex
  return [0, 2, 4].map(index => Number.parseInt(normalized.slice(index, index + 2), 16)) as [number, number, number]
}

function mix(left: string, right: string, rightWeight: number): string {
  const a = hexRgb(left)
  const b = hexRgb(right)
  const channel = (index: number) => Math.round(a[index]! * (1 - rightWeight) + b[index]! * rightWeight)
  return `#${[0, 1, 2].map(index => channel(index).toString(16).padStart(2, '0')).join('')}`
}

function alpha(value: string, opacity: number): string {
  const [r, g, b] = hexRgb(value)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

function luminance(value: string): number {
  const [r, g, b] = hexRgb(value).map(channel => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(left: string, right: string): number {
  const a = luminance(left)
  const b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function readableInk(background: string): string {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#111111') ? '#FFFFFF' : '#111111'
}

function resolvePalette(seedValue: ThemeSeed, variant: ThemeVariant): ThemePalette {
  const { workspace, paper, accent, inkStrong, ink, inkSecondary, danger, syntax, purple } = seedValue
  const dark = variant === 'dark'
  const code = dark ? mix(workspace, '#000000', 0.22) : mix(workspace, paper, 0.55)
  const menu = dark ? mix(paper, '#FFFFFF', 0.025) : paper
  const hover = mix(paper, inkStrong, dark ? 0.11 : 0.055)
  const selected = mix(paper, accent, dark ? 0.17 : 0.09)
  const control = mix(paper, inkStrong, dark ? 0.09 : 0.035)
  const tints = {
    gray: inkSecondary,
    blue: syntax[2],
    green: syntax[1],
    yellow: syntax[3],
    red: syntax[0],
    purple,
  }
  const soft = (tone: keyof typeof tints, strength: number) => mix(paper, tints[tone], dark ? strength * 1.75 : strength)
  const calloutStrength = 0.065
  const blockStrength = 0.055
  return {
    workspace, paper, menu, hover, selected, code,
    codeBar: mix(code, inkStrong, dark ? 0.08 : 0.035),
    inlineCode: mix(code, accent, dark ? 0.12 : 0.07),
    header: alpha(workspace, 0.88),
    tableHeader: mix(paper, workspace, dark ? 0.22 : 0.50),
    input: mix(paper, workspace, dark ? 0.35 : 0.12),
    control, controlActive: mix(paper, inkStrong, dark ? 0.18 : 0.09),
    key: mix(paper, inkStrong, dark ? 0.12 : 0.055),
    comment: menu,
    hoverSubtle: alpha(inkStrong, dark ? 0.07 : 0.045),
    tableHandle: alpha(inkStrong, dark ? 0.08 : 0.04),
    backdrop: alpha(dark ? '#000000' : inkStrong, dark ? 0.67 : 0.32),
    inkStrong, ink, inkSecondary,
    inkMuted: mix(inkSecondary, paper, dark ? 0.10 : 0.22),
    inkSubtle: mix(inkSecondary, paper, dark ? 0.05 : 0.16),
    inkQuote: inkSecondary,
    inkCodeControl: inkSecondary,
    inkTableHandle: inkSecondary,
    inkInlineCode: accent,
    inkResolved: syntax[1],
    inkOnAccent: readableInk(accent),
    inkOnDanger: readableInk(danger),
    line: alpha(inkStrong, dark ? 0.11 : 0.085),
    lineStrong: alpha(inkStrong, dark ? 0.14 : 0.11),
    lineSoft: alpha(inkStrong, dark ? 0.08 : 0.06),
    borderPaper: alpha(inkStrong, dark ? 0.09 : 0.08),
    borderHeader: alpha(inkStrong, dark ? 0.09 : 0.07),
    borderCode: alpha(inkStrong, dark ? 0.10 : 0.09),
    borderControl: alpha(inkStrong, dark ? 0.32 : 0.18),
    borderTask: mix(inkSecondary, paper, 0.25),
    borderSwatch: alpha(inkStrong, dark ? 0.28 : 0.14),
    borderSwatchHover: alpha(inkStrong, dark ? 0.50 : 0.35),
    borderOverlay: alpha(inkStrong, dark ? 0.15 : 0.12),
    scrollThumb: alpha(inkStrong, dark ? 0.42 : 0.18),
    scrollThumbLegacy: alpha(inkStrong, dark ? 0.42 : 0.16),
    scrollThumbHover: alpha(inkStrong, dark ? 0.58 : 0.26),
    accent,
    accentHover: mix(accent, dark ? '#FFFFFF' : '#000000', 0.12),
    terracotta: accent,
    terracottaDeep: mix(accent, dark ? '#FFFFFF' : '#000000', dark ? 0.16 : 0.30),
    terracottaWash: alpha(accent, dark ? 0.16 : 0.09),
    terracottaLine: alpha(accent, dark ? 0.44 : 0.28),
    terracottaBorder: alpha(accent, dark ? 0.56 : 0.45),
    amberUnderline: alpha(syntax[3], dark ? 0.66 : 0.55),
    amberActive: alpha(syntax[3], dark ? 0.24 : 0.28),
    danger,
    dangerButton: danger,
    dangerButtonHover: mix(danger, dark ? '#FFFFFF' : '#000000', dark ? 0.10 : 0.12),
    textSelection: alpha(accent, dark ? 0.28 : 0.18),
    blockSelection: alpha(accent, dark ? 0.14 : 0.08),
    blockSelectionLine: alpha(accent, dark ? 0.44 : 0.28),
    tableSelection: alpha(accent, dark ? 0.15 : 0.07),
    marqueeBorder: alpha(accent, dark ? 0.68 : 0.55),
    accentUnderline: alpha(accent, dark ? 0.58 : 0.35),
    accentInputBorder: alpha(accent, dark ? 0.62 : 0.38),
    focusGlow: accent,
    syntax: {
      keyword: syntax[0], string: syntax[1], title: syntax[2],
      number: syntax[3], comment: syntax[4], punctuation: syntax[5],
    },
    block: {
      gray: soft('gray', blockStrength), blue: soft('blue', blockStrength), green: soft('green', blockStrength),
      yellow: soft('yellow', blockStrength), red: soft('red', blockStrength), purple: soft('purple', blockStrength),
    },
    callout: {
      gray: soft('gray', calloutStrength), blue: soft('blue', calloutStrength), green: soft('green', calloutStrength),
      yellow: soft('yellow', calloutStrength), red: soft('red', calloutStrength), purple: soft('purple', calloutStrength),
    },
    calloutBorder: {
      gray: soft('gray', calloutStrength * 2.4), blue: soft('blue', calloutStrength * 2.4),
      green: soft('green', calloutStrength * 2.4), yellow: soft('yellow', calloutStrength * 2.4),
      red: soft('red', calloutStrength * 2.4), purple: soft('purple', calloutStrength * 2.4),
    },
    paletteInk: {
      neutral: inkStrong, gray: inkSecondary, blue: syntax[2],
      green: syntax[1], red: syntax[0], purple,
    },
    highlights: {
      yellow: soft('yellow', dark ? 0.24 : 0.28), blue: soft('blue', dark ? 0.24 : 0.28),
      green: soft('green', dark ? 0.24 : 0.28), pink: soft('red', dark ? 0.24 : 0.28),
      purple: soft('purple', dark ? 0.24 : 0.28),
    },
  }
}

const paletteCache = new Map<string, ThemePalette>()

export function themePresetPalette(id: ThemePresetId, variant: ThemeVariant): ThemePalette {
  const key = `${id}:${variant}`
  let palette = paletteCache.get(key)
  if (!palette) {
    palette = resolvePalette(themePresets[id][variant], variant)
    paletteCache.set(key, palette)
  }
  return palette
}

export function themePresetBackground(id: ThemePresetId, variant: ThemeVariant): string {
  return themePresetPalette(id, variant).workspace
}

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && themePresetIds.includes(value as ThemePresetId)
}

export function parseThemePreset(value: unknown): ThemePresetId {
  return isThemePresetId(value) ? value : 'paper'
}

const emptyVariables = {} as const

export const themePresetVariableNames = [
  '--bg-workspace', '--bg-paper', '--bg-menu', '--bg-hover', '--bg-selected', '--bg-code',
  '--bg-code-bar', '--bg-inline-code', '--bg-header', '--bg-table-header', '--bg-input',
  '--bg-control', '--bg-control-active', '--bg-key', '--bg-comment', '--bg-hover-subtle',
  '--bg-table-handle', '--bg-backdrop', '--bg-block-gray', '--bg-block-blue', '--bg-block-green',
  '--bg-block-yellow', '--bg-block-red', '--bg-block-purple', '--bg-callout-gray', '--bg-callout-blue',
  '--bg-callout-yellow', '--bg-callout-green', '--bg-callout-red', '--bg-callout-purple',
  '--border-callout-gray', '--border-callout-blue', '--border-callout-yellow', '--border-callout-green',
  '--border-callout-red', '--border-callout-purple', '--ink-strong', '--ink', '--ink-secondary',
  '--ink-muted', '--ink-subtle', '--ink-quote', '--ink-code-control', '--ink-table-handle',
  '--ink-inline-code', '--ink-resolved', '--ink-on-accent', '--ink-on-danger', '--line', '--line-strong',
  '--line-soft', '--border-paper', '--border-header', '--border-code', '--border-control', '--border-task',
  '--border-swatch', '--border-swatch-hover', '--border-overlay', '--scroll-thumb', '--scroll-thumb-legacy',
  '--scroll-thumb-hover', '--accent', '--accent-hover', '--terracotta', '--terracotta-deep', '--terracotta-wash',
  '--terracotta-line', '--terracotta-border', '--amber-underline', '--amber-active', '--danger',
  '--danger-button', '--danger-button-hover', '--text-selection', '--block-selection', '--block-selection-line',
  '--table-selection', '--marquee-border', '--accent-underline', '--accent-input-border', '--focus-glow',
  '--syntax-keyword', '--syntax-string', '--syntax-title', '--syntax-number', '--syntax-comment',
  '--syntax-punctuation', '--palette-ink-neutral', '--palette-ink-gray', '--palette-ink-blue',
  '--palette-ink-green', '--palette-ink-red', '--palette-ink-purple', '--highlight-yellow',
  '--highlight-blue', '--highlight-green', '--highlight-pink', '--highlight-purple',
] as const

export type ThemePresetVariableName = typeof themePresetVariableNames[number]
export type ThemePresetVariables = Partial<Record<ThemePresetVariableName, string>>

export function themePresetVariables(id: ThemePresetId, variant: ThemeVariant): ThemePresetVariables {
  if (id === 'paper') return emptyVariables
  const p = themePresetPalette(id, variant)
  return {
    '--bg-workspace': p.workspace, '--bg-paper': p.paper, '--bg-menu': p.menu, '--bg-hover': p.hover,
    '--bg-selected': p.selected, '--bg-code': p.code, '--bg-code-bar': p.codeBar, '--bg-inline-code': p.inlineCode,
    '--bg-header': p.header, '--bg-table-header': p.tableHeader, '--bg-input': p.input,
    '--bg-control': p.control, '--bg-control-active': p.controlActive, '--bg-key': p.key,
    '--bg-comment': p.comment, '--bg-hover-subtle': p.hoverSubtle, '--bg-table-handle': p.tableHandle,
    '--bg-backdrop': p.backdrop,
    '--bg-block-gray': p.block.gray, '--bg-block-blue': p.block.blue, '--bg-block-green': p.block.green,
    '--bg-block-yellow': p.block.yellow, '--bg-block-red': p.block.red, '--bg-block-purple': p.block.purple,
    '--bg-callout-gray': p.callout.gray, '--bg-callout-blue': p.callout.blue, '--bg-callout-yellow': p.callout.yellow,
    '--bg-callout-green': p.callout.green, '--bg-callout-red': p.callout.red, '--bg-callout-purple': p.callout.purple,
    '--border-callout-gray': p.calloutBorder.gray, '--border-callout-blue': p.calloutBorder.blue,
    '--border-callout-yellow': p.calloutBorder.yellow, '--border-callout-green': p.calloutBorder.green,
    '--border-callout-red': p.calloutBorder.red, '--border-callout-purple': p.calloutBorder.purple,
    '--ink-strong': p.inkStrong, '--ink': p.ink, '--ink-secondary': p.inkSecondary, '--ink-muted': p.inkMuted,
    '--ink-subtle': p.inkSubtle, '--ink-quote': p.inkQuote, '--ink-code-control': p.inkCodeControl,
    '--ink-table-handle': p.inkTableHandle, '--ink-inline-code': p.inkInlineCode, '--ink-resolved': p.inkResolved,
    '--ink-on-accent': p.inkOnAccent, '--ink-on-danger': p.inkOnDanger,
    '--line': p.line, '--line-strong': p.lineStrong, '--line-soft': p.lineSoft,
    '--border-paper': p.borderPaper, '--border-header': p.borderHeader, '--border-code': p.borderCode,
    '--border-control': p.borderControl, '--border-task': p.borderTask, '--border-swatch': p.borderSwatch,
    '--border-swatch-hover': p.borderSwatchHover, '--border-overlay': p.borderOverlay,
    '--scroll-thumb': p.scrollThumb, '--scroll-thumb-legacy': p.scrollThumbLegacy,
    '--scroll-thumb-hover': p.scrollThumbHover,
    '--accent': p.accent, '--accent-hover': p.accentHover, '--terracotta': p.terracotta,
    '--terracotta-deep': p.terracottaDeep, '--terracotta-wash': p.terracottaWash,
    '--terracotta-line': p.terracottaLine, '--terracotta-border': p.terracottaBorder,
    '--amber-underline': p.amberUnderline, '--amber-active': p.amberActive,
    '--danger': p.danger, '--danger-button': p.dangerButton, '--danger-button-hover': p.dangerButtonHover,
    '--text-selection': p.textSelection, '--block-selection': p.blockSelection,
    '--block-selection-line': p.blockSelectionLine, '--table-selection': p.tableSelection,
    '--marquee-border': p.marqueeBorder, '--accent-underline': p.accentUnderline,
    '--accent-input-border': p.accentInputBorder, '--focus-glow': p.focusGlow,
    '--syntax-keyword': p.syntax.keyword, '--syntax-string': p.syntax.string, '--syntax-title': p.syntax.title,
    '--syntax-number': p.syntax.number, '--syntax-comment': p.syntax.comment,
    '--syntax-punctuation': p.syntax.punctuation,
    '--palette-ink-neutral': p.paletteInk.neutral, '--palette-ink-gray': p.paletteInk.gray,
    '--palette-ink-blue': p.paletteInk.blue, '--palette-ink-green': p.paletteInk.green,
    '--palette-ink-red': p.paletteInk.red, '--palette-ink-purple': p.paletteInk.purple,
    '--highlight-yellow': p.highlights.yellow, '--highlight-blue': p.highlights.blue,
    '--highlight-green': p.highlights.green, '--highlight-pink': p.highlights.pink,
    '--highlight-purple': p.highlights.purple,
  }
}
