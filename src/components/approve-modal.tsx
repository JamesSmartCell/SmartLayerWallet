'use client'

import { useEffect, useMemo, useState } from 'react'
import { useWallet } from './wallet-provider-real'
import { Button } from './ui/button'
import { X, CheckCircle2, ExternalLink } from 'lucide-react'
import { isAddress, Address, parseUnits, formatUnits } from 'viem'
import { NETWORKS, getEnabledNetworkKeys, type NetworkKey } from '@/lib/env'
import { useTokenBalances } from '@/hooks/use-token-balances'

interface ApproveModalProps {
  isOpen: boolean
  onClose: () => void
  initialToken?: string
  initialAmount?: string
  initialSpender?: string
  initialTokenAddress?: string
  initialNetwork?: NetworkKey
  initialError?: string
}

export function ApproveModal({ 
  isOpen, 
  onClose, 
  initialToken,
  initialAmount,
  initialSpender,
  initialTokenAddress,
  initialNetwork,
  initialError
}: ApproveModalProps) {
  const { balance, approveErc20 } = useWallet()
  const { tokens, fetchBalance } = useTokenBalances({ isOpen })
  
  const [spender, setSpender] = useState(initialSpender || '')
  const [amount, setAmount] = useState(initialAmount || '')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(initialError || '')
  const [selectedKey, setSelectedKey] = useState<string>('')

  // Handle pre-selection
  useEffect(() => {
    if (isOpen && tokens.length > 0 && !selectedKey) {
      let targetKey = initialToken
      if (!targetKey && initialTokenAddress) {
        const found = tokens.find(o => 
          o.address?.toLowerCase() === initialTokenAddress.toLowerCase() &&
          (!initialNetwork || o.networkKey === initialNetwork)
        )
        if (found) targetKey = found.key
      }

      const finalKey = tokens.find(o => o.key === targetKey) ? targetKey! : tokens[0].key
      setSelectedKey(finalKey)
    }
  }, [isOpen, tokens, initialToken, initialTokenAddress, initialNetwork, selectedKey])

  // Fetch balance for SELECTED token on-demand
  useEffect(() => {
    if (isOpen && selectedKey) {
      fetchBalance(selectedKey)
    }
  }, [isOpen, selectedKey, fetchBalance])

  const selected = useMemo(() => tokens.find(t => t.key === selectedKey), [tokens, selectedKey])
  const maxAmount = useMemo(() => {
    if (!selected) return 0
    return Number(formatUnits(selected.rawBalance, selected.decimals))
  }, [selected])

  const handleApprove = async () => {
    setError('')
    
    // Validation
    if (!selected) {
      setError('Please select a token')
      return
    }

    if (!spender.trim()) {
      setError('Spender address is required')
      return
    }

    if (!isAddress(spender)) {
      setError('Invalid spender address')
      return
    }

    if (!amount || parseFloat(amount) < 0) {
      setError('Amount must be 0 or greater')
      return
    }

    setIsLoading(true)

    try {
      if (!selected.address) throw new Error('Invalid token')
      const value = parseUnits(amount, selected.decimals)
      const txHash = await approveErc20(selected.address as Address, spender as Address, value)
      
      console.log('Approval transaction sent:', txHash)
      alert(`Approval transaction sent! Hash: ${txHash}`)
      
      // Reset form and close modal
      setSpender('')
      setAmount('')
      onClose()
    } catch (error) {
      console.error('Approve transaction failed:', error)
      setError(error instanceof Error ? error.message : 'Transaction failed')
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-populate spender if empty based on selected token's network
  useEffect(() => {
    // Payment contracts have been removed from this wallet
    // Users must manually enter spender address
  }, [isOpen, selected])

  // Update internal state when props change while modal is open (or just opened)
  useEffect(() => {
    if (isOpen) {
      if (initialSpender) setSpender(initialSpender)
      if (initialAmount) setAmount(initialAmount)
      if (initialError) setError(initialError)
    }
  }, [isOpen, initialSpender, initialAmount, initialError])

  const handleMaxClick = () => {
    setAmount(maxAmount.toString())
  }

  // Suggested Spenders
  const suggestedSpenders = useMemo(() => {
    // Payment contracts have been removed from this wallet
    return []
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Approve ERC20</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Token Selection */}
        <div className="mb-4">
          <div className="flex justify-between items-end mb-2">
            <label className="block text-sm font-medium text-gray-700">Token</label>
            {selected && (
              <span className="text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded">
                {selected.tokenName} • {selected.networkName}
              </span>
            )}
          </div>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            {tokens.length === 0 && <option value="">No tokens found</option>}
            {tokens.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Spender */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Spender Address
          </label>
          <input
            type="text"
            value={spender}
            onChange={(e) => setSpender(e.target.value)}
            placeholder="0x..."
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-2"
          />
        </div>

        {/* Amount */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Amount
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="any"
              min="0"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none pr-16"
            />
            <button
              onClick={handleMaxClick}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              MAX
            </button>
          </div>
          <div className="mt-2 space-y-1">
            <div className="text-sm text-gray-600 flex justify-between">
              <span>Available {selected?.label || 'Token'}:</span>
              <span className="font-medium">{maxAmount.toFixed(6)}</span>
            </div>
            <div className="text-sm text-gray-600 flex justify-between">
              <span>Wallet ETH Balance:</span>
              <span className="font-medium">{parseFloat(formatUnits(balance, 18)).toFixed(6)} ETH</span>
            </div>
          </div>
        </div>

        {/* Error */ }
        { (error || (balance === 0n && selected && !NETWORKS[selected.networkKey].paymaster)) && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">
              { error || "ETH required to pay transaction gas" }
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            className="flex-1 flex items-center justify-center gap-2"
            disabled={ isLoading || tokens.length === 0 || (!NETWORKS[selected?.networkKey as NetworkKey]?.paymaster && balance === 0n) }
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Approving...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Approve
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
