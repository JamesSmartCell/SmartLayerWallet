/**
 * Real PasskeyService Implementation
 * Based on stephancill/open-browser-wallet
 * 
 * Uses webauthn-p256 library and follows exact patterns from working code
 */

import { create, get, type CredentialCreationOptionsJSON, type CredentialRequestOptionsJSON } from '@github/webauthn-json'
import { Hex } from 'viem'

export interface PasskeyCredential {
  id: string                    // credentialId
  publicKey: Hex               // P-256 public key as hex 
  rpId: string
  username?: string
}

export interface StoredPasskey {
  credentialId: string
  publicKey: Hex
  rpId: string
  username?: string
  createdAt: Date
  updatedAt: Date
}

export class PasskeyService {
  constructor(private rpId: string = 'localhost') {
    console.log('🔐 PasskeyService initialized with rpId:', rpId)
  }

  /**
   * Create a new passkey credential - EXACT pattern from real implementation
   */
  async create(options: {
    username: string
    challenge: Hex
  }): Promise<{
    credential: PasskeyCredential
    attestationObject: string
    clientDataJSON: string
  }> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported')
    }

    const creationOptions: CredentialCreationOptionsJSON = {
      publicKey: {
        rp: {
          id: this.rpId,
          name: 'SmartLayerWallet',
        },
        user: {
          id: options.username, // Use username as user ID like real implementation
          name: options.username,
          displayName: options.username,
        },
        challenge: options.challenge,
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256 (P-256) - REQUIRED
        ],
        authenticatorSelection: {
          // Omit authenticatorAttachment so iCloud / Google / Microsoft Authenticator
          // password managers can offer passkeys (not just built-in platform biometrics).
          userVerification: 'required',
          // Use 'required' for true discoverable credentials (client-side discoverable)
          // This enables login without credentialId hint (essential for Safari ITP resistance)
          residentKey: 'required',
          requireResidentKey: true,
        },
        attestation: 'direct',
        timeout: 60000,
      },
    }

    console.log('🔐 Creating passkey with options:', {
      rpId: this.rpId,
      username: options.username,
      challenge: options.challenge.slice(0, 20) + '...'
    })

    const credential = await create(creationOptions)

    if (!credential || !credential.response) {
      throw new Error('Failed to create passkey credential')
    }

    // Extract attestation data (base64url strings from webauthn-json)
    const attestationObject = credential.response.attestationObject as unknown as string
    const clientDataJSON = credential.response.clientDataJSON as unknown as string

    if (!attestationObject || !clientDataJSON) {
      throw new Error('Missing attestation data from WebAuthn response')
    }

    // Extract public key from attestation response
    const publicKey = this.extractPublicKeyFromAttestation(credential.response)

    const passkeyCredential: PasskeyCredential = {
      id: credential.id,
      publicKey,
      rpId: this.rpId,
      username: options.username,
    }

    // Store locally
    this.storePasskeyLocally(passkeyCredential)

    console.log('✅ Passkey created successfully:', {
      id: credential.id.slice(0, 16) + '...',
      rpId: this.rpId,
      username: options.username
    })

    return {
      credential: passkeyCredential,
      attestationObject,
      clientDataJSON,
    }
  }

  /**
   * Backend-integrated registration using options from server
   */
  async createWithBackendOptions(options: any, username: string): Promise<{ credential: PasskeyCredential; attestation: any }> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported')
    }

    const creation = await create({ publicKey: options } as CredentialCreationOptionsJSON)
    if (!creation || !creation.response?.attestationObject) {
      throw new Error('Failed to create passkey (no attestation)')
    }

    // attestationObject is base64url (webauthn-json JSON form)
    const attestationBytes = this.base64UrlToBytes(creation.response.attestationObject as unknown as string)
    const publicKey = this.extractPublicKeyFromAttestation({ attestationObject: attestationBytes.buffer })

    const result: PasskeyCredential = {
      id: creation.id,
      publicKey,
      rpId: this.rpId,
      username,
    }

    this.storePasskeyLocally(result)
    return { credential: result, attestation: creation }
  }

  /**
   * Backend-integrated authentication using options from server
   */
  async authenticateWithBackendOptions(options: any): Promise<{ assertion: any }> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported')
    }
    const assertion = await get({ publicKey: options } as CredentialRequestOptionsJSON)
    if (!assertion) {
      throw new Error('Authentication failed')
    }
    return { assertion }
  }

  /**
   * Authenticate with existing passkey - EXACT pattern from real implementation
   */
  async authenticate(options: {
    challenge: Hex
    credentialId?: string
  }): Promise<{
    credential: PasskeyCredential | null
    signature: any
    webauthn: any
  }> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported')
    }

    // Build publicKey options, conditionally including allowCredentials only when provided
    const publicKey: any = {
      challenge: options.challenge,
      rpId: this.rpId,
      userVerification: 'required',
      timeout: 60000,
    }

    if (options.credentialId) {
      publicKey.allowCredentials = [{
        type: 'public-key',
        id: options.credentialId,
        transports: ['internal', 'hybrid'],
      }]
    }

    const requestOptions: CredentialRequestOptionsJSON = { publicKey }

    console.log('🔐 Authenticating passkey with options:', {
      rpId: this.rpId,
      challenge: options.challenge.slice(0, 20) + '...',
      hasCredentialId: !!options.credentialId
    })

    const assertion = await get(requestOptions)

    if (!assertion || !assertion.response) {
      throw new Error('Authentication failed')
    }

    // CHANGED: Always return partial credential without public key
    // Caller MUST fetch public key from server (server is source of truth)
    // localStorage is only used for optional migration path
    const credential: PasskeyCredential = {
      id: assertion.id,
      publicKey: '0x' as Hex, // Empty - MUST be filled from server API
      rpId: this.rpId,
    }

    console.log('✅ Passkey authentication successful (credential ID only):', {
      id: assertion.id.slice(0, 16) + '...',
      note: 'Public key must be fetched from server'
    })

    return {
      credential,
      signature: assertion.response.signature,
      webauthn: {
        authenticatorData: assertion.response.authenticatorData,
        clientDataJSON: assertion.response.clientDataJSON,
        userHandle: assertion.response.userHandle, // May be null/undefined
      },
    }
  }

  /**
   * Extract P-256 public key from WebAuthn attestation - simplified version
   */
  private extractPublicKeyFromAttestation(response: any): Hex {
    // Parse CBOR from attestationObject to extract COSE public key, then build uncompressed 0x04||x||y
    const attestationObject: ArrayBuffer = response.attestationObject
    const attBytes = new Uint8Array(attestationObject)

    const parsed = this.parseCBOR(attBytes)
    if (!parsed.authData) {
      throw new Error('No authData in attestation')
    }

    const authData = new Uint8Array(parsed.authData)
    if (authData.length < 37) {
      throw new Error('authData too short')
    }

    let offset = 37 // rpIdHash(32) + flags(1) + signCount(4)
    offset += 16 // AAGUID

    const credentialIdLength = (authData[offset] << 8) | authData[offset + 1]
    offset += 2 + credentialIdLength // skip credentialId

    const publicKeyCbor = this.parseCBOR(authData.slice(offset))

    // COSE Key must be EC2 with alg ES256 and curve P-256; x at key -2, y at key -3
    const xBytes = new Uint8Array(publicKeyCbor[-2])
    const yBytes = new Uint8Array(publicKeyCbor[-3])
    if (!xBytes || !yBytes) {
      throw new Error('Invalid COSE key: missing x or y')
    }

    const xHex = this.bufferToHex(xBytes).padStart(64, '0')
    const yHex = this.bufferToHex(yBytes).padStart(64, '0')

    // Return uncompressed point 0x04||x||y as Hex
    return (`0x04${xHex}${yHex}`) as Hex
  }

  // Minimal CBOR parser (same approach as passkey.ts)
  private parseCBOR(bytes: Uint8Array): any {
    let offset = 0

    const readMajorType = () => {
      if (offset >= bytes.length) throw new Error('Unexpected end of CBOR data')
      const first = bytes[offset++]
      return { majorType: (first >> 5) & 0x07, additionalInfo: first & 0x1f }
    }

    const readUint = (ai: number) => {
      if (ai < 24) return ai
      if (ai === 24) return bytes[offset++]
      if (ai === 25) { const v = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; return v }
      if (ai === 26) { const v = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]; offset += 4; return v }
      throw new Error('Unsupported integer encoding')
    }

    const parseValue = (): any => {
      const { majorType, additionalInfo } = readMajorType()
      switch (majorType) {
        case 0: return readUint(additionalInfo)
        case 1: return -1 - readUint(additionalInfo)
        case 2: {
          const len = readUint(additionalInfo)
          const out = bytes.slice(offset, offset + len)
          offset += len
          return out
        }
        case 3: {
          const len = readUint(additionalInfo)
          const out = new TextDecoder().decode(bytes.slice(offset, offset + len))
          offset += len
          return out
        }
        case 4: {
          const len = readUint(additionalInfo)
          const arr = [] as any[]
          for (let i = 0; i < len; i++) arr.push(parseValue())
          return arr
        }
        case 5: {
          const len = readUint(additionalInfo)
          const map: any = {}
          for (let i = 0; i < len; i++) {
            const k = parseValue()
            const v = parseValue()
            map[k] = v
          }
          return map
        }
        default:
          throw new Error(`Unsupported CBOR major type: ${majorType}`)
      }
    }

    return parseValue()
  }

  private bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private base64UrlToBytes(base64url: string): Uint8Array {
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
    const base64 = (base64url.replace(/-/g, '+').replace(/_/g, '/')) + padding
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  /**
   * Store passkey locally
   */
  private storePasskeyLocally(credential: PasskeyCredential): void {
    try {
      const key = `passkey_${credential.id}`
      const stored: StoredPasskey = {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        rpId: credential.rpId,
        username: credential.username,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      localStorage.setItem(key, JSON.stringify(stored))
      console.log('💾 Stored passkey locally:', credential.id.slice(0, 16) + '...')
    } catch (error) {
      console.warn('Failed to store passkey locally:', error)
    }
  }

  /**
   * Get stored passkey
   */
  private getStoredPasskey(credentialId: string): PasskeyCredential | null {
    try {
      const key = `passkey_${credentialId}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const data: StoredPasskey = JSON.parse(stored)
        return {
          id: data.credentialId,
          publicKey: data.publicKey,
          rpId: data.rpId,
          username: data.username,
        }
      }
    } catch (error) {
      console.warn('Failed to get stored passkey:', error)
    }
    return null
  }

  /**
   * Get all stored passkey IDs for current rpId
   */
  getStoredPasskeyIds(): string[] {
    try {
      const credentialIds: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('passkey_')) {
          const stored = this.getStoredPasskey(key.replace('passkey_', ''))
          if (stored && stored.rpId === this.rpId) {
            credentialIds.push(stored.id)
          }
        }
      }
      return credentialIds
    } catch (error) {
      console.warn('Failed to get stored passkey IDs:', error)
      return []
    }
  }

  /**
   * Update stored passkey public key
   */
  updateStoredPasskey(credentialId: string, publicKey: Hex): void {
    try {
      const key = `passkey_${credentialId}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const data: StoredPasskey = JSON.parse(stored)
        data.publicKey = publicKey
        data.updatedAt = new Date()
        localStorage.setItem(key, JSON.stringify(data))
        console.log('📝 Updated stored passkey:', credentialId.slice(0, 16) + '...')
      }
    } catch (error) {
      console.warn('Failed to update stored passkey:', error)
    }
  }

  /**
   * Clear stored passkey
   */
  clearStoredPasskey(credentialId: string): void {
    try {
      const key = `passkey_${credentialId}`
      localStorage.removeItem(key)
      console.log('🗑️ Cleared stored passkey:', credentialId.slice(0, 16) + '...')
    } catch (error) {
      console.warn('Failed to clear stored passkey:', error)
    }
  }

  /**
   * Check if localStorage has passkey data (for migration)
   * Returns stored credential if found, null otherwise
   * ONLY used for migration of old localStorage-only passkeys
   */
  getLocalStoragePasskeyForMigration(credentialId: string): PasskeyCredential | null {
    return this.getStoredPasskey(credentialId)
  }

  /**
   * Generate challenge for WebAuthn operations
   */
  static generateChallenge(): Hex {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return `0x${Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex
  }
}
