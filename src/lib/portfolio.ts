import { createPublicClient, http, formatEther, formatUnits } from 'viem'
import { NETWORKS, NETWORK_KEYS, type NetworkKey } from './env'

export interface TokenBalance {
  symbol: string
  name: string
  address: string | null // null for native ETH
  balance: bigint
  decimals: number
  formattedBalance: string
  usdValue: number
  pricePerToken: number
}

export interface Portfolio {
  totalUsdValue: number
  balances: TokenBalance[]
  isLoading: boolean
  error: string | null
}

// ERC-20 ABI for balanceOf and metadata
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const



export class PortfolioService {
  private publicClient: any
  private chain: any
  private networkKey: NetworkKey

  constructor(networkKey: NetworkKey = NETWORK_KEYS.BASE_SEPOLIA) {
    this.networkKey = networkKey
    this.chain = NETWORKS[networkKey].chain

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(NETWORKS[this.networkKey].publicRpc || NETWORKS[this.networkKey].chain.rpcUrls.default.http[0]),
    })
  }

  getNetworkKey(): NetworkKey {
    return this.networkKey
  }

  async getPortfolio(address: string, prices: Record<string, number>): Promise<Portfolio> {
    try {
      const balances: TokenBalance[] = []

      // Get ETH balance
      const ethBalance = await this.publicClient.getBalance({ address })
      const ethFormatted = formatEther(ethBalance)
      const ethPrice = prices['ETH'] || 0
      const ethUsdValue = parseFloat(ethFormatted) * ethPrice

      balances.push({
        symbol: 'ETH',
        name: 'Ethereum',
        address: null,
        balance: ethBalance,
        decimals: 18,
        formattedBalance: ethFormatted,
        usdValue: ethUsdValue,
        pricePerToken: ethPrice,
      })

      // Get USDC balance
      const tokens = NETWORKS[this.networkKey].tokens as any
      const usdcConfig = tokens.USDC

      if (usdcConfig) {
        try {
          const usdcBalance = await this.publicClient.readContract({
            address: usdcConfig.address,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address],
          }) as bigint

          const usdcFormatted = formatUnits(usdcBalance, usdcConfig.decimals)
          const usdcPrice = prices['USDC'] || 1 // USDC is typically $1
          const usdcUsdValue = parseFloat(usdcFormatted) * usdcPrice

          balances.push({
            symbol: usdcConfig.symbol,
            name: usdcConfig.name,
            address: usdcConfig.address,
            balance: usdcBalance,
            decimals: usdcConfig.decimals,
            formattedBalance: usdcFormatted,
            usdValue: usdcUsdValue,
            pricePerToken: usdcPrice,
          })
        } catch (error) {
          console.warn('Failed to fetch USDC balance:', error)
          // Add USDC with zero balance if contract read fails
          balances.push({
            symbol: usdcConfig.symbol,
            name: usdcConfig.name,
            address: usdcConfig.address,
            balance: BigInt(0),
            decimals: usdcConfig.decimals,
            formattedBalance: '0',
            usdValue: 0,
            pricePerToken: prices['USDC'] || 1,
          })
        }
      }

      const totalUsdValue = balances.reduce((sum, balance) => sum + balance.usdValue, 0)

      return {
        totalUsdValue,
        balances,
        isLoading: false,
        error: null,
      }
    } catch (error) {
      console.error('Failed to fetch portfolio:', error)
      return {
        totalUsdValue: 0,
        balances: [],
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch portfolio',
      }
    }
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<TokenBalance | null> {
    try {
      const [balance, decimals, symbol, name] = await Promise.all([
        this.publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
        this.publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
          args: [],
        }),
        this.publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
          args: [],
        }),
        this.publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'name',
          args: [],
        }),
      ])

      const formattedBalance = formatUnits(balance as bigint, decimals as number)

      return {
        symbol: symbol as string,
        name: name as string,
        address: tokenAddress,
        balance: balance as bigint,
        decimals: decimals as number,
        formattedBalance,
        usdValue: 0, // Will be filled by pricing service
        pricePerToken: 0, // Will be filled by pricing service
      }
    } catch (error) {
      console.error('Failed to fetch token balance:', error)
      return null
    }
  }
}
