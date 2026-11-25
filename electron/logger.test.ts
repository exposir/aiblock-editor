import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createMainLogger } from './logger.js'

async function profile() {
  const directory = await mkdtemp(join(tmpdir(), 'aiblock-log-test-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const logger = createMainLogger(directory)
  return { directory, logger, file: join(logger.directory, 'main.log') }
}

function records(text: string) {
  return text.trimEnd().split('\n').map(line => JSON.parse(line))
}

describe('desktop main log', () => {
  // @partition filesystem: creation, ordered append, byte-based rotation, inaccessible path
  it('creates the log directory and appends one JSON line per event, including a multiline stack', async () => {
    const { logger, file } = await profile()
    logger.write('info', 'startup')
    logger.write('error', 'read workspace', new Error('disk failure'))
    const [first, second, ...extra] = records(await readFile(file, 'utf8'))
    expect(extra).toHaveLength(0)
    expect(first).toMatchObject({ level: 'info', context: 'startup', timestamp: expect.stringMatching(/T.*Z$/) })
    expect(second).toMatchObject({
      level: 'error', context: 'read workspace',
      detail: expect.stringMatching(/^Error: disk failure\n\s+at /),
    })
  })

  it('rotates a log before an append would exceed 1 MiB and replaces the previous backup', async () => {
    const { logger, file } = await profile()
    await mkdir(logger.directory)
    const full = Buffer.alloc(1024 * 1024, 120)
    await writeFile(file, full)
    await writeFile(file + '.1', 'old backup')
    logger.write('warn', 'rotation')
    expect(await readFile(file + '.1')).toEqual(full)
    expect(records(await readFile(file, 'utf8'))).toEqual([
      { timestamp: expect.any(String), level: 'warn', context: 'rotation' },
    ])
  })

  it('reports to the console when the log directory cannot be created', async () => {
    const { directory } = await profile()
    const file = join(directory, 'not-a-directory')
    await writeFile(file, 'occupied')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => consoleError.mockRestore())
    expect(() => createMainLogger(file).write('error', 'failed operation', 'I/O error')).not.toThrow()
    expect(consoleError).toHaveBeenCalledWith('failed operation', 'I/O error')
  })
})
