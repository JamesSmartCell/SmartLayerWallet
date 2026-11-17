'use client'

import { useWallet } from '@/components/wallet-provider-real'
import { Button } from '@/components/ui/button'
import { Plus, Loader2, DoorOpen, DoorClosed, RefreshCw, Copy, Check, Upload } from 'lucide-react'
import { LiveCamera } from '@/components/live-camera'
import { useState, useEffect, useCallback, Suspense } from 'react'
import {
  fetchChallenge,
  fetchFirmwareVersion,
  isGarageChallenge,
  signChallengeForGarage,
  submitGarageSignature,
  fetchGarageNftBalance,
  fetchCameraChallenge,
  updateReady,
  p256PublicKeyToAddress,
  isGarageAdmin,
} from '@/lib/garage-door'
import { getWaterfallClient } from '@/lib/rpc'
import { ENV, NETWORK_KEYS } from '@/lib/env'

function GarageDoorPageContent() {
  const {
    isConnected,
    isLoading,
    address,
    error,
    user,
    signUp,
    login,
    logout,
  } = useWallet()

  const [challenge, setChallenge] = useState<string | null>(null)
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null)
  const [nftBalance, setNftBalance] = useState<bigint | null>(null)
  const [challengeError, setChallengeError] = useState<string | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [openLoading, setOpenLoading] = useState(false)
  const [openResult, setOpenResult] = useState<'success' | 'fail' | null>(null)
  const [toggleLoading, setToggleLoading] = useState(false)
  const [toggleResult, setToggleResult] = useState<'success' | 'fail' | null>(null)
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)
  const [otaPanelOpen, setOtaPanelOpen] = useState(false)
  const [otaUrl, setOtaUrl] = useState('')
  const [otaVersion, setOtaVersion] = useState('')
  const [otaDevice, setOtaDevice] = useState<'garage' | 'camera'>('garage')
  const [otaLoading, setOtaLoading] = useState(false)
  const [otaResult, setOtaResult] = useState<'success' | 'fail' | null>(null)
  const [otaError, setOtaError] = useState<string | null>(null)
  const [otaLog, setOtaLog] = useState<string[]>([])
  const [client, setClient] = useState<any>(null)

  // Initialize waterfall RPC client
  useEffect(() => {
    getWaterfallClient(NETWORK_KEYS.BASE_SEPOLIA).then(setClient)
  }, [])

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAddr(id)
      setTimeout(() => setCopiedAddr(null), 2000)
    } catch {
      // fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopiedAddr(id)
      setTimeout(() => setCopiedAddr(null), 2000)
    }
  }, [])

  const loadChallenge = useCallback(async () => {
    setChallengeError(null)
    try {
      const c = await fetchChallenge()
      if (!isGarageChallenge(c)) {
        throw new Error(`Device did not return a challenge (${c})`)
      }
      setChallenge(c)
    } catch (e) {
      setChallengeError(e instanceof Error ? e.message : 'Failed to fetch challenge')
      setChallenge(null)
    }
  }, [])

  const loadFirmwareVersion = useCallback(async () => {
    try {
      const v = await fetchFirmwareVersion()
      setFirmwareVersion(v)
    } catch {
      setFirmwareVersion(null)
    }
  }, [])

  const loadBalance = useCallback(async () => {
    if (!isConnected || !address || !user?.passkeyPublicKey || !client) return
    setBalanceError(null)
    try {
      const p256Addr = p256PublicKeyToAddress(user!.passkeyPublicKey)
      const balance = await fetchGarageNftBalance(p256Addr, client)
      setNftBalance(balance)
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : 'Failed to fetch balance')
      setNftBalance(null)
    }
  }, [isConnected, address, user, client])

  useEffect(() => {
    if (isConnected) {
      loadChallenge()
      loadBalance()
    }
  }, [isConnected, loadChallenge, loadBalance])

  useEffect(() => {
    if (isConnected && otaPanelOpen) {
      loadFirmwareVersion()
    }
  }, [isConnected, otaPanelOpen, loadFirmwareVersion])

  const handleConnect = async () => {
    try {
      await login()
    } catch (err) {
      console.error('Failed to connect:', err)
    }
  }

  const handleCreatePasskey = async () => {
    try {
      await signUp('garage-user')
    } catch (err) {
      console.error('Failed to create passkey:', err)
    }
  }

  const handleOpenGarage = async () => {
    if (!user?.passkeyId || !challenge || !isGarageChallenge(challenge)) {
      setOpenResult('fail')
      return
    }
    setOpenLoading(true)
    setOpenResult(null)
    try {
      const { sig, digest } = await signChallengeForGarage(
        challenge,
        user.passkeyId,
        ENV.RP_ID
      )
      const ok = await submitGarageSignature(sig, digest)
      setOpenResult(ok ? 'success' : 'fail')
      if (ok) {
        loadChallenge() // Refresh challenge after use
      }
    } catch (e) {
      console.error('Open garage failed:', e)
      setOpenResult('fail')
    } finally {
      setOpenLoading(false)
    }
  }

  const handleToggleGarage = async () => {
    if (!user?.passkeyId || !challenge || !isGarageChallenge(challenge)) {
      console.warn('[Toggle] missing passkey or challenge', {
        hasPasskeyId: Boolean(user?.passkeyId),
        challenge,
      })
      setToggleResult('fail')
      return
    }
    setToggleLoading(true)
    setToggleResult(null)
    try {
      console.log('[Toggle] signing challenge', { challenge, rpId: ENV.RP_ID })
      const { sig, digest } = await signChallengeForGarage(
        challenge,
        user.passkeyId,
        ENV.RP_ID
      )
      console.log('[Toggle] submitting checkGarageSigP256_2')
      const ok = await submitGarageSignature(sig, digest, 'checkGarageSigP256_2')
      console.log('[Toggle] device result', { ok })
      setToggleResult(ok ? 'success' : 'fail')
      if (ok) {
        loadChallenge()
      }
    } catch (e) {
      console.error('[Toggle] garage failed:', e)
      setToggleResult('fail')
    } finally {
      setToggleLoading(false)
    }
  }

  const handleRefresh = () => {
    loadChallenge()
    loadBalance()
  }

  const handleOtaUpdate = async () => {
    if (!user?.passkeyId || !otaUrl.trim() || !otaVersion.trim()) {
      setOtaError('Passkey, URL, and version required')
      return
    }
    setOtaLoading(true)
    setOtaError(null)
    setOtaResult(null)
    setOtaLog([])
    const lines: string[] = []
    const log = (line: string) => {
      console.log('[OTA]', line)
      lines.push(line)
      setOtaLog([...lines])
    }
    try {
      const deviceAddr =
        otaDevice === 'garage' ? ENV.IOT_DEVICE_ADDRESS : ENV.IOT_CAMERA_ADDRESS
      log(`device: ${otaDevice} ${deviceAddr}`)
      log(`firmware url: ${otaUrl.trim()}`)
      log(`version sent: ${otaVersion.trim()}`)

      try {
        const currentFw = await fetchFirmwareVersion()
        log(`device getVersion: ${currentFw}`)
        setFirmwareVersion(currentFw)
      } catch (e) {
        log(`device getVersion: unavailable (${e instanceof Error ? e.message : e})`)
      }

      const challengeUsed =
        otaDevice === 'garage' ? await fetchChallenge() : await fetchCameraChallenge()
      log(`challenge used: ${challengeUsed}`)

      const result = await updateReady(
        deviceAddr,
        otaUrl.trim(),
        otaVersion.trim(),
        challengeUsed,
        user.passkeyId,
        ENV.RP_ID
      )
      log(`http status: ${result.httpStatus || 'connection dropped'}`)
      log(`elapsed: ${result.elapsedMs}ms`)
      log(`device body: ${result.body || '(empty)'}`)
      log(result.meaning)
      setOtaError(result.ok ? null : result.meaning)
      setOtaResult(result.ok ? 'success' : 'fail')
      loadChallenge()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'OTA failed'
      log(`client error: ${message}`)
      setOtaError(message)
      setOtaResult('fail')
    } finally {
      setOtaLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-amber-400" />
          <p className="text-slate-300">Connecting...</p>
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="max-w-md w-full mx-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-500/20 rounded-2xl mb-4 border border-amber-500/40">
              <DoorOpen className="h-10 w-10 text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">GarageDoorKey</h1>
            <p className="text-slate-400">
              Passkey-powered garage door access on Base Sepolia
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <Button
              onClick={handleConnect}
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
              size="lg"
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Connect with Passkey
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-600" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-slate-900 px-2 text-slate-500">Or</span>
              </div>
            </div>

            <Button
              onClick={handleCreatePasskey}
              variant="outline"
              className="w-full h-12 border-slate-600 text-slate-300 hover:bg-slate-800"
              size="lg"
              disabled={isLoading}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New Passkey
            </Button>
          </div>

          <p className="text-xs text-slate-500 text-center mt-6">
            Secured by WebAuthn • Base Sepolia
          </p>
        </div>
      </div>
    )
  }

  const p256Address = user?.passkeyPublicKey
    ? p256PublicKeyToAddress(user.passkeyPublicKey)
    : null
  const hasAccess = nftBalance !== null && nftBalance > 0n
  const canOperate = hasAccess || Boolean(p256Address && isGarageAdmin(p256Address))

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="border-b border-slate-700 relative">
        <div className="max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setOtaPanelOpen((o) => !o)}
                className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center border border-amber-500/40 cursor-pointer"
              >
                <DoorOpen className="h-5 w-5 text-amber-400" />
              </button>
              <div className="flex items-center gap-2">
                <div>
                  <h1 className="font-semibold text-white">GarageDoorKey</h1>
                  <p className="text-xs text-slate-500 font-mono">
                    {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '—'}
                  </p>
                </div>
                {address && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-slate-400 hover:text-amber-400 shrink-0"
                    onClick={() => copyToClipboard(address, 'wallet')}
                    title="Copy full address"
                  >
                    {copiedAddr === 'wallet' ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
            <Button
              onClick={logout}
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-white"
            >
              Disconnect
            </Button>
          </div>
        </div>
        {otaPanelOpen && (
          <div className="absolute left-0 right-0 top-full z-10 border-b border-slate-700 bg-slate-800/95 backdrop-blur">
            <div className="max-w-lg mx-auto px-4 py-4">
              <h2 className="text-lg font-semibold text-white mb-4">OTA Update</h2>
              <p className="text-slate-400 text-sm mb-4">
                Push firmware to Garage Door or Remote Camera (requires NFT)
              </p>
              <div className="space-y-3 mb-4">
                <select
                  value={otaDevice}
                  onChange={(e) => setOtaDevice(e.target.value as 'garage' | 'camera')}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm"
                >
                  <option value="garage">Garage Door</option>
                  <option value="camera">Remote Camera</option>
                </select>
                <p className="text-xs text-slate-400">
                  Firmware: {firmwareVersion ?? 'unknown (getVersion not on device yet)'}
                </p>
                <input
                  type="url"
                  placeholder="Firmware URL (e.g. https://...r2.dev/firmware.bin)"
                  value={otaUrl}
                  onChange={(e) => setOtaUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500"
                />
                <input
                  type="text"
                  placeholder="Version (e.g. 1.2.3)"
                  value={otaVersion}
                  onChange={(e) => setOtaVersion(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500"
                />
              </div>
              <Button
                onClick={handleOtaUpdate}
                disabled={otaLoading || !canOperate || !otaUrl.trim() || !otaVersion.trim()}
                className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold disabled:opacity-50"
                size="lg"
              >
                {otaLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Push Update
                  </>
                )}
              </Button>
              {otaError && <p className="text-red-400 text-sm mt-2">{otaError}</p>}
              {otaResult === 'success' && (
                <p className="text-green-400 text-sm mt-2">
                  Device accepted the update. It will restart when the download finishes.
                </p>
              )}
              {otaLog.length > 0 && (
                <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-950/80 p-3 text-xs text-slate-300 whitespace-pre-wrap break-all">
                  {otaLog.join('\n')}
                </pre>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        {/* Garage Door NFT Balance */}
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Garage Door NFT</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          {balanceError ? (
            <p className="text-red-400 text-sm">{balanceError}</p>
          ) : nftBalance === null ? (
            <p className="text-slate-400">Loading...</p>
          ) : (
            <p className="text-2xl font-bold text-white mb-4">
              {nftBalance.toString()} <span className="text-slate-400 font-normal text-base">key{nftBalance !== 1n ? 's' : ''}</span>
            </p>
          )}
          {user?.passkeyPublicKey && (
            <div className="pt-3 border-t border-slate-600">
              <p className="text-xs text-slate-500 mb-1">Key address (for receiving NFTs)</p>
              <div className="flex items-center gap-2">
                <p className="text-slate-300 font-mono text-sm break-all flex-1 min-w-0">
                  {p256PublicKeyToAddress(user.passkeyPublicKey)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-400 hover:text-amber-400 shrink-0"
                  onClick={() => copyToClipboard(p256PublicKeyToAddress(user.passkeyPublicKey), 'p256')}
                  title="Copy key address"
                >
                  {copiedAddr === 'p256' ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Challenge */}
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-2">Current Challenge</h2>
          {challengeError ? (
            <p className="text-red-400 text-sm">{challengeError}</p>
          ) : challenge ? (
            <p className="text-slate-300 font-mono text-sm break-all">{challenge}</p>
          ) : (
            <p className="text-slate-400">Loading...</p>
          )}
        </div>

        {/* Open / Toggle Garage Door */}
        <div className="space-y-4">
          <Button
            onClick={handleOpenGarage}
            disabled={!challenge || !isGarageChallenge(challenge) || openLoading || toggleLoading || !canOperate}
            className="w-full h-14 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold text-lg disabled:opacity-50"
            size="lg"
          >
            {openLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <DoorOpen className="h-6 w-6 mr-2" />
                Open Garage Door
              </>
            )}
          </Button>

          <Button
            onClick={handleToggleGarage}
            disabled={!challenge || !isGarageChallenge(challenge) || openLoading || toggleLoading || !canOperate}
            className="w-full h-14 bg-green-400 hover:bg-green-500 text-black font-semibold text-lg disabled:opacity-50"
            size="lg"
          >
            {toggleLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <DoorClosed className="h-6 w-6 mr-2" />
                Toggle Door
              </>
            )}
          </Button>

          {!canOperate && nftBalance !== null && (
            <p className="text-amber-400/90 text-sm text-center">
              You need at least 1 Garage Door NFT to open the door
            </p>
          )}

          {openResult === 'success' && (
            <p className="text-green-400 text-sm text-center">Door opened successfully</p>
          )}
          {openResult === 'fail' && (
            <p className="text-red-400 text-sm text-center">Failed to open door. Please try again.</p>
          )}
          {toggleResult === 'success' && (
            <p className="text-green-400 text-sm text-center">Toggle sent</p>
          )}
          {toggleResult === 'fail' && (
            <p className="text-red-400 text-sm text-center">Toggle failed. Please try again.</p>
          )}
        </div>

        <LiveCamera passkeyId={user?.passkeyId} canOperate={canOperate} />

        <p className="text-xs text-slate-500 text-center mt-8">
          wallet.percolate.one • Base Sepolia
        </p>
      </main>
    </div>
  )
}

export default function GarageDoorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-900">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        </div>
      }
    >
      <GarageDoorPageContent />
    </Suspense>
  )
}
