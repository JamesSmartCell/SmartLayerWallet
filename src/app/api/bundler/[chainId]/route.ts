/**
 * Coinbase CDP Bundler/Paymaster Proxy
 * 
 * Server-side proxy to keep CDP_API_KEY out of client bundle.
 * Allowlists ERC-4337 and paymaster methods only.
 * Rate limited per IP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { PasskeyStore } from '@/lib/passkey-store'

let store: PasskeyStore | null = null

function getStore() {
  if (!store) {
    store = new PasskeyStore()
  }
  return store
}

// Allowlisted ERC-4337 and paymaster methods
const ALLOWED_METHODS = new Set([
  // ERC-4337 bundler methods
  'eth_sendUserOperation',
  'eth_estimateUserOperationGas',
  'eth_getUserOperationReceipt',
  'eth_getUserOperationByHash',
  'eth_supportedEntryPoints',
  'eth_chainId',
  // Paymaster methods
  'pm_getPaymasterStubData',
  'pm_getPaymasterData',
  'pm_sponsorUserOperation',
  'pm_validatePaymasterUserOp',
])

// Chain ID to CDP endpoint mapping
const CDP_ENDPOINTS: Record<string, string> = {
  '8453': 'base',           // Base mainnet
  '84532': 'base-sepolia',  // Base Sepolia
}

/**
 * Get client IP from headers (server-https.js sets X-Forwarded-For)
 */
function getClientIp(req: NextRequest): string {
  // Use first entry of X-Forwarded-For (set by server-https.js from remoteAddress)
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim()
    if (ip) return ip
  }
  
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  
  return 'unknown'
}

/**
 * POST /api/bundler/[chainId]
 * 
 * Proxies JSON-RPC requests to Coinbase CDP bundler/paymaster
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ chainId: string }> }
) {
  const params = await context.params
  const chainId = params.chainId
  const clientIp = getClientIp(req)
  const storeInstance = getStore()
  
  // Rate limit: 30 requests per minute per IP
  if (storeInstance.checkRateLimit(clientIp, `/api/bundler/${chainId}`, 30, 60)) {
    return NextResponse.json(
      { 
        jsonrpc: '2.0',
        error: { code: -32429, message: 'Rate limit exceeded' },
        id: null
      },
      { status: 429 }
    )
  }
  
  try {
    // Parse JSON-RPC request
    const body = await req.json()
    const method = body.method
    
    // Validate method
    if (!method || !ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Method not allowed: ${method || '(missing)'}. Only ERC-4337 and paymaster methods are supported.`
          },
          id: body.id || null
        },
        { status: 400 }
      )
    }
    
    // Get CDP endpoint for chain
    const cdpNetwork = CDP_ENDPOINTS[chainId]
    if (!cdpNetwork) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `Unsupported chain ID: ${chainId}`
          },
          id: body.id || null
        },
        { status: 400 }
      )
    }
    
    // Get CDP API key from server env
    const cdpApiKey = process.env.CDP_API_KEY || process.env.CDP_BUNDLER_API_KEY
    if (!cdpApiKey) {
      console.error('[Bundler] CDP_API_KEY not configured')
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bundler not configured'
          },
          id: body.id || null
        },
        { status: 500 }
      )
    }
    
    // Check for custom bundler URL override
    const customBundlerUrl = process.env[`CDP_BUNDLER_URL_${chainId}`]
    const bundlerUrl = customBundlerUrl || `https://api.developer.coinbase.com/rpc/v1/${cdpNetwork}/${cdpApiKey}`
    
    // Forward request to CDP
    const response = await fetch(bundlerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    
    const data = await response.json()
    
    // Return CDP response
    return NextResponse.json(data, { status: response.status })
    
  } catch (error) {
    console.error('[Bundler] Error:', error)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Internal server error'
        },
        id: null
      },
      { status: 500 }
    )
  }
}
