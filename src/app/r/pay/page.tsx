'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseUnits } from 'viem'
import { useWallet } from '@/components/wallet-provider-real'
import { Button } from '@/components/ui/button'
import { 
  parseERC681Params, 
  getChainName, 
  getExplorerTxUrl, 
  getExplorerAddressUrl,
  shortenAddress,
  type ERC681Request 
} from '@/lib/erc681'
import { 
  fetchTokenMetadata, 
  fetchTokenBalance, 
  formatTokenAmount,
  type TokenMetadata 
} from '@/lib/token-metadata'
import { NETWORKS } from '@/lib/env'
import { 
  Wallet, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2, 
  Copy, 
  ExternalLink,
  ShieldAlert,
  ArrowRight
} from 'lucide-react'
import { useNetwork } from '@/components/network-provider'

/**
 * Transaction state machine
 */
type TxState = 
  | 'idle'           // Initial state, showing transaction details
  | 'connecting'     // Connecting passkey
  | 'awaiting'       // Awaiting passkey signature
  | 'submitting'     // Submitting UserOperation
  | 'confirmed'      // Transaction confirmed
  | 'error'          // Error state

/**
 * Pay page content - wrapped in Suspense for useSearchParams
 */
function PayPageContent() {
  const searchParams = useSearchParams()
  const { 
    isConnected, 
    isLoading: walletLoading, 
    address, 
    login, 
    signUp,
    sendErc20,
    restoreSessionSilent,
    error: walletError 
  } = useWallet()

  // Track if we've attempted silent restore
  const [hasAttemptedRestore, setHasAttemptedRestore] = useState(false)

  // Parsed request and token metadata
  const [request, setRequest] = useState<ERC681Request | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [tokenMetadata, setTokenMetadata] = useState<TokenMetadata | null>(null)
  const [metadataFallback, setMetadataFallback] = useState(false)
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(true)

  // Transaction state
  const [txState, setTxState] = useState<TxState>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txError, setTxError] = useState<string | null>(null)

  // Chain validation
  const [chainMismatch, setChainMismatch] = useState(false)

  const { selectedNetwork } = useNetwork()

  // Parse URL parameters on mount
  useEffect(() => {
    const result = parseERC681Params(searchParams)
    if (!result.success) {
      setParseError(result.error || 'Invalid transaction parameters')
      setLoadingMetadata(false)
      return
    }

    setRequest(result.request!)

    // Check chain mismatch
    if (result.request!.chainId !== NETWORKS[selectedNetwork].id) {
      setChainMismatch(true)
    }

    // Fetch token metadata
    fetchTokenMetadata(result.request!.token, result.request!.chainId)
      .then((metaResult) => {
        if (metaResult.success && metaResult.metadata) {
          setTokenMetadata(metaResult.metadata)
          setMetadataFallback(metaResult.isFallback || false)
        }
      })
      .finally(() => setLoadingMetadata(false))
  }, [searchParams, selectedNetwork])

  // Try silent session restore on mount (no passkey prompt)
  // This allows returning users to skip the connect step
  useEffect(() => {
    if (hasAttemptedRestore) return
    setHasAttemptedRestore(true)

    // Only attempt if not already connected
    if (!isConnected) {
      restoreSessionSilent().then((restored) => {
        if (restored) {
          console.log('✅ Session restored silently - user can confirm with 1 passkey')
        }
      })
    }
  }, [hasAttemptedRestore, isConnected, restoreSessionSilent])

  // Fetch token balance when connected
  useEffect(() => {
    if (!isConnected || !address || !request) return

    fetchTokenBalance(request.token, address, request.chainId)
      .then(setTokenBalance)
  }, [isConnected, address, request])

  // Handle passkey connection
  const handleConnect = useCallback(async () => {
    setTxState('connecting')
    setTxError(null)
    try {
      await login()
      setTxState('idle')
    } catch (error) {
      setTxState('error')
      setTxError(error instanceof Error ? error.message : 'Failed to connect')
    }
  }, [login])

  // Handle new wallet creation
  const handleCreateWallet = useCallback(async () => {
    setTxState('connecting')
    setTxError(null)
    try {
      await signUp('wallet-user')
      setTxState('idle')
    } catch (error) {
      setTxState('error')
      setTxError(error instanceof Error ? error.message : 'Failed to create wallet')
    }
  }, [signUp])

  // Handle transaction confirmation
  const handleConfirm = useCallback(async () => {
    if (!request || !tokenMetadata) return

    setTxState('awaiting')
    setTxError(null)

    try {
      // Calculate amount in base units
      const amountBase = parseUnits(request.amount, tokenMetadata.decimals)

      // Check balance (optional but recommended)
      if (tokenBalance !== null && tokenBalance < amountBase) {
        throw new Error(`Insufficient ${tokenMetadata.symbol} balance`)
      }

      setTxState('submitting')

      // Send the transaction
      const hash = await sendErc20(request.token, request.to, amountBase)
      
      setTxHash(hash)
      setTxState('confirmed')
    } catch (error) {
      console.error('Transaction failed:', error)
      setTxState('error')
      
      // Parse user-friendly error messages
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed'
      if (errorMessage.includes('user rejected') || errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
        setTxError('Passkey authentication was cancelled')
      } else if (errorMessage.includes('insufficient')) {
        setTxError(errorMessage)
      } else if (errorMessage.includes('network') || errorMessage.includes('RPC')) {
        setTxError('Network error. Please try again.')
      } else {
        setTxError(errorMessage)
      }
    }
  }, [request, tokenMetadata, tokenBalance, sendErc20])

  // Copy to clipboard helper
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
  }, [])

  // Loading state
  if (loadingMetadata) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-blue-400" />
          <p className="text-slate-300">Loading transaction details...</p>
        </div>
      </div>
    )
  }

  // Parse error state
  if (parseError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-400" />
            <h1 className="text-xl font-semibold text-white mb-2">Invalid Request</h1>
            <p className="text-slate-400 mb-6">{parseError}</p>
            <p className="text-sm text-slate-500">
              Please scan a valid payment QR code or NFC tag.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Chain mismatch error
  if (chainMismatch && request) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-400" />
            <h1 className="text-xl font-semibold text-white mb-2">Wrong Network</h1>
            <p className="text-slate-400 mb-4">
              This transaction requires <span className="text-white font-medium">{getChainName(request.chainId)}</span>,
              but the wallet is configured for <span className="text-white font-medium">{selectedNetwork}</span>.
            </p>
            <p className="text-sm text-slate-500">
              Please contact support or use a wallet configured for the correct network.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Success state
  if (txState === 'confirmed' && txHash && request) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-white mb-2">Transaction Sent!</h1>
            <p className="text-slate-400 mb-6">
              Your transfer of {request.amount} {tokenMetadata?.symbol || 'tokens'} has been submitted.
            </p>
            
            <div className="bg-slate-900/50 rounded-xl p-4 mb-6">
              <p className="text-xs text-slate-500 mb-1">Transaction Hash</p>
              <div className="flex items-center justify-center gap-2">
                <code className="text-sm text-slate-300 font-mono">
                  {shortenAddress(txHash, 8)}
                </code>
                <button 
                  onClick={() => copyToClipboard(txHash)}
                  className="p-1 text-slate-400 hover:text-white transition-colors"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            <a
              href={getExplorerTxUrl(request.chainId, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors"
            >
              View on BaseScan
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    )
  }

  // Main transaction confirmation UI
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-4 flex flex-col">
      {/* Header */}
      <div className="text-center pt-8 pb-6">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-600/20 flex items-center justify-center">
          <Wallet className="h-6 w-6 text-blue-400" />
        </div>
        <h1 className="text-lg font-semibold text-white">Confirm Payment</h1>
        <p className="text-sm text-slate-400 mt-1">Review and authorize this transaction</p>
      </div>

      {/* Transaction Details Card */}
      <div className="flex-1 max-w-md w-full mx-auto">
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700 overflow-hidden">
          {/* Network Badge */}
          <div className="px-4 py-3 bg-slate-900/50 border-b border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Network</span>
              <span className="text-xs font-medium text-slate-300 bg-slate-700/50 px-2 py-1 rounded">
                {request && getChainName(request.chainId)} ({request?.chainId})
              </span>
            </div>
          </div>

          {/* Amount Section */}
          <div className="px-6 py-8 text-center border-b border-slate-700">
            <p className="text-4xl font-bold text-white mb-1">
              {request?.amount} <span className="text-blue-400">{tokenMetadata?.symbol || '...'}</span>
            </p>
            {tokenMetadata?.name && (
              <p className="text-sm text-slate-400">{tokenMetadata.name}</p>
            )}
            {metadataFallback && (
              <p className="text-xs text-amber-400 mt-2 flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Using default 18 decimals
              </p>
            )}
          </div>

          {/* Details */}
          <div className="divide-y divide-slate-700/50">
            {/* Token Contract */}
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">Token</span>
              <div className="flex items-center gap-2">
                <code className="text-sm text-slate-300 font-mono">
                  {request && shortenAddress(request.token)}
                </code>
                <button 
                  onClick={() => request && copyToClipboard(request.token)}
                  className="p-1 text-slate-500 hover:text-white transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {request && (
                  <a
                    href={getExplorerAddressUrl(request.chainId, request.token)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 text-slate-500 hover:text-white transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Recipient */}
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">To</span>
              <div className="flex items-center gap-2">
                <code className="text-sm text-slate-300 font-mono">
                  {request && shortenAddress(request.to)}
                </code>
                <button 
                  onClick={() => request && copyToClipboard(request.to)}
                  className="p-1 text-slate-500 hover:text-white transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {request && (
                  <a
                    href={getExplorerAddressUrl(request.chainId, request.to)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 text-slate-500 hover:text-white transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Your Wallet (if connected) */}
            {isConnected && address && (
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-slate-400">From</span>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-emerald-400 font-mono">
                    {shortenAddress(address)}
                  </code>
                  <button 
                    onClick={() => copyToClipboard(address)}
                    className="p-1 text-slate-500 hover:text-white transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Balance (if connected) */}
            {isConnected && tokenBalance !== null && tokenMetadata && (
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-slate-400">Your Balance</span>
                <span className="text-sm text-slate-300">
                  {formatTokenAmount(tokenBalance, tokenMetadata.decimals)} {tokenMetadata.symbol}
                </span>
              </div>
            )}
          </div>

          {/* Warning */}
          <div className="px-4 py-3 bg-amber-500/10 border-t border-amber-500/20">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-200/80">
                You are authorizing an on-chain transfer. This action cannot be undone.
              </p>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {(txError || walletError) && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-sm text-red-400">{txError || walletError}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 space-y-3">
          {!isConnected ? (
            <>
              <Button
                onClick={handleConnect}
                disabled={txState === 'connecting' || walletLoading}
                className="w-full h-14 text-base font-medium bg-blue-600 hover:bg-blue-500 rounded-xl"
              >
                {(txState === 'connecting' || walletLoading) ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wallet className="h-5 w-5 mr-2" />
                    Connect with Passkey
                  </>
                )}
              </Button>
              <Button
                onClick={handleCreateWallet}
                disabled={txState === 'connecting' || walletLoading}
                variant="outline"
                className="w-full h-12 text-sm border-slate-600 text-slate-300 hover:bg-slate-700/50 rounded-xl"
              >
                Create New Passkey Wallet
              </Button>
            </>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={txState !== 'idle' && txState !== 'error'}
              className="w-full h-14 text-base font-medium bg-blue-600 hover:bg-blue-500 rounded-xl"
            >
              {txState === 'awaiting' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Awaiting Passkey...
                </>
              ) : txState === 'submitting' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Submitting...
                </>
              ) : (
                <>
                  Confirm & Send
                  <ArrowRight className="h-5 w-5 ml-2" />
                </>
              )}
            </Button>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-slate-500 text-center mt-6 pb-8">
          Secured by WebAuthn Passkey • OpenPasskey Protocol
        </p>
      </div>
    </div>
  )
}

/**
 * Pay page with Suspense boundary for useSearchParams
 */
export default function PayPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800">
        <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
      </div>
    }>
      <PayPageContent />
    </Suspense>
  )
}

