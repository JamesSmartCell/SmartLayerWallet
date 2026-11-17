import { type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPSTREAM = (process.env.CAMERA_GATE_UPSTREAM || 'http://127.0.0.1:8787').replace(/\/$/, '')

const ALLOWED = /^(health|challenge|auth|heartbeat|stop|live\/|hls\/|snapshot\/)/

async function proxy(req: NextRequest, path: string[]) {
  const joined = path.join('/')
  if (!ALLOWED.test(joined)) {
    return new Response('not found', { status: 404 })
  }

  const dest = `${UPSTREAM}/${joined}${req.nextUrl.search}`
  const headers = new Headers(req.headers)
  headers.delete('host')
  headers.delete('connection')

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    init.body = req.body
    init.duplex = 'half'
  }

  let upstream: Response
  try {
    upstream = await fetch(dest, init)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      `camera-gate unreachable at ${UPSTREAM} (${message}). On the Pi 5: curl ${UPSTREAM}/health`,
      { status: 502, headers: { 'Content-Type': 'text/plain' } }
    )
  }

  const out = new Headers(upstream.headers)
  out.delete('content-length')
  out.set('cache-control', 'no-store, no-cache, must-revalidate')
  out.set('x-accel-buffering', 'no')

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  })
}

type RouteCtx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function OPTIONS() {
  return new Response(null, { status: 204 })
}
