import { chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.resolve('vite'))
const { build } = require('esbuild')
const root = fileURLToPath(new URL('..', import.meta.url))
const outfile = resolve(root, 'dist-cli/aiblock-doc.mjs')

export async function buildCli() {
  await build({
    absWorkingDir: root,
    entryPoints: ['src/cli/entry.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    logLevel: 'info',
  })
  await chmod(outfile, 0o755)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildCli()
}
