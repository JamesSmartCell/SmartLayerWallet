'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatUnits } from 'viem'
import Link from 'next/link'
import { useWallet } from '@/components/wallet-provider-real'
import { useNetwork } from '@/components/network-provider'
import { Button } from '@/components/ui/button'
import {
  parseEIP681Uri,
  getChainName,
  getExplorerTxUrl,
  getExplorerAddressUrl,
  shortenAddress,
  type EIP681TransferRequest,
} from '@/lib/erc681'
import {
  fetchTokenMetadata,
  fetchTokenBalance,
  type TokenMetadata,
} from '@/lib/token-metadata'
import { getNetworkKeyFromChainId, NETWORKS, ENV } from '@/lib/env'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  CheckCircle2,
  Copy,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react'

type TxState = 'idle' | 'connecting' | 'sending' | 'success' | 'error'

/** Response from GET /payment/devicesession/:deviceUid */
interface DeviceSessionResponse {
  chainId: number
  tokenAddress: string
  destination: string
  amountWei: string
  payId: string
}

async function fetchDeviceSession(deviceUid: string): Promise<DeviceSessionResponse> {
  const base = ENV.PAYMENT_BACKEND?.replace(/\/$/, '') || ''
  if (!base) throw new Error('Payment backend not configured')
  const res = await fetch(`${base}/payment/devicesession/${encodeURIComponent(deviceUid)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Failed to fetch payment (${res.status})`)
  }
  return res.json()
}

function StaticPaymentContent() {
  const searchParams = useSearchParams()
  const pParam = searchParams.get('p')
  const dParam = searchParams.get('d')
  const {
    isConnected,
    isLoading: walletLoading,
    address,
    login,
    signUp,
    sendErc20,
    restoreSessionSilent,
    error: walletError,
  } = useWallet()
  const { selectedNetwork, setNetwork } = useNetwork()

  const [request, setRequest] = useState<EIP681TransferRequest | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [tokenMetadata, setTokenMetadata] = useState<TokenMetadata | null>(null)
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(true)
  const [chainMismatch, setChainMismatch] = useState(false)
  const [payState, setPayState] = useState<TxState>('idle')
  const [payError, setPayError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  // Resolve payment request: from d (device session) or p (EIP-681 URI)
  useEffect(() => {
    if (dParam) {
      // Device session flow: fetch from backend, build request, go to Payment Request
      const base = ENV.PAYMENT_BACKEND?.replace(/\/$/, '') || ''
      setRequest(null)
      setParseError(null)

      if (!base) {
        setParseError('Payment backend not configured (NEXT_PUBLIC_PAYMENT_BACKEND)')
        setLoadingMetadata(false)
        return
      }

      let cancelled = false
      fetchDeviceSession(dParam)
        .then((data) => {
          if (cancelled) return
          const amount = BigInt(data.amountWei)
          const req: EIP681TransferRequest = {
            token: data.tokenAddress as `0x${string}`,
            chainId: data.chainId,
            to: data.destination as `0x${string}`,
            amount,
            pid: data.payId,
          }
          setRequest(req)

          const networkKey = getNetworkKeyFromChainId(req.chainId)
          if (networkKey && NETWORKS[selectedNetwork].id !== req.chainId) {
            setNetwork(networkKey)
          } else if (!networkKey) {
            setChainMismatch(true)
          }

          return fetchTokenMetadata(req.token, req.chainId)
        })
        .then((meta) => {
          if (cancelled || !meta) return
          if (meta.success && meta.metadata) {
            setTokenMetadata(meta.metadata)
          }
        })
        .catch((err) => {
          if (!cancelled) setParseError(err instanceof Error ? err.message : 'Failed to fetch payment')
        })
        .finally(() => {
          if (!cancelled) setLoadingMetadata(false)
        })
      return () => { cancelled = true }
    }

    if (pParam) {
      // EIP-681 flow: parse URI
      const decoded = decodeURIComponent(pParam)
      const result = parseEIP681Uri(decoded)
      if (!result.success) {
        setParseError(result.error || 'Invalid payment request')
        setLoadingMetadata(false)
        return
      }
      setRequest(result.request!)
      setParseError(null)

      const networkKey = getNetworkKeyFromChainId(result.request!.chainId)
      if (networkKey && NETWORKS[selectedNetwork].id !== result.request!.chainId) {
        setNetwork(networkKey)
      } else if (!networkKey) {
        setChainMismatch(true)
      }

      fetchTokenMetadata(result.request!.token, result.request!.chainId)
        .then((meta) => {
          if (meta.success && meta.metadata) setTokenMetadata(meta.metadata)
        })
        .finally(() => setLoadingMetadata(false))
      return
    }

    setParseError('No payment request found. Use a link with d (device UID) or p (EIP-681) parameter.')
    setLoadingMetadata(false)
  }, [dParam, pParam, selectedNetwork, setNetwork])

  useEffect(() => {
    if (!isConnected || !address || !request) return
    fetchTokenBalance(request.token, address, request.chainId).then(setTokenBalance)
  }, [isConnected, address, request])

  useEffect(() => {
    if (!isConnected && !walletLoading) {
      restoreSessionSilent().catch(() => {})
    }
  }, [isConnected, walletLoading, restoreSessionSilent])

  const handlePay = useCallback(async () => {
    if (!request) return
    setPayError(null)
    try {
      if (!isConnected) {
        setPayState('connecting')
        await login()
      }
      setPayState('sending')
      const hash = await sendErc20(request.token, request.to, request.amount)
      setTxHash(hash)
      // Report to backend for device polling (static payment with payId)
      if (request.pid && address) {
        const base = ENV.PAYMENT_BACKEND?.replace(/\/$/, '') || ''
        if (base) {
          await fetch(`${base}/payment-static-accounting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payId: request.pid, txHash: hash, userAddress: address }),
          }).catch(() => {}) // Non-blocking; device will poll
        }
      }
      setPayState('success')
    } catch (err) {
      setPayState('error')
      setPayError(err instanceof Error ? err.message : 'Payment failed')
    }
  }, [request, isConnected, address, login, sendErc20])

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
  }, [])

  if (!dParam && !pParam) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <h1 className="text-xl font-semibold text-white mb-2">Payment Request</h1>
          <p className="text-slate-400 mb-6">
            No payment request found. Use a link with d (device UID) or p (EIP-681).
          </p>
          <Link href="/">
            <Button variant="outline" className="w-full border-slate-600 text-slate-300">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  if (loadingMetadata) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800">
        <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
        <p className="ml-3 text-slate-300">Loading payment details...</p>
      </div>
    )
  }

  if (parseError || !request) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Invalid Payment Request</h1>
          <p className="text-slate-400 mb-6">{parseError}</p>
          <Link href="/">
            <Button variant="outline" className="w-full border-slate-600 text-slate-300">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  if (chainMismatch) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <AlertTriangle className="h-12 w-12 text-amber-400 mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Unsupported Network</h1>
          <p className="text-slate-400 mb-6">
            This payment requires {getChainName(request.chainId)}. Please switch your wallet network.
          </p>
          <Link href="/">
            <Button variant="outline" className="w-full border-slate-600 text-slate-300">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  const decimals = tokenMetadata?.decimals ?? 18
  const amountFormatted = (() => {
    const raw = formatUnits(request.amount, decimals)
    const num = parseFloat(raw)
    return num.toFixed(2)
  })()

  if (payState === 'success' && txHash) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
          </div>
          <h1 className="text-xl font-semibold text-white text-center mb-2">Payment Sent!</h1>
          <p className="text-slate-400 text-center mb-6">
            Your transfer of {amountFormatted} {tokenMetadata?.symbol || 'tokens'} has been submitted.
          </p>
          <div className="bg-slate-900/50 rounded-xl p-4 mb-6">
            <p className="text-xs text-slate-500 mb-1">Transaction Hash</p>
            <div className="flex items-center justify-center gap-2">
              <code className="text-sm text-slate-300 font-mono">{shortenAddress(txHash, 8)}</code>
              <button onClick={() => copyToClipboard(txHash)} className="p-1 text-slate-400 hover:text-white">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
          <a
            href={getExplorerTxUrl(request.chainId, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl"
          >
            View on Explorer
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-4">
      <div className="max-w-md w-full mx-auto">
        <div className="mb-6">
          <Link href="/" className="inline-flex items-center text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-white">
              <CreditCard className="w-5 h-5 text-blue-400" />
              Payment Request
            </h1>
            <p className="text-sm text-slate-400 mt-1">Review and confirm the transfer</p>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Amount</p>
              <p className="text-2xl font-bold text-white">
                {amountFormatted} <span className="text-base font-normal text-slate-400">{tokenMetadata?.symbol || 'tokens'}</span>
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">To</p>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm break-all text-slate-300">{request.to}</code>
                <button onClick={() => copyToClipboard(request.to)} className="p-1 text-slate-500 hover:text-white">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <a href={getExplorerAddressUrl(request.chainId, request.to)} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-500 hover:text-white">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Network</p>
              <p className="text-slate-300">{getChainName(request.chainId)}</p>
            </div>

            {isConnected && tokenBalance !== null && tokenMetadata && (
              <div>
                <p className="text-sm font-medium text-slate-500 mb-1">Your Balance</p>
                <p className="text-slate-300">
                  {formatUnits(tokenBalance, tokenMetadata.decimals)} {tokenMetadata.symbol}
                </p>
              </div>
            )}

            {(payError || walletError) && (
              <div className="p-3 bg-red-500/20 rounded-lg border border-red-500/30">
                <p className="text-sm text-red-400">{payError || walletError}</p>
              </div>
            )}

            <div className="pt-4 space-y-2">
              <Button
                size="lg"
                className="w-full"
                disabled={payState === 'connecting' || payState === 'sending' || walletLoading}
                onClick={handlePay}
              >
                {(payState === 'connecting' || payState === 'sending' || walletLoading) ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    {payState === 'connecting' ? 'Connecting...' : payState === 'sending' ? 'Sign & Send...' : 'Loading...'}
                  </>
                ) : !isConnected ? (
                  'Connect & Pay'
                ) : (
                  'Sign & Send'
                )}
              </Button>
              {!isConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-slate-600 text-slate-300"
                  disabled={walletLoading}
                  onClick={async () => {
                    setPayState('connecting')
                    await signUp('wallet-user')
                    setPayState('idle')
                  }}
                >
                  Create New Passkey Wallet
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StaticPaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800">
          <Loader2 className="h-10 w-10 animate-spin text-slate-500" />
        </div>
      }
    >
      <StaticPaymentContent />
    </Suspense>
  )
}
