/**
 * RPC Client Management - Cached Waterfall RPC clients per chain
 * 
 * Uses @smarttokenlabs/waterfall-rpc for all read-only chain access:
 * - Balances, ERC20 reads, portfolio
 * - Garage door NFT ownership checks
 * - Activity and smart-account queries
 * 
 * Waterfall RPC provides:
 * - Automatic fallback between RPC providers
 * - Web-based caching for faster reads
 * - Connection pooling
 */

import { createWaterfallPublicClient } from '@smarttokenlabs/waterfall-rpc/viem'
import type { Chain } from 'viem'
import { NETWORKS, type NetworkKey, NETWORK_KEYS } from './env'

const clientCache = new Map<number, Promise<any>>()
const isProd = process.env.NODE_ENV === 'production'

/**
 * Silence waterfall progress output in production
 */
if (isProd && typeof process !== 'undefined') {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    const str = chunk?.toString?.() || ''
    if (str.includes('waterfall') || str.includes('Connecting to network')) {
      return true
    }
    return originalStdoutWrite(chunk, ...args)
  }) as any
  
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    const str = chunk?.toString?.() || ''
    if (str.includes('waterfall') || str.includes('Connecting to network')) {
      return true
    }
    return originalStderrWrite(chunk, ...args)
  }) as any
}

/**
 * Get or create a cached waterfall client for a chain
 * 
 * Optional override via CUSTOM_RPC_URL_<CHAIN_ID> env var
 */
export async function getWaterfallClient(networkKey: NetworkKey): Promise<any> {
  const network = NETWORKS[networkKey]
  const chainId = network.id
  
  if (!clientCache.has(chainId)) {
    const promise = (async () => {
      // Check for custom RPC override
      const customRpcKey = `CUSTOM_RPC_URL_${chainId}`
      const customRpc = process.env[customRpcKey]
      
      if (customRpc) {
        console.log(`[RPC] Using custom RPC for ${network.name} (chainId ${chainId}): ${customRpc}`)
      }
      
      // Create waterfall client with web caching enabled
      const client = createWaterfallPublicClient(network.chain as Chain, {
        useWebCache: true,
        // If custom RPC is provided, waterfall will use it as primary
        ...(customRpc && { rpcUrl: customRpc })
      })
      
      if (!isProd) {
        console.log(`[RPC] Created waterfall client for ${network.name} (chainId ${chainId})`)
      }
      
      return client
    })()
    
    clientCache.set(chainId, promise as any)
  }
  
  return clientCache.get(chainId)!
}

/**
 * Get client for a specific chain ID
 */
export async function getWaterfallClientByChainId(chainId: number): Promise<any | null> {
  const networkKey = Object.entries(NETWORKS).find(([, n]) => n.id === chainId)?.[0] as NetworkKey | undefined
  if (!networkKey) {
    console.warn(`[RPC] No network configured for chainId ${chainId}`)
    return null
  }
  return getWaterfallClient(networkKey)
}

/**
 * Get client for the default network (Base Sepolia)
 */
export async function getDefaultWaterfallClient(): Promise<any> {
  return getWaterfallClient(NETWORK_KEYS.BASE_SEPOLIA)
}

/**
 * Clear the client cache (useful for testing or network changes)
 */
export function clearClientCache(): void {
  clientCache.clear()
}

/**
 * Check if a client is cached
 */
export function isCached(networkKey: NetworkKey): boolean {
  const chainId = NETWORKS[networkKey].id
  return clientCache.has(chainId)
}
