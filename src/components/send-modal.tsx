'use client'

import { useEffect, useMemo, useState } from 'react'
import { useWallet } from './wallet-provider-real'
import { Button } from './ui/button'
import { X, Send } from 'lucide-react'
import { parseEther, isAddress, Address, parseUnits, formatUnits } from 'viem'
import { useTokenBalances } from '@/hooks/use-token-balances'
import { NETWORKS } from '@/lib/env'

interface SendModalProps {
  isOpen: boolean
  onClose: () => void
  initialToken?: string
}

export function SendModal({ isOpen, onClose, initialToken = 'ETH' }: SendModalProps) {
  const { balance, sendEther, sendErc20 } = useWallet()
  const { tokens, fetchBalance } = useTokenBalances({ isOpen, includeEth: true })
  
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedKey, setSelectedKey] = useState<string>('')

  // Handle pre-selection
  useEffect(() => {
    if (isOpen && tokens.length > 0 && !selectedKey) {
      const found = tokens.find(o => o.key === initialToken)
      if (found) {
        setSelectedKey(found.key)
      } else {
        // Fallback to ETH or first available
        const eth = tokens.find(t => t.key === 'ETH')
        setSelectedKey(eth ? eth.key : tokens[0].key)
      }
    }
  }, [isOpen, tokens, initialToken, selectedKey])

  // Fetch balance for SELECTED token on-demand
  useEffect(() => {
    if (isOpen && selectedKey && selectedKey !== 'ETH') {
      fetchBalance(selectedKey)
    }
  }, [isOpen, selectedKey, fetchBalance])

  const selected = useMemo(() => tokens.find(t => t.key === selectedKey) || tokens[0], [tokens, selectedKey])
  const maxAmount = useMemo(() => {
    if (!selected) return 0
    return Number(formatUnits(selected.rawBalance, selected.decimals))
  }, [selected])

  const handleSend = async () => {
    setError('')
    
    // Validation
    if (!recipient.trim()) {
      setError('Recipient address is required')
      return
    }

    if (!isAddress(recipient)) {
      setError('Invalid recipient address')
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Amount must be greater than 0')
      return
    }

    if (parseFloat(amount) > maxAmount) {
      setError(`Insufficient ${selected?.label || 'token'} balance`)
      return
    }

    setIsLoading(true)

    try {
      let txHash: `0x${string}`
      if (selected?.type === 'ETH') {
        const value = parseEther(amount)
        txHash = await sendEther(recipient as `0x${string}`, value)
      } else {
        if (!selected?.address) throw new Error('Invalid token')
        const value = parseUnits(amount, selected.decimals)
        txHash = await sendErc20(selected.address as Address, recipient as `0x${string}`, value)
      }
      
      console.log('Transaction sent:', txHash)
      alert(`Transaction sent! Hash: ${txHash}`)
      
      // Reset form and close modal
      setRecipient('')
      setAmount('')
      onClose()
    } catch (error) {
      console.error('Send transaction failed:', error)
      setError(error instanceof Error ? error.message : 'Transaction failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleMaxClick = () => {
    if (selected?.type === 'ETH') {
      const gasReserve = 0.001
      const maxSendable = Math.max(0, maxAmount - gasReserve)
      setAmount(maxSendable.toString())
    } else {
      setAmount(maxAmount.toString())
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Send Crypto</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Token Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Token</label>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            {tokens.map((t) => (
              <option key={t.key} value={t.key}>
                {t.type === 'ETH' ? 'ETH' : t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Recipient */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Recipient Address
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
              <span>Available {selected?.type === 'ETH' ? 'ETH' : (selected?.label || 'Token')}:</span>
              <span className="font-medium">{maxAmount.toFixed(6)}</span>
            </div>
            {selected?.type !== 'ETH' && (
              <div className="text-sm text-gray-600 flex justify-between">
                <span>Wallet ETH Balance:</span>
                <span className="font-medium">{parseFloat(formatUnits(balance, 18)).toFixed(6)} ETH</span>
              </div>
            )}
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
            onClick={handleSend}
            className="flex-1 flex items-center justify-center gap-2"
            disabled={
              isLoading ||
              !amount ||
              parseFloat(amount) > maxAmount ||
              (selected && !NETWORKS[selected.networkKey].paymaster && balance === 0n)
            }
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {selected?.type === 'ETH' ? 'Send ETH' : 'Send Token'}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// (ERC-20 transfers are not supported in the real provider version of this demo yet.)
