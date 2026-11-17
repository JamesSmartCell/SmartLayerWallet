'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo, Suspense, useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { decodeAbiParameters, hexToBytes, formatUnits } from 'viem'
import { ArrowLeft, CreditCard, Clock, Hash, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWallet } from '@/components/wallet-provider-real'

/** PaymentRequest struct from PaymentHandlerDeployCandidate.sol */
interface PaymentRequest {
  paymentAmount: bigint
  tokenAddress: `0x${string}`
  salt: `0x${string}`
}

/** SignedPaymentRequest struct */
interface SignedPaymentRequest {
  deviceSignature: `0x${string}`
  timestamp: bigint
  paymentRequest: PaymentRequest
}

/** JSON payload format from device (base64url-encoded): { d, t, p: { a, tok, s } } */
interface PaymentRequestJson {
  d: string
  t: number
  p: { a: string; tok: string; s: string }
}

function decodePaymentRequest(param: string): SignedPaymentRequest | null {
  if (!param || param.length === 0) return null
  const json = tryDecodeJsonPayload(param)
  if (json) return jsonToSignedPaymentRequest(json)
  return decodePaymentRequestHex(param)
}

function tryDecodeJsonPayload(param: string): PaymentRequestJson | null {
  try {
    let b64 = param.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) b64 += '='.repeat(4 - pad)
    const decoded = atob(b64)
    const parsed = JSON.parse(decoded) as PaymentRequestJson
    if (typeof parsed.d === 'string' && typeof parsed.t === 'number' && parsed.p && typeof parsed.p.a === 'string' && typeof parsed.p.tok === 'string' && typeof parsed.p.s === 'string') {
      return parsed
    }
  } catch {
    /* not base64url JSON */
  }
  return null
}

function jsonToSignedPaymentRequest(json: PaymentRequestJson): SignedPaymentRequest {
  const sig = json.d.startsWith('0x') ? json.d : `0x${json.d}`
  const tok = json.p.tok.startsWith('0x') ? json.p.tok : `0x${json.p.tok}`
  const salt = json.p.s.startsWith('0x') ? json.p.s : `0x${json.p.s}`
  return {
    deviceSignature: sig as `0x${string}`,
    timestamp: BigInt(json.t),
    paymentRequest: {
      paymentAmount: BigInt(json.p.a),
      tokenAddress: tok as `0x${string}`,
      salt: salt as `0x${string}`,
    },
  }
}

function decodePaymentRequestHex(hex: string): SignedPaymentRequest | null {
  try {
    const withPrefix = hex.startsWith('0x') ? hex : `0x${hex}`
    const bytes = hexToBytes(withPrefix as `0x${string}`)

    const decoded = decodeAbiParameters(
      [
        { type: 'bytes', name: 'deviceSignature' },
        { type: 'uint256', name: 'timestamp' },
        {
          type: 'tuple',
          name: 'paymentRequest',
          components: [
            { type: 'uint256', name: 'paymentAmount' },
            { type: 'address', name: 'tokenAddress' },
            { type: 'bytes32', name: 'salt' },
          ],
        },
      ],
      bytes
    )

    const pr = decoded[2] as {
      paymentAmount: bigint
      tokenAddress: `0x${string}`
      salt: `0x${string}`
    }
    return {
      deviceSignature: decoded[0] as `0x${string}`,
      timestamp: decoded[1] as bigint,
      paymentRequest: pr,
    }
  } catch {
    return null
  }
}

type PayState = 'idle' | 'connecting' | 'sending' | 'success' | 'error'

function PaymentContent() {
  const searchParams = useSearchParams()
  const hexParam = searchParams.get('paymentRequest')
  const {
    isConnected,
    isLoading: walletLoading,
    login,
    signUp,
    sendPaymentDirect,
    checkPaymentReadiness,
    restoreSessionSilent,
    error: walletError,
  } = useWallet()

  const [payState, setPayState] = useState<PayState>('idle')
  const [payError, setPayError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const decoded = useMemo(() => {
    if (!hexParam) return null
    return decodePaymentRequest(hexParam)
  }, [hexParam])

  useEffect(() => {
    if (!isConnected && !walletLoading) {
      restoreSessionSilent().catch(() => {})
    }
  }, [isConnected, walletLoading, restoreSessionSilent])

  const handlePayDirect = useCallback(async () => {
    if (!decoded) return
    setPayError(null)
    try {
      if (!isConnected) {
        setPayState('connecting')
        await login()
      }
      setPayState('sending')
      const readiness = await checkPaymentReadiness({
        paymentAmount: decoded.paymentRequest.paymentAmount,
        tokenAddress: decoded.paymentRequest.tokenAddress,
      })
      if (!readiness.ok) {
        setPayState('error')
        setPayError(readiness.error ?? 'Cannot complete payment')
        return
      }
      const hash = await sendPaymentDirect({
        deviceSignature: decoded.deviceSignature,
        timestamp: decoded.timestamp,
        paymentRequest: {
          paymentAmount: decoded.paymentRequest.paymentAmount,
          tokenAddress: decoded.paymentRequest.tokenAddress,
          salt: decoded.paymentRequest.salt,
        },
      })
      setTxHash(hash)
      setPayState('success')
    } catch (err) {
      setPayState('error')
      setPayError(err instanceof Error ? err.message : 'Payment failed')
    }
  }, [decoded, isConnected, login, sendPaymentDirect, checkPaymentReadiness])

  if (!hexParam) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <h1 className="text-xl font-semibold text-white mb-2">Payment Request</h1>
          <p className="text-slate-400 mb-6">
            No payment request found. Use a link with the paymentRequest query parameter.
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

  if (!decoded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <h1 className="text-xl font-semibold text-white mb-2">Invalid Payment Request</h1>
          <p className="text-slate-400 mb-6">
            The payment request data could not be decoded. Please check the link and try again.
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

  const { paymentRequest, timestamp, deviceSignature } = decoded
  const amountFormatted = formatUnits(paymentRequest.paymentAmount, 18)
  const timestampDate = new Date(Number(timestamp) * 1000).toLocaleString()

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-4">
      <div className="max-w-md w-full mx-auto">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-slate-400 hover:text-white transition-colors"
          >
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
            <p className="text-sm text-slate-400 mt-1">
              Review the payment details before paying
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Payment amount */}
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Amount</p>
              <p className="text-2xl font-bold text-white">
                {amountFormatted} <span className="text-base font-normal text-slate-400">tokens</span>
              </p>
            </div>

            {/* Token address */}
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Token Address</p>
              <p className="font-mono text-sm break-all text-slate-300">
                {paymentRequest.tokenAddress}
              </p>
            </div>

            {/* Timestamp */}
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-500">Request timestamp</p>
                <p className="text-sm text-slate-300">{timestampDate}</p>
              </div>
            </div>

            {/* Salt */}
            <div className="flex items-start gap-2">
              <Hash className="w-4 h-4 text-slate-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-500">Salt (bytes32)</p>
                <p className="font-mono text-xs break-all text-slate-400">
                  {paymentRequest.salt}
                </p>
              </div>
            </div>

            {/* Device signature (truncated) */}
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Device signature</p>
              <p className="font-mono text-xs break-all text-slate-400">
                {deviceSignature.slice(0, 42)}...
              </p>
            </div>

            {/* Pay button */}
            <div className="pt-4 space-y-2">
              {payState === 'success' && (
                <div className="p-3 bg-emerald-500/20 rounded-lg border border-emerald-500/30">
                  <p className="text-sm text-emerald-400 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Payment submitted successfully
                    {txHash && (
                      <span className="block text-xs mt-1 text-slate-400">
                        Tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}
                      </span>
                    )}
                  </p>
                </div>
              )}
              {(payState === 'error' || payError || walletError) && (
                <div className="p-3 bg-red-500/20 rounded-lg border border-red-500/30">
                  <p className="text-sm text-red-400">{payError || walletError}</p>
                </div>
              )}
              <Button
                size="lg"
                className="w-full"
                disabled={
                  payState === 'connecting' ||
                  payState === 'sending' ||
                  payState === 'success' ||
                  walletLoading
                }
                onClick={handlePayDirect}
              >
                {(payState === 'connecting' || payState === 'sending' || walletLoading) ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    {payState === 'connecting'
                      ? 'Connecting...'
                      : payState === 'sending'
                        ? 'Awaiting Passkey...'
                        : 'Loading...'}
                  </>
                ) : !isConnected ? (
                  'Connect & Pay'
                ) : (
                  'Pay'
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

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800">
          <p className="text-slate-500">Loading payment request...</p>
        </div>
      }
    >
      <PaymentContent />
    </Suspense>
  )
}
