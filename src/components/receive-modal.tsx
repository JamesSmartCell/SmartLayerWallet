'use client'

import { useState } from 'react'
import { useWallet } from './wallet-provider-real'
import { Button } from './ui/button'
import { X, Copy, CheckCircle } from 'lucide-react'

interface ReceiveModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ReceiveModal({ isOpen, onClose }: ReceiveModalProps) {
  const { address } = useWallet()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!address) return

    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy address:', error)
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = address
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (fallbackError) {
        console.error('Fallback copy failed:', fallbackError)
      }
      document.body.removeChild(textArea)
    }
  }

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const generateQRCodeUrl = (addr: string) => {
    // Using a simple QR code service - in production, you might want to use a more robust solution
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(addr)}`
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Receive Crypto</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* QR Code */}
        <div className="text-center mb-6">
          {address && (
            <div className="inline-block p-4 bg-white border-2 border-gray-200 rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={generateQRCodeUrl(address)}
                alt="Wallet Address QR Code"
                className="w-48 h-48 mx-auto"
              />
            </div>
          )}
        </div>

        {/* Address */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your Wallet Address
          </label>
          <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <code className="flex-1 text-sm text-gray-900 font-mono">
              {address ? formatAddress(address) : 'Not connected'}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!address}
              className="flex items-center gap-1 min-w-0"
            >
              {copied ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-green-500">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy
                </>
              )}
            </Button>
          </div>
          {address && (
            <div className="mt-2 text-xs text-gray-600 font-mono break-all">
              Full address: {address}
            </div>
          )}
        </div>

        {/* Network Info */}
        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 text-blue-800">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span className="text-sm font-medium">Base Sepolia Testnet</span>
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Only send Base Sepolia testnet tokens to this address
          </p>
        </div>

        {/* Supported Tokens */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Supported Tokens
          </label>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">Ξ</span>
              </div>
              <div>
                <div className="font-medium text-sm">ETH</div>
                <div className="text-xs text-gray-600">Ethereum</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">UC</span>
              </div>
              <div>
                <div className="font-medium text-sm">USDC</div>
                <div className="text-xs text-gray-600">USD Coin</div>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            <strong>Instructions:</strong> Share this address or QR code to receive crypto. 
            Make sure the sender is using Base Sepolia testnet.
          </p>
        </div>

        {/* Actions */}
        <Button
          onClick={onClose}
          className="w-full"
        >
          Done
        </Button>
      </div>
    </div>
  )
}
