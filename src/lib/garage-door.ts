/**
 * Garage Door API and signing utilities
 * Uses P256 passkey signatures compatible with checkGarageSigP256 on the IoT device
 *
 * WebAuthn signs SHA256(authenticatorData || SHA256(clientDataJSON)), NOT keccak256.
 * We pass the WebAuthn digest to the device for correct recovery (hashType=webauthn).
 */

import { hashMessage, keccak256, type Hex } from 'viem'
import { sign, parseSignature } from 'webauthn-p256'
import { concatBytes, hexToBytes, utf8ToBytes, bytesToHex } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import { ENV } from './env'

const ERC721_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const FIRMWARE_VERSION_RE = /^\d+\.\d+\.\d+/
const GARAGE_CHALLENGE_RE = /^[A-Za-z][A-Za-z0-9]*-[0-9a-fA-F]+$/
const CAM_CHALLENGE_RE = /^cam-[0-9a-fA-F]+-[0-9a-fA-F]+$/

export function isFirmwareVersionString(text: string): boolean {
  return FIRMWARE_VERSION_RE.test(text.trim())
}

export function isGarageChallenge(text: string): boolean {
  const value = text.trim()
  if (!value || isFirmwareVersionString(value)) return false
  return GARAGE_CHALLENGE_RE.test(value) || CAM_CHALLENGE_RE.test(value)
}

async function readDeviceText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Device API error: ${res.status}`)
  }
  return (await res.text()).trim()
}

export async function fetchFirmwareVersion(): Promise<string> {
  const iotAddr = ENV.IOT_DEVICE_ADDRESS
  const base = ENV.GARAGE_API_BASE.replace(/\/$/, '')
  const url = `${base}/${iotAddr}/getVersion`
  const text = await readDeviceText(url)
  if (!isFirmwareVersionString(text)) {
    throw new Error(`Unexpected firmware version reply: ${text}`)
  }
  return text
}

export async function fetchChallenge(): Promise<string> {
  const iotAddr = ENV.IOT_DEVICE_ADDRESS
  const base = ENV.GARAGE_API_BASE.replace(/\/$/, '')
  const url = `${base}/${iotAddr}/getChallenge`
  if (typeof window !== 'undefined') console.debug('[GarageDoor] fetchChallenge URL:', url)

  const tryOnce = async () => {
    const text = await readDeviceText(url)
    if (!isGarageChallenge(text)) {
      throw new Error(`Ignored non-challenge reply: ${text}`)
    }
    return text
  }

  try {
    return await tryOnce()
  } catch (first) {
    // TcpBridge sometimes returns the previous getVersion body as getChallenge
    await new Promise((r) => setTimeout(r, 250))
    return await tryOnce().catch(() => {
      throw first
    })
  }
}

/**
 * WebAuthn signs SHA256(authenticatorData || SHA256(clientDataJSON)), not keccak256.
 * We compute that digest and pass it to the device for correct recovery.
 */
function computeWebAuthnDigest(authenticatorData: Hex, clientDataJSON: string): string {
  const hex = authenticatorData.startsWith('0x') ? authenticatorData.slice(2) : authenticatorData
  const authDataBytes = hexToBytes(hex)
  const clientDataHash = sha256(utf8ToBytes(clientDataJSON))
  const message = concatBytes(authDataBytes, clientDataHash)
  const digest = sha256(message)
  // bytesToHex returns hex without 0x - use as-is
  return bytesToHex(digest)
}

/**
 * Sign the challenge with passkey. WebAuthn signs its own digest structure.
 * Returns { sig, digest } - device uses digest for recovery (hashType=webauthn).
 */
export async function signChallengeForGarage(
  challenge: string,
  credentialId: string,
  rpId: string
): Promise<{ sig: string; digest: string }> {
  console.log('[GarageDoor] signChallengeForGarage', {
    challenge,
    rpId,
    credentialId: credentialId.slice(0, 16) + '…',
  })
  const hash = hashMessage(challenge) as Hex

  const result = await sign({
    hash,
    credentialId,
    rpId,
  })

  const { signature, webauthn } = result

  let digest: string
  if (webauthn?.authenticatorData && webauthn?.clientDataJSON) {
    digest = computeWebAuthnDigest(webauthn.authenticatorData, webauthn.clientDataJSON)
  } else {
    // Fallback: use keccak digest (device will try webauthn first, then keccak)
    digest = ''
    console.warn('[GarageDoor] no webauthn authenticatorData/clientDataJSON; digest empty')
  }

  const { r, s } = parseSignature(signature)
  const rHex = r.toString(16).padStart(64, '0')
  const sHex = s.toString(16).padStart(64, '0')
  const rsHex = rHex + sHex
  const recid = 0
  const sig = rsHex + recid.toString(16).padStart(2, '0')

  console.log('[GarageDoor] signed', {
    sigLen: sig.length,
    digest,
    hasWebAuthn: Boolean(webauthn?.authenticatorData && webauthn?.clientDataJSON),
  })

  return { sig, digest }
}

/**
 * Submit the signed challenge to the IoT device.
 * - checkGarageSigP256: open then auto-close cycle
 * - checkGarageSigP256_2: single toggle impulse
 */
export async function submitGarageSignature(
  sig: string,
  digest: string,
  endpoint: 'checkGarageSigP256' | 'checkGarageSigP256_2' = 'checkGarageSigP256'
): Promise<boolean> {
  const iotAddr = ENV.IOT_DEVICE_ADDRESS
  const base = ENV.GARAGE_API_BASE.replace(/\/$/, '')
  const params = new URLSearchParams({ sig })
  if (digest) {
    params.set('digest', digest)
    params.set('hashType', 'webauthn')
  }
  const url = `${base}/${iotAddr}/${endpoint}?${params.toString()}`
  console.log('[GarageDoor] submitGarageSignature', {
    endpoint,
    iotAddr,
    url: `${base}/${iotAddr}/${endpoint}?sig=…&digest=${digest || '(none)'}&hashType=${digest ? 'webauthn' : '(none)'}`,
    sigLen: sig.length,
    digest,
  })
  const res = await fetch(url)
  const text = (await res.text()).trim()
  console.log('[GarageDoor] submitGarageSignature response', {
    endpoint,
    status: res.status,
    ok: res.ok,
    body: text,
  })
  if (!res.ok) {
    throw new Error(`Garage API error: ${res.status} ${text}`)
  }
  return text.toLowerCase() === 'pass'
}

/**
 * Fetch ERC721 balance (Garage Door NFT) for an address
 */
export async function fetchGarageNftBalance(
  address: string,
  publicClient: { readContract: (args: any) => Promise<any> }
): Promise<bigint> {
  const result = await publicClient.readContract({
    address: ENV.GARAGE_DOOR_NFT_ADDRESS,
    abi: ERC721_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  })
  return BigInt(result as bigint | number | string)
}

export function isGarageAdmin(p256Address: string): boolean {
  return ENV.GARAGE_ADMIN_ADDRESSES.includes(p256Address.toLowerCase())
}

export type LiveCameraSession = {
  token: string
  address: string
  expiresAt: number
  ttlSec: number
  mode: 'mjpeg' | 'hls'
  streamUrl: string
  snapshotUrl: string
}

function cameraGateBase(): string {
  return ENV.CAMERA_GATE_URL || '/cam-gate'
}

function resolveStreamUrl(streamUrl: string): string {
  if (!streamUrl) return streamUrl
  if (/^https?:\/\//i.test(streamUrl)) return streamUrl
  const base = cameraGateBase()
  const path = streamUrl.startsWith('/') ? streamUrl : `/${streamUrl}`
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}${path}`
}

function withResolvedStream(session: LiveCameraSession): LiveCameraSession {
  const snapshotUrl = session.snapshotUrl || `/snapshot/${session.token}`
  return {
    ...session,
    streamUrl: resolveStreamUrl(session.streamUrl),
    snapshotUrl: resolveStreamUrl(snapshotUrl),
  }
}

export async function fetchLiveCameraChallenge(): Promise<string> {
  const res = await fetch(`${cameraGateBase()}/challenge`)
  if (!res.ok) {
    throw new Error(`Failed to fetch live camera challenge: ${res.status}`)
  }
  return (await res.text()).trim()
}

export async function authorizeLiveCamera(
  challenge: string,
  credentialId: string,
  rpId: string
): Promise<LiveCameraSession> {
  const { sig, digest } = await signChallengeForGarage(challenge, credentialId, rpId)
  const res = await fetch(`${cameraGateBase()}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sig,
      digest,
      hashType: digest ? 'webauthn' : 'keccak',
    }),
  })
  const text = (await res.text()).trim()
  if (!res.ok) {
    throw new Error(text || `Live camera auth failed: ${res.status}`)
  }
  const data = JSON.parse(text) as LiveCameraSession & { ok?: boolean }
  if (!data.token || (!data.streamUrl && !data.snapshotUrl)) {
    throw new Error('Live camera auth returned no stream or snapshot URL')
  }
  return withResolvedStream(data)
}

export async function fetchCameraSnapshot(token: string, snapshotUrl?: string): Promise<Blob> {
  const url = snapshotUrl
    ? resolveStreamUrl(snapshotUrl)
    : `${cameraGateBase()}/snapshot/${token}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Snapshot failed: ${res.status}`)
  }
  return res.blob()
}

export async function heartbeatLiveCamera(token: string): Promise<LiveCameraSession> {
  const res = await fetch(`${cameraGateBase()}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const text = (await res.text()).trim()
  if (!res.ok) {
    throw new Error(text || `Live camera heartbeat failed: ${res.status}`)
  }
  return withResolvedStream(JSON.parse(text) as LiveCameraSession)
}

export async function stopLiveCamera(token: string): Promise<void> {
  await fetch(`${cameraGateBase()}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => undefined)
}

/**
 * Fetch challenge from the Remote Camera (for takePicture auth)
 */
export async function fetchCameraChallenge(): Promise<string> {
  const cameraAddr = ENV.IOT_CAMERA_ADDRESS
  const base = ENV.GARAGE_API_BASE.replace(/\/$/, '')
  const url = `${base}/${cameraAddr}/getChallenge`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch camera challenge: ${res.status}`)
  }
  return (await res.text()).trim()
}

export type OtaDeviceResult = {
  ok: boolean
  httpStatus: number
  body: string
  requestUrl: string
  elapsedMs: number
  challenge: string
  deviceAddress: string
  meaning: string
}

function interpretOtaBody(httpStatus: number, body: string): { ok: boolean; meaning: string } {
  const text = body.trim()
  const lower = text.toLowerCase()
  if (lower === 'ok') {
    return { ok: true, meaning: 'Device accepted the firmware and will restart.' }
  }
  if (lower === 'error:missing_params') {
    return { ok: false, meaning: 'Device did not receive url or version (params never arrived).' }
  }
  if (lower === 'error:auth_required') {
    return { ok: false, meaning: 'Device did not receive a passkey signature.' }
  }
  if (lower === 'error:auth_failed') {
    return { ok: false, meaning: 'Signature recovered, but that address has no Garage Door NFT (and is not admin).' }
  }
  if (lower === 'error:ota_failed') {
    return { ok: false, meaning: 'Auth passed, but HTTPUpdate failed (bad URL, TLS, partition table, or same version).' }
  }
  if (text === '') {
    return { ok: false, meaning: 'Empty reply — updateReady is probably missing on this firmware, or the proxy dropped the body.' }
  }
  if (!Number.isFinite(httpStatus) || httpStatus === 0) {
    return { ok: false, meaning: 'Connection dropped. If auth passed, the device may have rebooted mid-update.' }
  }
  if (httpStatus >= 400) {
    return { ok: false, meaning: `Proxy/HTTP error ${httpStatus}.` }
  }
  return { ok: false, meaning: `Unexpected device reply: ${text || '(empty)'}` }
}

/**
 * Trigger OTA update on an IoT device (GarageDoor or Remote Camera).
 * Uses query params like Open/Toggle — TcpBridge does not parse JSON bodies.
 */
export async function updateReady(
  deviceAddress: string,
  firmwareUrl: string,
  version: string,
  challenge: string,
  credentialId: string,
  rpId: string
): Promise<OtaDeviceResult> {
  const { sig, digest } = await signChallengeForGarage(challenge, credentialId, rpId)
  const base = ENV.GARAGE_API_BASE.replace(/\/$/, '')
  const params = new URLSearchParams({ sig, url: firmwareUrl, version })
  if (digest) {
    params.set('digest', digest)
    params.set('hashType', 'webauthn')
  }
  const requestUrl = `${base}/${deviceAddress}/updateReady?${params.toString()}`
  const started = Date.now()
  console.log('[OTA] submitting updateReady', {
    deviceAddress,
    challenge,
    version,
    firmwareUrl,
    hasDigest: Boolean(digest),
  })

  try {
    const res = await fetch(requestUrl)
    const body = (await res.text()).trim()
    const elapsedMs = Date.now() - started
    const { ok, meaning } = interpretOtaBody(res.status, body)
    console.log('[OTA] device response', { httpStatus: res.status, body, elapsedMs, meaning })
    return {
      ok,
      httpStatus: res.status,
      body,
      requestUrl: `${base}/${deviceAddress}/updateReady?sig=…&url=${firmwareUrl}&version=${version}`,
      elapsedMs,
      challenge,
      deviceAddress,
      meaning,
    }
  } catch (e) {
    const elapsedMs = Date.now() - started
    const message = e instanceof Error ? e.message : String(e)
    const { ok, meaning } = interpretOtaBody(0, message)
    console.warn('[OTA] fetch failed', e)
    return {
      ok,
      httpStatus: 0,
      body: message,
      requestUrl: `${base}/${deviceAddress}/updateReady?sig=…&url=${firmwareUrl}&version=${version}`,
      elapsedMs,
      challenge,
      deviceAddress,
      meaning,
    }
  }
}

/**
 * Derive P256 address from passkey public key (0x04||x||y)
 * This is the address the IoT device recovers from the signature
 */
export function p256PublicKeyToAddress(publicKeyHex: string): `0x${string}` {
  let hex = publicKeyHex.startsWith('0x') ? publicKeyHex.slice(2) : publicKeyHex
  if (hex.startsWith('04')) hex = hex.slice(2)
  if (hex.length !== 128) throw new Error('Invalid P256 public key length')
  const hash = keccak256(('0x' + hex) as Hex)
  return ('0x' + hash.slice(-40)) as `0x${string}`
}
