/**
 * Server-side WebAuthn verification utilities
 * 
 * Implements proper WebAuthn verification according to the spec:
 * - Client data validation (type, challenge, origin)
 * - Authenticator data validation (rpIdHash, flags, signCount)
 * - Signature verification using P-256
 */

import crypto from 'crypto'
import { Hex } from 'viem'

export interface ClientDataJSON {
  type: string
  challenge: string
  origin: string
  crossOrigin?: boolean
}

export interface AuthenticatorData {
  rpIdHash: Buffer
  flags: number
  signCount: number
  attestedCredentialData?: Buffer
}

/**
 * Get allowed origins from environment
 */
export function getAllowedOrigins(rpId: string): string[] {
  const envOrigins = process.env.WALLET_ALLOWED_ORIGINS
  const allowed = envOrigins ? envOrigins.split(',').map(o => o.trim()) : []
  
  // Add default origins
  allowed.push(`https://${rpId}`)
  
  // Add localhost for development
  if (rpId === 'localhost') {
    allowed.push('http://localhost:8089')
    allowed.push('http://localhost:8088')
    allowed.push('http://localhost:3000')
  }
  
  return [...new Set(allowed)] // Deduplicate
}

/**
 * Decode base64url to buffer
 */
export function base64UrlToBuffer(base64url: string): Buffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  return Buffer.from(base64 + padding, 'base64')
}

/**
 * Parse client data JSON
 */
export function parseClientDataJSON(clientDataJSON: string): ClientDataJSON {
  const buffer = base64UrlToBuffer(clientDataJSON)
  return JSON.parse(buffer.toString('utf8'))
}

/**
 * Parse authenticator data
 */
export function parseAuthenticatorData(authenticatorData: string): AuthenticatorData {
  const buffer = base64UrlToBuffer(authenticatorData)
  
  if (buffer.length < 37) {
    throw new Error('Authenticator data too short')
  }
  
  const rpIdHash = buffer.subarray(0, 32)
  const flags = buffer[32]
  const signCount = buffer.readUInt32BE(33)
  
  let attestedCredentialData: Buffer | undefined
  if (flags & 0x40) { // AT flag - attested credential data present
    attestedCredentialData = buffer.subarray(37)
  }
  
  return {
    rpIdHash,
    flags,
    signCount,
    attestedCredentialData,
  }
}

/**
 * Verify client data
 */
export function verifyClientData(
  clientData: ClientDataJSON,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallenge: Hex,
  rpId: string
): { valid: boolean; error?: string } {
  // Check type
  if (clientData.type !== expectedType) {
    return { valid: false, error: `Invalid type: expected ${expectedType}, got ${clientData.type}` }
  }
  
  // Check challenge (base64url encoded)
  const challengeHex = expectedChallenge.startsWith('0x') ? expectedChallenge.slice(2) : expectedChallenge
  const expectedChallengeBase64 = Buffer.from(challengeHex, 'hex').toString('base64url')
  if (clientData.challenge !== expectedChallengeBase64) {
    return { valid: false, error: 'Challenge mismatch' }
  }
  
  // Check origin
  const allowedOrigins = getAllowedOrigins(rpId)
  if (!allowedOrigins.includes(clientData.origin)) {
    return { valid: false, error: `Origin ${clientData.origin} not in allowed list: ${allowedOrigins.join(', ')}` }
  }
  
  return { valid: true }
}

/**
 * Verify authenticator data
 */
export function verifyAuthenticatorData(
  authData: AuthenticatorData,
  rpId: string,
  storedSignCount: number
): { valid: boolean; error?: string } {
  // Check rpIdHash
  const expectedRpIdHash = crypto.createHash('sha256').update(rpId).digest()
  if (!authData.rpIdHash.equals(expectedRpIdHash)) {
    return { valid: false, error: 'RP ID hash mismatch' }
  }
  
  // Check UP (User Present) flag
  if (!(authData.flags & 0x01)) {
    return { valid: false, error: 'User present flag not set' }
  }
  
  // Check sign count (skip if either is 0, as many authenticators don't increment)
  if (storedSignCount > 0 && authData.signCount > 0) {
    if (authData.signCount <= storedSignCount) {
      return { valid: false, error: `Sign count regression: stored=${storedSignCount}, received=${authData.signCount}` }
    }
  }
  
  return { valid: true }
}

/**
 * Parse DER-encoded ECDSA signature to raw r||s format
 */
export function parseDERSignature(derSig: Buffer): { r: Buffer; s: Buffer } {
  if (derSig[0] !== 0x30) {
    throw new Error('Invalid DER signature: missing sequence tag')
  }
  
  let offset = 2 // Skip sequence tag and length
  
  // Parse r
  if (derSig[offset] !== 0x02) {
    throw new Error('Invalid DER signature: missing integer tag for r')
  }
  offset++
  const rLength = derSig[offset]
  offset++
  let r = derSig.subarray(offset, offset + rLength)
  offset += rLength
  
  // Parse s
  if (derSig[offset] !== 0x02) {
    throw new Error('Invalid DER signature: missing integer tag for s')
  }
  offset++
  const sLength = derSig[offset]
  offset++
  let s = derSig.subarray(offset, offset + sLength)
  
  // Remove leading zeros
  while (r[0] === 0 && r.length > 32) r = r.subarray(1)
  while (s[0] === 0 && s.length > 32) s = s.subarray(1)
  
  // Pad to 32 bytes if needed
  if (r.length < 32) {
    const padded = Buffer.alloc(32)
    r.copy(padded, 32 - r.length)
    r = padded
  }
  if (s.length < 32) {
    const padded = Buffer.alloc(32)
    s.copy(padded, 32 - s.length)
    s = padded
  }
  
  return { r, s }
}

/**
 * Verify ES256 signature
 */
export function verifySignature(
  publicKey: Hex,
  signature: string,
  authenticatorData: string,
  clientDataJSON: string
): boolean {
  try {
    // Parse signature (DER format from WebAuthn)
    const sigBuffer = base64UrlToBuffer(signature)
    
    // Build signed data: authenticatorData || sha256(clientDataJSON)
    const authDataBuffer = base64UrlToBuffer(authenticatorData)
    const clientDataBuffer = base64UrlToBuffer(clientDataJSON)
    const clientDataHash = crypto.createHash('sha256').update(clientDataBuffer).digest()
    const signedData = Buffer.concat([authDataBuffer, clientDataHash])
    
    // Extract x and y from public key (0x04 || x || y format)
    const pkHex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey
    if (pkHex.length !== 130 || !pkHex.startsWith('04')) {
      throw new Error('Invalid public key format')
    }
    
    const x = Buffer.from(pkHex.slice(2, 66), 'hex')
    const y = Buffer.from(pkHex.slice(66, 130), 'hex')
    
    // Create P-256 public key
    const keyObject = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: x.toString('base64url'),
        y: y.toString('base64url'),
      },
      format: 'jwk',
    })
    
    // Verify signature (DER format is what crypto.verify expects)
    const verify = crypto.createVerify('SHA256')
    verify.update(signedData)
    verify.end()
    
    return verify.verify(keyObject, sigBuffer)
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

/**
 * Extract public key from attestation object
 */
export function extractPublicKeyFromAttestation(attestationObject: string): Hex {
  const buffer = base64UrlToBuffer(attestationObject)
  const parsed = parseCBOR(buffer)
  
  if (!parsed.authData) {
    throw new Error('No authData in attestation object')
  }
  
  const authData = Buffer.from(parsed.authData)
  if (authData.length < 37) {
    throw new Error('AuthData too short')
  }
  
  const flags = authData[32]
  if (!(flags & 0x40)) {
    throw new Error('No attested credential data')
  }
  
  let offset = 37 // rpIdHash(32) + flags(1) + signCount(4)
  offset += 16 // AAGUID
  
  const credentialIdLength = (authData[offset] << 8) | authData[offset + 1]
  offset += 2 + credentialIdLength
  
  // Parse COSE key
  const publicKeyCBOR = parseCBOR(authData.subarray(offset))
  
  // Extract x and y coordinates (COSE keys use negative integers for map keys)
  const x = Buffer.from(publicKeyCBOR[-2])
  const y = Buffer.from(publicKeyCBOR[-3])
  
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error('Invalid COSE public key')
  }
  
  // Return 0x04 || x || y format
  return `0x04${x.toString('hex')}${y.toString('hex')}` as Hex
}

/**
 * Simple CBOR parser for WebAuthn data
 */
function parseCBOR(bytes: Buffer): any {
  let offset = 0
  
  const readMajorType = () => {
    if (offset >= bytes.length) throw new Error('Unexpected end of CBOR')
    const first = bytes[offset++]
    return { majorType: (first >> 5) & 0x07, additionalInfo: first & 0x1f }
  }
  
  const readUint = (ai: number): number => {
    if (ai < 24) return ai
    if (ai === 24) return bytes[offset++]
    if (ai === 25) {
      const val = (bytes[offset] << 8) | bytes[offset + 1]
      offset += 2
      return val
    }
    if (ai === 26) {
      const val = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
      offset += 4
      return val
    }
    throw new Error('Unsupported integer encoding')
  }
  
  const parseValue = (): any => {
    const { majorType, additionalInfo } = readMajorType()
    
    switch (majorType) {
      case 0: // unsigned integer
        return readUint(additionalInfo)
      case 1: // negative integer
        return -1 - readUint(additionalInfo)
      case 2: // byte string
        const byteLength = readUint(additionalInfo)
        const byteResult = bytes.subarray(offset, offset + byteLength)
        offset += byteLength
        return byteResult
      case 3: // text string
        const textLength = readUint(additionalInfo)
        const textResult = bytes.subarray(offset, offset + textLength).toString('utf8')
        offset += textLength
        return textResult
      case 4: // array
        const arrayLength = readUint(additionalInfo)
        const arrayResult = []
        for (let i = 0; i < arrayLength; i++) {
          arrayResult.push(parseValue())
        }
        return arrayResult
      case 5: // map
        const mapLength = readUint(additionalInfo)
        const mapResult: any = {}
        for (let i = 0; i < mapLength; i++) {
          const key = parseValue()
          const value = parseValue()
          mapResult[key] = value
        }
        return mapResult
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`)
    }
  }
  
  return parseValue()
}
