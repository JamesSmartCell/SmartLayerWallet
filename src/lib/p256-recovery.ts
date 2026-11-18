/**
 * P-256 (secp256r1) Public Key Recovery from WebAuthn ES256 Signatures
 * 
 * ECDSA signatures allow public key recovery: given a signature (r, s) over a message,
 * we can recover 2-4 candidate public keys. By verifying the signature with each candidate,
 * we find the correct one.
 * 
 * For WebAuthn:
 * - Signature is DER-encoded (r, s) in base64url
 * - Signed data = authenticatorData || sha256(clientDataJSON)
 * - Algorithm: ES256 (P-256 curve, SHA-256 hash)
 * 
 * Recovery process:
 * 1. Parse DER signature to get (r, s)
 * 2. Normalize s (if s > n/2, use n - s)
 * 3. Compute message hash
 * 4. Try recovery id 0 and 1 to get 2 candidate keys
 * 5. Verify signature with each candidate
 * 6. Return valid public key(s)
 */

import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha256'
import { Hex } from 'viem'

/**
 * Parse DER-encoded ECDSA signature to (r, s)
 */
export function parseDERSignature(derSig: Uint8Array): { r: bigint; s: bigint } {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  if (derSig[0] !== 0x30) {
    throw new Error('Invalid DER signature: must start with 0x30')
  }

  let pos = 2 // Skip 0x30 and total length

  // Parse r
  if (derSig[pos] !== 0x02) {
    throw new Error('Invalid DER signature: r must start with 0x02')
  }
  pos++
  const rLength = derSig[pos++]
  const rBytes = derSig.slice(pos, pos + rLength)
  const r = bytesToBigInt(rBytes)
  pos += rLength

  // Parse s
  if (derSig[pos] !== 0x02) {
    throw new Error('Invalid DER signature: s must start with 0x02')
  }
  pos++
  const sLength = derSig[pos++]
  const sBytes = derSig.slice(pos, pos + sLength)
  const s = bytesToBigInt(sBytes)

  return { r, s }
}

/**
 * Convert bytes to bigint (big-endian)
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte)
  }
  return result
}

/**
 * Normalize s value (if s > n/2, use n - s)
 * This ensures a canonical signature
 */
export function normalizeS(s: bigint): bigint {
  const n = p256.CURVE.n
  const halfN = n / 2n
  return s > halfN ? n - s : s
}

/**
 * Recover public key candidates from WebAuthn assertion signature
 * Returns array of candidate public keys in uncompressed format (0x04 || x || y)
 */
export function recoverPublicKeys(params: {
  signature: string // base64url DER signature
  authenticatorData: string // base64url
  clientDataJSON: string // base64url
}): Hex[] {
  // Decode inputs
  const sigBytes = base64UrlToBytes(params.signature)
  const authData = base64UrlToBytes(params.authenticatorData)
  const clientData = base64UrlToBytes(params.clientDataJSON)

  // Parse signature
  const { r, s: rawS } = parseDERSignature(sigBytes)
  const s = normalizeS(rawS)

  // Compute message hash: sha256(authenticatorData || sha256(clientDataJSON))
  const clientDataHash = sha256(clientData)
  const message = new Uint8Array(authData.length + clientDataHash.length)
  message.set(authData, 0)
  message.set(clientDataHash, authData.length)
  const messageHash = sha256(message)

  // Try recovery with both recovery IDs (0 and 1)
  // NOTE: @noble/curves doesn't have built-in recovery, so we implement it manually
  const candidates: Hex[] = []
  const compactSig = signatureToCompact(r, s)
  
  // Try all possible recovery parameters
  for (let recoveryId = 0; recoveryId < 4; recoveryId++) {
    try {
      const publicKey = recoverPublicKeyFromSignature(messageHash, r, s, recoveryId)
      
      if (!publicKey) continue
      
      // Convert to uncompressed format (0x04 || x || y)
      const uncompressed = publicKey.toRawBytes(false) // false = uncompressed
      const hex = '0x' + Array.from(uncompressed).map(b => b.toString(16).padStart(2, '0')).join('') as Hex
      
      // Verify this key produces a valid signature
      const valid = p256.verify(compactSig, messageHash, uncompressed)
      
      if (valid && !candidates.includes(hex)) {
        candidates.push(hex)
      }
    } catch (error) {
      // Recovery failed for this ID, skip
      continue
    }
  }

  return candidates
}

/**
 * Recover public key from ECDSA signature
 * Based on SEC 1: Elliptic Curve Cryptography, section 4.1.6
 */
function recoverPublicKeyFromSignature(
  messageHash: Uint8Array,
  r: bigint,
  s: bigint,
  recoveryId: number
): ReturnType<typeof p256.ProjectivePoint.fromHex> | null {
  const curve = p256.CURVE
  const n = curve.n
  
  // Step 1: Compute x coordinate of R
  // x = r + recoveryId * n (if recoveryId >= 2)
  const x = r + BigInt(recoveryId >= 2 ? 1 : 0) * n
  
  // Check if x is valid
  if (x >= curve.Fp.ORDER) {
    return null
  }
  
  // Step 2: Compute y from x (solve y^2 = x^3 + ax + b)
  // For P-256: y^2 = x^3 - 3x + b
  const xCubed = curve.Fp.mul(curve.Fp.mul(x, x), x)
  const threeX = curve.Fp.mul(x, 3n)
  const ySquared = curve.Fp.add(curve.Fp.sub(xCubed, threeX), curve.Fp.create(curve.b))
  
  // Take square root
  const y = curve.Fp.sqrt(ySquared)
  if (y === undefined) {
    return null
  }
  
  // Choose y based on recovery ID parity
  const yFinal = (recoveryId & 1) === 0 
    ? (y * 2n < curve.Fp.ORDER ? y : curve.Fp.neg(y))
    : (y * 2n >= curve.Fp.ORDER ? y : curve.Fp.neg(y))
  
  // R = (x, y)
  const R = p256.ProjectivePoint.fromAffine({ x, y: yFinal })
  
  // Step 3: Compute e = -hash(m) mod n
  const e = mod(-bytesToBigInt(messageHash), n)
  
  // Step 4: Compute public key: Q = r^-1 * (s*R - e*G)
  const rInv = modInverse(r, n)
  const sR = R.multiply(s)
  const eG = p256.ProjectivePoint.BASE.multiply(e)
  const Q = sR.subtract(eG).multiply(rInv)
  
  return Q
}

/**
 * Modular arithmetic helper
 */
function mod(a: bigint, m: bigint): bigint {
  const result = a % m
  return result < 0n ? result + m : result
}

/**
 * Modular multiplicative inverse using Extended Euclidean Algorithm
 */
function modInverse(a: bigint, m: bigint): bigint {
  a = mod(a, m)
  let [oldR, r] = [a, m]
  let [oldS, s] = [1n, 0n]
  
  while (r !== 0n) {
    const quotient = oldR / r
    ;[oldR, r] = [r, oldR - quotient * r]
    ;[oldS, s] = [s, oldS - quotient * s]
  }
  
  return mod(oldS, m)
}

/**
 * Convert (r, s) to compact 64-byte signature format for @noble/curves
 */
function signatureToCompact(r: bigint, s: bigint): Uint8Array {
  const rBytes = bigIntToBytes(r, 32)
  const sBytes = bigIntToBytes(s, 32)
  const compact = new Uint8Array(64)
  compact.set(rBytes, 0)
  compact.set(sBytes, 32)
  return compact
}

/**
 * Convert bigint to bytes (big-endian, padded to length)
 */
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const hex = value.toString(16).padStart(length * 2, '0')
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Base64url decode to Uint8Array
 */
function base64UrlToBytes(base64url: string): Uint8Array {
  // Convert base64url to base64
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Padded = base64 + padding
  
  // Decode base64
  const binary = atob(base64Padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Find common public key between two sets of candidates
 * Used to disambiguate recovery when both assertions should have the same key
 */
export function findCommonKey(candidates1: Hex[], candidates2: Hex[]): Hex | null {
  for (const key1 of candidates1) {
    for (const key2 of candidates2) {
      if (key1.toLowerCase() === key2.toLowerCase()) {
        return key1
      }
    }
  }
  return null
}
