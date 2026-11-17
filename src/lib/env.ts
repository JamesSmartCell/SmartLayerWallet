/**
 * SmartLayerWallet Environment Configuration
 * Passkey wallet with garage door and camera integration
 */

import { base, baseSepolia, mainnet, sepolia } from 'viem/chains'

// Environment detection and rpId configuration for wallet.percolate.one
function getEnvironmentRpId(): string {
  if (process.env.NEXT_PUBLIC_RP_ID) {
    return process.env.NEXT_PUBLIC_RP_ID
  }

  if (typeof window === 'undefined') {
    return 'localhost'
  }

  const hostname = window.location.hostname

  // Production: wallet.percolate.one
  if (hostname === 'percolate.one' || hostname.endsWith('.percolate.one')) {
    return 'percolate.one'
  }

  return 'localhost'
}

// Determine environment type for endpoint selection
function getEnvironment(): 'prod' | 'dev' | 'proto' {
  const rpId = getEnvironmentRpId()
  if (rpId === 'percolate.one') return 'prod'
  return 'dev'
}

// Network configuration
export const NETWORK_KEYS = {
  BASE: 'BASE',
  MAINNET: 'MAINNET',
  BASE_SEPOLIA: 'BASE_SEPOLIA',
  SEPOLIA: 'SEPOLIA',
} as const

export type NetworkKey = keyof typeof NETWORK_KEYS

export function parseNetworkKey(net?: string | null): NetworkKey | undefined {
  if (!net) return undefined
  const n = net.toLowerCase()
  if (n === 'base') return NETWORK_KEYS.BASE
  if (n === 'mainnet') return NETWORK_KEYS.MAINNET
  if (n === 'base_sepolia' || n === 'base-sepolia') return NETWORK_KEYS.BASE_SEPOLIA
  if (n === 'sepolia') return NETWORK_KEYS.SEPOLIA
  return undefined
}

// Default network: Base Sepolia
export function getSelectedNetworkKey(): NetworkKey {
  return NETWORK_KEYS.BASE_SEPOLIA
}

/**
 * Default network for SmartLayerWallet
 */
export function getDefaultNetworkKey(): NetworkKey {
  return NETWORK_KEYS.BASE_SEPOLIA
}

/**
 * Enabled networks for SmartLayerWallet
 */
export function getEnabledNetworkKeys(): NetworkKey[] {
  return [NETWORK_KEYS.BASE_SEPOLIA]
}

export const ENV = {
  // Passkey/WebAuthn configuration
  RP_ID: getEnvironmentRpId(),
  ENVIRONMENT: getEnvironment(),

  // Garage Door and Camera configuration
  GARAGE_DOOR_NFT_ADDRESS: (process.env.NEXT_PUBLIC_GARAGE_DOOR_NFT_ADDRESS || '0x3158e836ec0e85A46f7a7208d91EA9837A0C6ccC') as `0x${string}`,
  IOT_DEVICE_ADDRESS: process.env.NEXT_PUBLIC_IOT_DEVICE_ADDRESS || '0xb1a6929c36c0ad999806a96dfe718777e650f395',
  // Camera address - never fall back to garage (IOT_DEVICE_ADDRESS); camera needs its own challenge
  IOT_CAMERA_ADDRESS: (process.env.NEXT_PUBLIC_IOT_CAMERA_ADDRESS || '0x38Ba3A68D4460Cf4747A0303D8e2C106cFF68F3f') as `0x${string}`,
  GARAGE_API_BASE: process.env.NEXT_PUBLIC_GARAGE_API_BASE || 'https://proxy.percolate.one/api',
  // Same-origin path on wallet.percolate.one (reuses that cert). server-https.js proxies to the Pi.
  CAMERA_GATE_URL: (process.env.NEXT_PUBLIC_CAMERA_GATE_URL || '/cam-gate').replace(/\/$/, ''),
  GARAGE_ADMIN_ADDRESSES: (
    process.env.NEXT_PUBLIC_GARAGE_ADMIN_ADDRESSES ||
    '0xC067A53c91258ba513059919E03B81CF93f57Ac7,0x7e4b1da13c4a2a73fd05e928a6ed81b0a5d3007b'
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Contract addresses
  CONTRACTS: {
    // EntryPoint v0.6 (all EVM)
    ENTRY_POINT: process.env.NEXT_PUBLIC_ENTRY_POINT as `0x${string}` || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    // Coinbase Account Factory (all EVM)
    ACCOUNT_FACTORY: process.env.NEXT_PUBLIC_ACCOUNT_FACTORY as `0x${string}` || '0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a',
  },
} as const

// Network configurations
export const NETWORKS = {
  [NETWORK_KEYS.MAINNET]: {
    id: 1,
    name: 'Ethereum',
    // Bundler URL is now client-side proxy: /api/bundler/1
    bundlerUrl: '/api/bundler/1',
    publicRpc: null, // Use waterfall RPC via src/lib/rpc.ts
    paymaster: false,
    chain: mainnet,
    tokens: {
      USDC: {
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as `0x${string}`,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      },
      AUDM: {
        address: '0x081599e4936d12c46bd48913b2329115cd26cbdd' as `0x${string}`,
        symbol: 'AUDM',
        name: 'AUDM',
        decimals: 18,
      },
      AUDD: {
        address: '0x4cce605ed955295432958d8951d0b176c10720d5' as `0x${string}`,
        symbol: 'AUDD',
        name: 'AUDD',
        decimals: 6,
      },
      AUDF: {
        address: '0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b' as `0x${string}`,
        symbol: 'AUDF',
        name: 'AUDF',
        decimals: 6,
      },
    },
  },
  [NETWORK_KEYS.BASE]: {
    id: 8453,
    name: 'Base',
    bundlerUrl: '/api/bundler/8453',
    publicRpc: null, // Use waterfall RPC via src/lib/rpc.ts
    paymaster: true,
    chain: base,
    tokens: {
      USDC: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as `0x${string}`,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      },
      AUDD: {
        address: '0x449b3317a6d1efb1Bc3ba0700C9EaA4FFFf4Ae65' as `0x${string}`,
        symbol: 'AUDD',
        name: 'AUDD',
        decimals: 6,
      },
      AUDF: {
        address: '0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b' as `0x${string}`,
        symbol: 'AUDF',
        name: 'AUDF',
        decimals: 6,
      },
    },
  },
  [NETWORK_KEYS.BASE_SEPOLIA]: {
    id: 84532,
    name: 'Base Sepolia',
    bundlerUrl: '/api/bundler/84532',
    publicRpc: null, // Use waterfall RPC via src/lib/rpc.ts
    paymaster: true,
    chain: baseSepolia,
    tokens: {
      USDC: {
        address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      },
      AUD: {
        address: '0x7ffba642bc902880a737cb1c18a4e9540879e211' as `0x${string}`,
        symbol: 'AUD',
        name: 'AUD Stablecoin Test',
        decimals: 18,
      }
    },
  },
  [NETWORK_KEYS.SEPOLIA]: {
    id: 11155111,
    name: 'Sepolia',
    bundlerUrl: '/api/bundler/11155111',
    publicRpc: null, // Use waterfall RPC via src/lib/rpc.ts
    paymaster: false,
    chain: sepolia,
    tokens: {
      SLN: {
        address: '0x0404ab3994ED48C300cE219546f757AD34484Dc7' as `0x${string}`,
        symbol: 'SLN',
        name: 'SLN',
        decimals: 18,
      }
    },
  },
} as const

export type Network = typeof NETWORKS[NetworkKey]

/** Map chain ID to NetworkKey for auto-switching (e.g. from EIP-681 payment links) */
export function getNetworkKeyFromChainId(chainId: number): NetworkKey | undefined {
  const entry = Object.entries(NETWORKS).find(([, n]) => n.id === chainId)
  return entry ? (entry[0] as NetworkKey) : undefined
}

// Helper function to get endpoints for a specific network
export function getEndpointsForNetwork(networkKey: NetworkKey) {
  const network = NETWORKS[networkKey]

  return {
    bundlerUrl: network.bundlerUrl, // Now points to /api/bundler/[chainId]
    publicRpc: network.publicRpc,   // null - use getWaterfallClient from rpc.ts
    paymaster: network.paymaster,
    chainId: network.id,
    chainName: network.name,
    chain: network.chain,
    tokens: network.tokens,
  }
}

// Validation function (server-side only)
export function validateEnv(): void {
  // CDP_API_KEY is server-side only, checked in bundler route
  // No client-side env validation needed
  if (typeof window === 'undefined') {
    const cdpKey = process.env.CDP_API_KEY || process.env.CDP_BUNDLER_API_KEY
    if (!cdpKey) {
      console.warn('Missing required environment variable: CDP_API_KEY')
      console.warn('ERC-4337 bundler/paymaster will not work. See README for setup instructions.')
    }
  }
}

