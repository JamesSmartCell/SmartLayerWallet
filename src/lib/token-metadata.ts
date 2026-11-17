/**
 * Token Metadata Reader
 * 
 * Reads ERC20 token metadata (symbol, decimals, name) from on-chain.
 * Used by the ERC-681 pay page to display accurate token information.
 */

import { createPublicClient, http, type Address } from 'viem'
import { NETWORKS, getEndpointsForNetwork } from './env'

/**
 * ERC20 token metadata
 */
export interface TokenMetadata {
  symbol: string
  decimals: number
  name: string
}

/**
 * Result of token metadata fetch
 */
export interface TokenMetadataResult {
  success: boolean
  metadata?: TokenMetadata
  error?: string
  /** Whether fallback values were used */
  isFallback?: boolean
}

/**
 * Standard ERC20 ABI for metadata functions
 */
const ERC20_METADATA_ABI = [
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/**
 * Get public client for a specific chain
 */
function getPublicClient(chainId: number) {
  const networkKey = Object.keys(NETWORKS).find(
    (key) => NETWORKS[key as keyof typeof NETWORKS].id === chainId
  )
  if (!networkKey) {
    throw new Error(`Chain ID ${chainId} not supported`)
  }
  const endpoints = getEndpointsForNetwork(networkKey as any)

  return createPublicClient({
    chain: endpoints.chain,
    transport: http(endpoints.publicRpc || endpoints.chain.rpcUrls.default.http[0]),
  })
}

/**
 * Fetch token metadata from on-chain
 * 
 * @param tokenAddress - ERC20 contract address
 * @param chainId - Chain ID to query
 * @returns Token metadata or error
 * 
 * @example
 * const result = await fetchTokenMetadata('0x...', 84532)
 * if (result.success) {
 *   console.log(result.metadata.symbol, result.metadata.decimals)
 * }
 */
export async function fetchTokenMetadata(
  tokenAddress: Address,
  chainId: number
): Promise<TokenMetadataResult> {
  const client = getPublicClient(chainId)
  
  try {
    // Fetch all metadata in parallel
    const [symbol, decimals, name] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: ERC20_METADATA_ABI,
        functionName: 'symbol',
      }),
      client.readContract({
        address: tokenAddress,
        abi: ERC20_METADATA_ABI,
        functionName: 'decimals',
      }),
      client.readContract({
        address: tokenAddress,
        abi: ERC20_METADATA_ABI,
        functionName: 'name',
      }),
    ])
    
    return {
      success: true,
      metadata: {
        symbol: symbol as string,
        decimals: decimals as number,
        name: name as string,
      },
    }
  } catch (error) {
    console.error('Failed to fetch token metadata:', error)
    
    // Return fallback with warning
    return {
      success: true,
      metadata: {
        symbol: 'TOKEN',
        decimals: 18,
        name: 'Unknown Token',
      },
      isFallback: true,
      error: error instanceof Error ? error.message : 'Failed to read token metadata',
    }
  }
}

/**
 * Fetch token balance for an address
 * 
 * @param tokenAddress - ERC20 contract address
 * @param userAddress - User's wallet address
 * @param chainId - Chain ID to query
 * @returns Token balance in base units (bigint)
 */
export async function fetchTokenBalance(
  tokenAddress: Address,
  userAddress: Address,
  chainId: number
): Promise<bigint> {
  const client = getPublicClient(chainId)

  try {
    const balance = await client.readContract({
      address: tokenAddress,
      abi: ERC20_METADATA_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    })

    return balance as bigint
  } catch (error) {
    console.error('Failed to fetch token balance:', error)
    return 0n
  }
}

/**
 * Format token amount for display
 * 
 * @param amount - Amount in base units (bigint)
 * @param decimals - Token decimals
 * @param maxDecimals - Maximum decimals to display (default: 6)
 * @returns Formatted string
 */
export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  maxDecimals: number = 6
): string {
  const divisor = BigInt(10 ** decimals)
  const integerPart = amount / divisor
  const fractionalPart = amount % divisor

  if (fractionalPart === 0n) {
    return integerPart.toString()
  }

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0')

  // Trim trailing zeros and limit decimals
  const trimmed = fractionalStr.slice(0, maxDecimals).replace(/0+$/, '')

  if (trimmed === '') {
    return integerPart.toString()
  }

  return `${integerPart}.${trimmed}`
}

