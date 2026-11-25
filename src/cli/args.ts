import { usageError } from './errors'

export interface CliArguments {
  readonly command: string | null
  readonly positionals: readonly string[]
  readonly values: ReadonlyMap<string, string>
  readonly flags: ReadonlySet<string>
  readonly help: boolean
}

const valueFlags = new Set(['workspace', 'title', 'parent', 'icon', 'markdown', 'if-match', 'format'])
const booleanFlags = new Set(['help', 'dry-run', 'activate'])

export function parseArguments(argv: readonly string[]): CliArguments {
  const positionals: string[] = []
  const values = new Map<string, string>()
  const flags = new Set<string>()
  let help = false
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (argument === '-h') {
      help = true
      continue
    }
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }
    const equals = argument.indexOf('=')
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals)
    const inline = equals === -1 ? undefined : argument.slice(equals + 1)
    if (name === 'help') {
      help = true
      continue
    }
    if (booleanFlags.has(name)) {
      if (inline !== undefined) throw usageError(`--${name} 不接受值。`)
      flags.add(name)
      continue
    }
    if (!valueFlags.has(name)) throw usageError(`未知参数 --${name}。`)
    const value = inline ?? argv[++index]
    if (value === undefined) throw usageError(`--${name} 需要一个值。`)
    values.set(name, value)
  }
  const [command = null, ...rest] = positionals
  return { command, positionals: rest, values, flags, help }
}

export function allowedFlags(args: CliArguments, values: readonly string[], flags: readonly string[] = []) {
  const allowedValues = new Set(values)
  const allowedBooleans = new Set(['help', 'dry-run', ...flags])
  for (const name of args.values.keys()) {
    if (!allowedValues.has(name)) throw usageError(`${args.command ?? '该命令'} 不支持 --${name}。`)
  }
  for (const name of args.flags) {
    if (!allowedBooleans.has(name)) throw usageError(`${args.command ?? '该命令'} 不支持 --${name}。`)
  }
}

export function required(args: CliArguments, name: string) {
  const value = args.values.get(name)
  if (value === undefined || value === '') throw usageError(`缺少 --${name}。`)
  return value
}
