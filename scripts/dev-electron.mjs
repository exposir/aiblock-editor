import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { createServer } from 'vite'
import { buildElectron } from './build-electron.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
await buildElectron()
const http = createHttpServer()
const vite = await createServer({
  root,
  server: { middlewareMode: true, hmr: { server: http } },
})
http.on('request', (request, response) => vite.middlewares(request, response))

let child
let stopping = false
let killTimer
function stop() {
  if (stopping) return
  stopping = true
  if (child?.exitCode === null && child.signalCode === null) {
    child.stdin.end()
    killTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
    killTimer.unref()
  }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

try {
  const listening = once(http, 'listening')
  http.listen(0, '127.0.0.1')
  await listening
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port')
  const url = `http://127.0.0.1:${address.port}/`
  console.log(`Electron renderer: ${url}`)
  if (!stopping) {
    child = spawn(electron, [root], {
      cwd: root,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, AIBLOCK_EDITOR_DEV_URL: url },
    })
    child.stdin.on('error', () => { /* The app can exit while the shutdown pipe is closing. */ })
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1)))
    })
  }
} finally {
  clearTimeout(killTimer)
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  await vite.close()
  if (http.listening) {
    const closed = once(http, 'close')
    http.close()
    http.closeAllConnections()
    await closed
  }
}
