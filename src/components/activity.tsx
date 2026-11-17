'use client'

import { useEffect, useState, useRef } from 'react'
import { useWallet } from './wallet-provider-real'
import { useNetwork } from './network-provider'
import { type ActivityItem } from '@/lib/activity'
import { getExplorerTxUrl } from '@/lib/explorer'
import { Button } from './ui/button'
import { RefreshCw, ArrowUpRight, ArrowDownLeft, Repeat, Sparkles, FileCheck, ExternalLink, Clock, CheckCircle, XCircle } from 'lucide-react'

export function Activity() {
  const { getTransactionHistory, address } = useWallet()
  const { networkConfig } = useNetwork()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!address) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await getTransactionHistory()
      setItems(result)
    } catch (e: any) {
      setError(e?.message || 'Failed to load activity')
    } finally {
      setIsLoading(false)
    }
  }

  // Refresh when address changes
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // Auto-refresh when network changes
  const prevChainIdRef = useRef(networkConfig.id)
  useEffect(() => {
    if (prevChainIdRef.current !== networkConfig.id) {
      prevChainIdRef.current = networkConfig.id
      setItems([]) // Clear stale data from previous network
      refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkConfig.id])

  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`

    return new Date(timestamp).toLocaleDateString()
  }

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const getIcon = (item: ActivityItem) => {
    const iconClass = "h-4 w-4"

    switch (item.icon) {
      case 'send':
        return <ArrowUpRight className={`${iconClass} text-red-500`} />
      case 'receive':
        return <ArrowDownLeft className={`${iconClass} text-green-500`} />
      case 'swap':
        return <Repeat className={`${iconClass} text-blue-500`} />
      case 'mint':
        return <Sparkles className={`${iconClass} text-purple-500`} />
      case 'approve':
        return <FileCheck className={`${iconClass} text-yellow-500`} />
      default:
        return <ArrowUpRight className={`${iconClass} text-gray-500`} />
    }
  }

  const getStatusIcon = (status: ActivityItem['status']) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return null
    }
  }

  const getExplorerUrl = (txHash: string) => {
    return getExplorerTxUrl(networkConfig.id, txHash)
  }

  if (isLoading && items.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading activity...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      {/* Activity Header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Activity List */}
      <div className="max-h-96 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-gray-400 mb-2">
              <ArrowUpRight className="h-12 w-12 mx-auto" />
            </div>
            <p className="text-gray-600">No activity yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Your transaction history will appear here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  {/* Left side - Icon and description */}
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                      {getIcon(item)}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {item.description}
                        </span>
                        {getStatusIcon(item.status)}
                      </div>

                      {item.token && (
                        <div className="text-sm text-gray-600">
                          {item.token.symbol}
                          {item.from && item.to && (
                            <span className="ml-2">
                              {item.type === 'send' ? 'to' : 'from'} {
                                item.type === 'send'
                                  ? formatAddress(item.to)
                                  : formatAddress(item.from)
                              }
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{formatTime(item.timestamp)}</span>
                        <a
                          href={getExplorerUrl(item.transactionHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Right side - Amount and value */}
                  <div className="text-right">
                    {item.amount && (
                      <div className={`font-medium ${
                        item.type === 'receive' || item.type === 'mint'
                          ? 'text-green-600'
                          : item.type === 'send'
                          ? 'text-red-600'
                          : 'text-gray-900'
                      }`}>
                        {(item.type === 'receive' || item.type === 'mint') && '+'}
                        {item.type === 'send' && '-'}
                        {item.amount}
                      </div>
                    )}

                    {item.usdValue && item.usdValue > 0 && (
                      <div className="text-sm text-gray-600">
                        ${item.usdValue.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Load More (disabled for now) */}
    </div>
  )
}
