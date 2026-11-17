'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from './wallet-provider-real'
import { Button } from './ui/button'
import { X, UserPlus, Check, Loader2 } from 'lucide-react'
import { isAddress, Address } from 'viem'

interface AddOwnerModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AddOwnerModal({ isOpen, onClose }: AddOwnerModalProps) {
  const { address, addOwner, isOwnerAddress, isDeployed } = useWallet()

  const [ownerAddress, setOwnerAddress] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isAlreadyOwner, setIsAlreadyOwner] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setOwnerAddress('')
      setIsLoading(false)
      setIsChecking(false)
      setIsAlreadyOwner(false)
      setError('')
      setTxHash('')
    }
  }, [isOpen])

  // Check if entered address is already an owner (debounced)
  const checkOwnership = useCallback(async (addr: string) => {
    if (!isAddress(addr) || !isDeployed) {
      setIsAlreadyOwner(false)
      return
    }

    setIsChecking(true)
    try {
      const result = await isOwnerAddress(addr as Address)
      setIsAlreadyOwner(result)
    } catch {
      setIsAlreadyOwner(false)
    } finally {
      setIsChecking(false)
    }
  }, [isOwnerAddress, isDeployed])

  useEffect(() => {
    if (!ownerAddress || !isAddress(ownerAddress)) {
      setIsAlreadyOwner(false)
      return
    }

    const timeout = setTimeout(() => {
      checkOwnership(ownerAddress)
    }, 500)
    return () => clearTimeout(timeout)
  }, [ownerAddress, checkOwnership])

  const handleAddOwner = async () => {
    setError('')
    setTxHash('')

    if (!ownerAddress.trim()) {
      setError('Address is required')
      return
    }

    if (!isAddress(ownerAddress)) {
      setError('Invalid Ethereum address')
      return
    }

    if (ownerAddress.toLowerCase() === address?.toLowerCase()) {
      setError('Cannot add the wallet itself as an owner')
      return
    }

    if (isAlreadyOwner) {
      setError('This address is already an owner')
      return
    }

    if (!isDeployed) {
      setError('Smart wallet must be deployed first. Send a transaction to deploy it.')
      return
    }

    setIsLoading(true)

    try {
      const hash = await addOwner(ownerAddress as Address)
      setTxHash(hash)
    } catch (err: any) {
      let errorMessage = 'Failed to add owner'
      if (err.message?.includes('User cancelled') || err.message?.includes('AbortError')) {
        errorMessage = 'Passkey authentication cancelled'
      } else if (err.message?.includes('insufficient funds')) {
        errorMessage = 'Insufficient funds for gas'
      } else if (err.message) {
        errorMessage = err.message
      }
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Add Owner</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {txHash ? (
          // Success state
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-4">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Owner Added</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {ownerAddress.slice(0, 6)}...{ownerAddress.slice(-4)} is now a co-owner of your wallet.
            </p>
            <p className="text-xs text-muted-foreground mb-6 font-mono break-all">
              Tx: {txHash}
            </p>
            <Button onClick={onClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          // Form state
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Add an external wallet (EOA) as a co-owner of your smart wallet. This wallet will be able to control your account if you lose access to your passkey.
            </p>

            {/* Owner Address Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                EOA Wallet Address
              </label>
              <input
                type="text"
                value={ownerAddress}
                onChange={(e) => setOwnerAddress(e.target.value)}
                placeholder="0x..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={isLoading}
              />
            </div>

            {/* Ownership check feedback */}
            {isChecking && (
              <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking ownership...
              </div>
            )}

            {isAlreadyOwner && (
              <div className="mb-4 flex items-center gap-2 text-sm text-green-600">
                <Check className="h-4 w-4" />
                This address is already an owner
              </div>
            )}

            {/* Not deployed warning */}
            {!isDeployed && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-700">
                  Your smart wallet is not deployed yet. You need to send at least one transaction first.
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
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
                onClick={handleAddOwner}
                className="flex-1 flex items-center justify-center gap-2"
                disabled={isLoading || isAlreadyOwner || !isDeployed}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Add Owner
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
