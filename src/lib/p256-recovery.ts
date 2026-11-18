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
 * 1. Parse DER signature using @noble/curves
 * 2. Normalize s if needed
 * 3. Compute message hash
 * 4. Try recovery bit 0 and 1 to get candidate keys
 * 5. Verify signature with each candidate
 * 6. Return valid public key(s)
 */

import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha256'
import { Hex } from 'viem'

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

  // Parse DER signature using @noble/curves
  let sig
  try {
    sig = p256.Signature.fromDER(sigBytes)
  } catch (error) {
    throw new Error(`Failed to parse DER signature: ${error}`)
  }

  // Normalize s if needed (ensure canonical low-s signature)
  if (sig.hasHighS()) {
    sig = sig.normalizeS()
  }

  // Compute message hash: sha256(authenticatorData || sha256(clientDataJSON))
  const clientDataHash = sha256(clientData)
  const message = new Uint8Array(authData.length + clientDataHash.length)
  message.set(authData, 0)
  message.set(clientDataHash, authData.length)
  const messageHash = sha256(message)

  // Try recovery with both recovery bits (0 and 1)
  const candidates: Hex[] = []
  
  for (let recoveryBit = 0; recoveryBit <= 1; recoveryBit++) {
    try {
      // Add recovery bit and recover public key
      const sigWithRecovery = sig.addRecoveryBit(recoveryBit)
      const publicKeyPoint = sigWithRecovery.recoverPublicKey(messageHash)
      
      // Convert to uncompressed format (0x04 || x || y)
      const uncompressed = publicKeyPoint.toRawBytes(false) // false = uncompressed
      const hex = '0x' + Array.from(uncompressed).map(b => b.toString(16).padStart(2, '0')).join('') as Hex
      
      // Verify this key produces a valid signature
      // p256.verify expects compact signature (64 bytes) and Uint8Array publicKey
      const valid = p256.verify(sig.toCompactRawBytes(), messageHash, uncompressed)
      
      if (valid && !candidates.includes(hex)) {
        candidates.push(hex)
      }
    } catch (error) {
      // Recovery failed for this bit, skip
      continue
    }
  }

  return candidates
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
 * Base64url encode from Uint8Array
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
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
