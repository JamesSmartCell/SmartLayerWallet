/**
 * Chrome (and most proxies) will not animate multipart/x-mixed-replace on <img>.
 * Pull the byte stream and swap complete JPEG frames instead.
 */

export type MjpegPlayerOptions = {
  onFrame?: () => void
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function nextJpeg(buffer: Uint8Array): { frame: Uint8Array; rest: Uint8Array } | null {
  let start = -1
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
      start = i
      break
    }
  }
  if (start < 0) return null
  for (let i = start + 2; i < buffer.length - 1; i++) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
      return {
        frame: buffer.subarray(start, i + 2),
        rest: buffer.subarray(i + 2),
      }
    }
  }
  return null
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function playOnce(
  url: string,
  img: HTMLImageElement,
  signal: AbortSignal,
  onFrame?: () => void
): Promise<void> {
  const res = await fetch(url, { signal, cache: 'no-store' })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `Stream failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  let buffer = new Uint8Array(0)
  let objectUrl = ''

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.length) continue
      buffer = concat(buffer, value)
      if (buffer.length > 4 * 1024 * 1024) {
        buffer = buffer.subarray(buffer.length - 1024 * 1024)
      }

      let extracted = nextJpeg(buffer)
      while (extracted) {
        const blob = new Blob([extracted.frame], { type: 'image/jpeg' })
        const nextUrl = URL.createObjectURL(blob)
        const previous = objectUrl
        img.src = nextUrl
        objectUrl = nextUrl
        if (previous) URL.revokeObjectURL(previous)
        onFrame?.()
        buffer = extracted.rest
        extracted = nextJpeg(buffer)
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export async function playMjpegStream(
  url: string,
  img: HTMLImageElement,
  signal: AbortSignal,
  options: MjpegPlayerOptions = {}
): Promise<void> {
  let lastError: unknown
  while (!signal.aborted) {
    try {
      await playOnce(url, img, signal, options.onFrame)
      lastError = new Error('Stream ended')
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return
      }
      lastError = err
      if (err instanceof Error && /401|auth_failed|403/.test(err.message)) {
        throw err
      }
    }
    if (signal.aborted) return
    try {
      await sleep(750, signal)
    } catch {
      return
    }
  }
  if (lastError instanceof Error) throw lastError
}
