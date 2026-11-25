export class DeadlineExceeded extends Error {
  constructor() { super('Operation timed out') }
}

export async function withDeadline<T>(milliseconds: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new DeadlineExceeded()
          reject(error)
          controller.abort(error)
        }, milliseconds)
      }),
      Promise.resolve().then(() => run(controller.signal)),
    ])
  } finally {
    clearTimeout(timer)
  }
}
