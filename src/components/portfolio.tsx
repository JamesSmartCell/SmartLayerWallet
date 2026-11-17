'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useWallet } from './wallet-provider-real'
import { Button } from './ui/button'
import { RefreshCw, TrendingUp, TrendingDown, Loader2 } from 'lucide-react'
import { PortfolioService } from '@/lib/portfolio'
import { formatUnits } from 'viem'
import { useNetwork } from '@/components/network-provider'

// In-memory metadata cache across renders
const tokenMetaCache: Map<string, { symbol: string; name: string; decimals: number }> = new Map()

// Address override map for edge cases
const TOKEN_OVERRIDES: Record<string, { symbol?: string; name?: string; decimals?: number }> = {
  // Phrase1 PRD Testing (PPTC)
  '0x36d1bd6293fa8731f735d0a333e3d26370d45040': { name: 'Phrase1 PRD Testing (PPTC)', symbol: 'PPTC' },
}

export function Portfolio() {
  const { balance, isLoading, refreshBalance, getErc20Balances, address } = useWallet()
  const { selectedNetwork } = useNetwork()
  const [erc20, setErc20] = useState<{ token: `0x${string}`; balance: bigint }[]>([])
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [metaByAddress, setMetaByAddress] = useState<Record<string, { symbol: string; name: string; decimals: number }>>({})
  const portfolioServiceRef = useRef<PortfolioService | null>(null)

  const formattedEth = useMemo(() => {
    const num = Number(balance) / 1e18
    if (!isFinite(num) || num === 0) return '0'
    if (num < 0.0001) return '<0.0001'
    return num.toFixed(6)
  }, [balance])

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingTokens(true)
        const list = await getErc20Balances()
        setErc20(list.filter(i => i.balance > 0n))
      } finally {
        setLoadingTokens(false)
      }
    }
    load()
  }, [getErc20Balances])

  // Refresh both ETH (via refreshBalance) and ERC-20 balances together
  const handleRefresh = useCallback(async () => {
    if (!address) return
    try {
      setLoadingTokens(true)
      const [, list] = await Promise.all([
        refreshBalance(),
        getErc20Balances(),
      ])
      setErc20(list.filter(i => i.balance > 0n))
    } finally {
      setLoadingTokens(false)
    }
  }, [address, refreshBalance, getErc20Balances])

  // Fetch and cache token metadata for displayed tokens
  useEffect(() => {
    const fetchMeta = async () => {
      if (!address || erc20.length === 0) return
      if (!portfolioServiceRef.current || portfolioServiceRef.current.getNetworkKey() !== selectedNetwork) {
        portfolioServiceRef.current = new PortfolioService(selectedNetwork)
      }
      const svc = portfolioServiceRef.current

      const entries = await Promise.all(erc20.map(async (t) => {
        const addrKey = t.token.toLowerCase()
        if (tokenMetaCache.has(addrKey)) {
          return [addrKey, tokenMetaCache.get(addrKey)!] as const
        }
        try {
          const override = TOKEN_OVERRIDES[addrKey]
          // Use PortfolioService to read metadata; it will also read token balance but we ignore that
          const tb = await svc.getTokenBalance(address, t.token)
          const meta = tb ? { symbol: tb.symbol, name: tb.name, decimals: tb.decimals } : { symbol: 'TOKEN', name: 'Unknown Token', decimals: 18 }
          const merged = { ...meta, ...override }
          tokenMetaCache.set(addrKey, merged)
          return [addrKey, merged] as const
        } catch {
          const fallback = { symbol: 'TOKEN', name: 'Unknown Token', decimals: 18, ...TOKEN_OVERRIDES[addrKey] }
          tokenMetaCache.set(addrKey, fallback)
          return [addrKey, fallback] as const
        }
      }))

      const map: Record<string, { symbol: string; name: string; decimals: number }> = {}
      for (const [k, v] of entries) map[k] = v
      setMetaByAddress(map)
    }
    fetchMeta()
  }, [address, erc20, selectedNetwork])

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading portfolio...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      {/* Portfolio Header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Portfolio</h2>
            <div className="mt-2">
              <span className="text-3xl font-bold text-gray-900">{formattedEth} ETH</span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading || loadingTokens}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${(isLoading || loadingTokens) ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Token Balances */}
      <div className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg overflow-hidden">
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">Ξ</span>
              </div>
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">ETH</div>
                <div className="text-sm text-gray-600">Ethereum</div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-medium text-gray-900 whitespace-nowrap">{formattedEth} ETH</div>
            </div>
          </div>

          {loadingTokens ? (
            <div className="flex items-center justify-center py-2 text-sm text-gray-500">Loading tokens…</div>
          ) : erc20.length === 0 ? null : (
            erc20.map((t) => {
              const addrKey = t.token.toLowerCase()
              const meta = metaByAddress[addrKey] || TOKEN_OVERRIDES[addrKey] || { symbol: 'TOKEN', name: 'Unknown Token', decimals: 18 }
              const formatted = (() => {
                try {
                  const units = formatUnits(t.balance, meta.decimals)
                  const num = parseFloat(units)
                  if (!isFinite(num) || num === 0) return '0'
                  if (num < 0.0001) return '<0.0001'
                  return num.toFixed(6)
                } catch {
                  const num = Number(t.balance) / 1e18
                  if (!isFinite(num) || num === 0) return '0'
                  if (num < 0.0001) return '<0.0001'
                  return num.toFixed(6)
                }
              })()
              return (
                <div key={t.token} className="p-4 bg-gray-50 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center">
                        <span className="text-white font-semibold text-sm">●</span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{meta.name || meta.symbol}</div>
                        <div className="text-xs text-gray-600 break-all">{t.token}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-medium text-gray-900 whitespace-nowrap">{formatted} {meta.symbol || 'TOKEN'}</div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Portfolio Actions */}
      <div className="p-6 border-t border-gray-100">
        <div className="grid grid-cols-2 gap-4">
          <Button variant="outline" className="flex items-center justify-center gap-2" disabled>
            <TrendingUp className="h-4 w-4" />
            Buy Crypto
          </Button>
          <Button variant="outline" className="flex items-center justify-center gap-2" disabled>
            <TrendingDown className="h-4 w-4" />
            Sell Crypto
          </Button>
        </div>
      </div>
    </div>
  )
}
