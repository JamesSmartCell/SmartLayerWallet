import { formatUnits, getAddress } from 'viem'
import { NETWORK_KEYS, type NetworkKey } from './env'

export interface ActivityItem {
  id: string // transaction hash + log index
  type: 'send' | 'receive' | 'swap' | 'mint' | 'approve' | 'other'
  status: 'pending' | 'confirmed' | 'failed'
  timestamp: number
  blockNumber: bigint
  transactionHash: string

  // Token info
  token?: {
    address: string | null // null for ETH
    symbol: string
    name: string
    decimals: number
  }

  // Transfer details
  from?: string
  to?: string
  amount?: string // formatted amount
  rawAmount?: bigint

  // Additional context
  description: string
  icon?: 'send' | 'receive' | 'swap' | 'mint' | 'approve' | 'contract'
  usdValue?: number
}

export interface ActivityFeed {
  items: ActivityItem[]
  isLoading: boolean
  error: string | null
  hasMore: boolean
  nextCursor?: string
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Blockscout explorer base URLs per network.
 */
const BLOCKSCOUT_API_BASE: Record<NetworkKey, string> = {
  BASE: 'https://base.blockscout.com',
  BASE_SEPOLIA: 'https://base-sepolia.blockscout.com',
  MAINNET: 'https://eth.blockscout.com',
  SEPOLIA: 'https://eth-sepolia.blockscout.com',
}

/**
 * Response types from Blockscout REST API v2
 * GET /api/v2/addresses/{address}/token-transfers
 */
interface BlockscoutTokenTransfer {
  transaction_hash: string
  block_number: number
  log_index: number
  timestamp: string // ISO 8601
  type: string // "token_transfer"
  token_type: string // "ERC-20" | "ERC-721" | "ERC-1155"
  method: string | null
  from: { hash: string }
  to: { hash: string }
  token: {
    address_hash: string
    name: string
    symbol: string
    decimals: string | null
    type: string
  }
  total: {
    decimals?: string | null
    value?: string
    token_id?: string
  }
}

interface BlockscoutResponse {
  items: BlockscoutTokenTransfer[]
  next_page_params: { block_number: number; index: number } | null
}

export class ActivityService {
  private baseUrl: string
  private networkKey: NetworkKey

  constructor(networkKey: NetworkKey = NETWORK_KEYS.BASE_SEPOLIA) {
    this.networkKey = networkKey
    this.baseUrl = BLOCKSCOUT_API_BASE[networkKey]
  }

  async getActivity(address: string, limit = 50): Promise<ActivityFeed> {
    try {
      const userAddress = getAddress(address)
      const url = `${this.baseUrl}/api/v2/addresses/${userAddress}/token-transfers?type=ERC-20,ERC-721,ERC-1155`

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Blockscout API error: ${response.status}`)
      }

      const data: BlockscoutResponse = await response.json()

      const items = data.items
        .slice(0, limit)
        .map((transfer) => this.mapTransfer(transfer, userAddress))
        .filter((item): item is ActivityItem => item !== null)

      return {
        items,
        isLoading: false,
        error: null,
        hasMore: data.next_page_params !== null,
        nextCursor: data.next_page_params
          ? `${data.next_page_params.block_number}-${data.next_page_params.index}`
          : undefined,
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error)
      return {
        items: [],
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch activity',
        hasMore: false,
      }
    }
  }

  private mapTransfer(transfer: BlockscoutTokenTransfer, userAddress: string): ActivityItem | null {
    const from = transfer.from.hash
    const to = transfer.to.hash
    const userAddr = userAddress.toLowerCase()
    const isReceive = to.toLowerCase() === userAddr
    const isMint = from.toLowerCase() === ZERO_ADDRESS

    const tokenType = transfer.token_type // "ERC-20" | "ERC-721" | "ERC-1155"
    const decimals = transfer.total.decimals ? parseInt(transfer.total.decimals, 10) : 0

    let amount: string
    let rawAmount: bigint | undefined
    let description: string

    if (tokenType === 'ERC-20') {
      rawAmount = transfer.total.value ? BigInt(transfer.total.value) : 0n
      amount = formatUnits(rawAmount, decimals)
      description = isReceive
        ? `Received ${amount} ${transfer.token.symbol}`
        : `Sent ${amount} ${transfer.token.symbol}`
    } else if (tokenType === 'ERC-721') {
      const tokenId = transfer.total.token_id || '?'
      amount = `#${tokenId}`
      description = isMint
        ? `Minted NFT #${tokenId}`
        : isReceive
          ? `Received NFT #${tokenId}`
          : `Sent NFT #${tokenId}`
    } else {
      // ERC-1155
      const tokenId = transfer.total.token_id || '?'
      const value = transfer.total.value || '1'
      amount = `${value}x #${tokenId}`
      description = isMint
        ? `Minted ${amount}`
        : isReceive
          ? `Received ${amount}`
          : `Sent ${amount}`
    }

    const type: ActivityItem['type'] = isMint ? 'mint' : (isReceive ? 'receive' : 'send')
    const icon: ActivityItem['icon'] = isMint ? 'mint' : (isReceive ? 'receive' : 'send')

    return {
      id: `${transfer.transaction_hash}-${transfer.log_index}`,
      type,
      status: 'confirmed',
      timestamp: new Date(transfer.timestamp).getTime(),
      blockNumber: BigInt(transfer.block_number),
      transactionHash: transfer.transaction_hash,
      token: {
        address: transfer.token.address_hash,
        symbol: transfer.token.symbol || 'Unknown',
        name: transfer.token.name || 'Unknown Token',
        decimals,
      },
      from,
      to,
      amount,
      rawAmount,
      description,
      icon,
    }
  }
}
