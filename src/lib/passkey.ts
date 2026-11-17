/**
 * OpenPasskey PasskeyService - WebAuthn passkey management
 * Follows EXACT openpasskey.com architecture v2.1
 * 
 * Key Requirements:
 * - rpId = "openpasskey.com" for prod (works on openpasskey.com + *.openpasskey.com)
 * - rpId = "opkdev.com" for dev (works on opkdev.com + *.opkdev.com)
 * - Passkeys MUST NOT cross between environments
 * - P-256 ECDSA keys ONLY (Coinbase compatibility)
 * - Recovery API integration for cross-device sync
 */

export interface PasskeyCredential {
  credentialId: string
  publicKey: {
    x: string // 32 bytes hex (big-endian)
    y: string // 32 bytes hex (big-endian)
  }
  rpId?: string // Track which rpId this credential belongs to
}

// Internal interface for WebAuthn operations
export interface WebAuthnCredential {
  credentialId: string
  publicKeyJwk: JsonWebKey
  rpId: string
}

export class PasskeyService {
  constructor(private rpId: string) {
    console.log('🔐 PasskeyService initialized with rpId:', rpId)
  }

  /**
   * A) Passkey Provisioning (client-only) - EXACT openpasskey.com flow
   * 
   * 1. navigator.credentials.create() with rpId = "openpasskey.com"
   * 2. Extract P-256 (x, y) coordinates (32B each, big-endian)
   * 3. Store locally with credentialId
   * 4. Upsert to Recovery API for cross-device sync
   */
  async create(userInfo?: {
    id?: string
    name?: string
    displayName?: string
  }): Promise<PasskeyCredential> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported in this browser')
    }
    
    // Check if WebAuthn is available
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    if (!available) {
      throw new Error('Platform authenticator is not available')
    }

    const challenge = new Uint8Array(32)
    crypto.getRandomValues(challenge)
    
    // Generate unique user ID for this passkey creation
    const userId = userInfo?.id || crypto.randomUUID()
    
    console.log('🔐 Creating passkey with:', {
      rpId: this.rpId,
      userId: userId.slice(0, 8) + '...',
      userName: userInfo?.name || `user-${userId.slice(0, 8)}@${this.rpId}`
    })

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          id: this.rpId,
          name: 'OpenPasskey Wallet',
        },
        user: {
          id: new TextEncoder().encode(userId),
          name: userInfo?.name || `user-${userId.slice(0, 8)}@${this.rpId}`,
          displayName: userInfo?.displayName || 'Passkey Wallet User',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256 (P-256/secp256r1) - REQUIRED for Coinbase compatibility
          // Note: Only P-256 for openpasskey.com compatibility - no fallbacks
        ],
        authenticatorSelection: {
          // Omit authenticatorAttachment so MS Authenticator / iCloud / Google can be used
          userVerification: 'required',
          residentKey: 'preferred',
          requireResidentKey: false,
        },
        excludeCredentials: [], // Allow creating multiple passkeys
        timeout: 60000,
      },
    }) as PublicKeyCredential

    if (!credential || !credential.response) {
      throw new Error('Failed to create passkey')
    }

    const response = credential.response as AuthenticatorAttestationResponse
    const publicKey = await this.extractPublicKey(response)
    const credentialId = this.bufferToHex(new Uint8Array(credential.rawId))

    const passkeyCredential: PasskeyCredential = {
      credentialId,
      publicKey,
      rpId: this.rpId,
    }

    console.log('✅ Passkey created successfully:', {
      credentialId: credentialId.slice(0, 16) + '...',
      publicKey: {
        x: publicKey.x.slice(0, 16) + '...',
        y: publicKey.y.slice(0, 16) + '...'
      },
      rpId: this.rpId
    })

    // Store locally for immediate use
    this.storePasskeyLocally(passkeyCredential)

    return passkeyCredential
  }

  /**
   * F) Connection on New Device (Recovery path) - EXACT openpasskey.com flow
   * 
   * 1. navigator.credentials.get() → obtain credentialId for rpId
   * 2. If local (x‖y) missing, fetch from Recovery API
   * 3. All services MUST check Recovery API before failing
   */
  async get(conditional: boolean = false): Promise<PasskeyCredential | null> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported in this browser')
    }

    try {
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      
      const getOptions: CredentialRequestOptions = {
        publicKey: {
          challenge,
          rpId: this.rpId,
          userVerification: 'required',
          timeout: 60000,
        },
      }
      
      // Enable conditional UI if supported and requested
      if (conditional && 'PublicKeyCredential' in window) {
        const conditionalSupport = await PublicKeyCredential.isConditionalMediationAvailable?.()
        if (conditionalSupport) {
          (getOptions as any).mediation = 'conditional'
        }
      }

      const assertion = await navigator.credentials.get(getOptions) as PublicKeyCredential

      if (!assertion || !assertion.response) {
        return null
      }

      const credentialId = this.bufferToHex(new Uint8Array(assertion.rawId))
      
      // Check if we have the public key locally
      const storedCredential = this.getStoredPasskey(credentialId)
      
      if (storedCredential && storedCredential.publicKey.x && storedCredential.publicKey.y) {
        console.log('✅ Found complete passkey locally')
        return storedCredential
      }

      console.log('⚠️ Local public key missing - will need Recovery API lookup')
      
      // Return partial credential - caller must fetch from Recovery API
      return {
        credentialId,
        publicKey: { x: '', y: '' }, // To be filled via Recovery API
        rpId: this.rpId,
      }
    } catch (error) {
      console.error('Failed to get passkey:', error)
      return null
    }
  }

  /**
   * Authenticate with a specific credential ID
   * Used for connecting existing passkeys to wallet
   */
  async authenticate(credentialId: string, allowCredentials?: PublicKeyCredentialDescriptor[]): Promise<PasskeyCredential | null> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported in this browser')
    }

    try {
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: this.rpId,
          allowCredentials: allowCredentials || [{
            type: 'public-key',
            id: this.hexToBuffer(credentialId),
            transports: ['internal', 'hybrid'], // Support platform and cross-device
          }],
          userVerification: 'required',
          timeout: 60000,
        },
      }) as PublicKeyCredential

      if (!assertion || !assertion.response) {
        return null
      }

      // Check if we have the public key locally first
      const storedCredential = this.getStoredPasskey(credentialId)
      
      if (storedCredential && storedCredential.publicKey.x && storedCredential.publicKey.y) {
        console.log('✅ Found complete passkey locally for credentialId')
        return storedCredential
      }

      console.log('⚠️ Local public key missing for credentialId - caller should use Recovery API')

      // Return partial credential - caller must fetch from Recovery API
      return {
        credentialId,
        publicKey: { x: '', y: '' }, // To be filled via Recovery API
        rpId: this.rpId,
      }
    } catch (error) {
      console.error('Failed to authenticate passkey:', error)
      return null
    }
  }

  /**
   * Sign a message with passkey
   */
  async sign(credentialId: string, message: Uint8Array): Promise<{
    r: string
    s: string
    authData: string
    clientDataJSON: string
  }> {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn is not supported in this browser')
    }

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: message,
        rpId: this.rpId,
        allowCredentials: [{
          type: 'public-key',
          id: this.hexToBuffer(credentialId),
        }],
        userVerification: 'required',
        timeout: 60000,
      },
    }) as PublicKeyCredential

    if (!assertion || !assertion.response) {
      throw new Error('Failed to sign with passkey')
    }

    const response = assertion.response as AuthenticatorAssertionResponse
    const signature = new Uint8Array(response.signature)
    
    // Parse DER-encoded signature to extract r and s
    const { r, s } = this.parseDERSignature(signature)

    return {
      r: this.bufferToHex(r),
      s: this.bufferToHex(s),
      authData: this.bufferToHex(new Uint8Array(response.authenticatorData)),
      clientDataJSON: this.bufferToHex(new TextEncoder().encode(
        new TextDecoder().decode(response.clientDataJSON)
      )),
    }
  }

  /**
   * Extract P-256 public key from attestation response
   */
  private async extractPublicKey(response: AuthenticatorAttestationResponse): Promise<{
    x: string
    y: string
  }> {
    // Import the public key using Web Crypto API
    const publicKeyJwk = await this.extractJwkFromAttestation(response)
    
    if (publicKeyJwk.kty !== 'EC' || publicKeyJwk.crv !== 'P-256') {
      throw new Error('Only P-256 ECDSA keys are supported')
    }

    if (!publicKeyJwk.x || !publicKeyJwk.y) {
      throw new Error('Invalid public key coordinates')
    }

    // Decode base64url coordinates to hex
    const x = this.base64UrlToHex(publicKeyJwk.x)
    const y = this.base64UrlToHex(publicKeyJwk.y)

    return { x, y }
  }

  /**
   * Extract JWK from attestation response using Web Crypto API
   */
  private async extractJwkFromAttestation(response: AuthenticatorAttestationResponse): Promise<JsonWebKey> {
    // Parse CBOR attestation object to find the credential public key
    const attestationObject = new Uint8Array(response.attestationObject)
    
    // Simple CBOR parsing for attestation object
    const parsed = this.parseCBOR(attestationObject)
    
    if (!parsed.authData) {
      throw new Error('No authData found in attestation object')
    }

    const authData = new Uint8Array(parsed.authData)
    
    // AuthData structure: rpIdHash(32) + flags(1) + signCount(4) + attestedCredentialData
    if (authData.length < 37) {
      throw new Error('AuthData too short')
    }

    const flags = authData[32]
    const attestedCredentialDataPresent = (flags & 0x40) !== 0

    if (!attestedCredentialDataPresent) {
      throw new Error('No attested credential data present')
    }

    // Skip to credential public key (after rpIdHash + flags + signCount + AAGUID + credentialIdLength + credentialId)
    let offset = 37 // rpIdHash(32) + flags(1) + signCount(4)
    offset += 16 // AAGUID
    
    const credentialIdLength = (authData[offset] << 8) | authData[offset + 1]
    offset += 2 + credentialIdLength // credentialIdLength(2) + credentialId

    // Parse the CBOR-encoded credential public key
    const publicKeyBytes = authData.slice(offset)
    const publicKeyCbor = this.parseCBOR(publicKeyBytes)

    // Extract coordinates from COSE key format
    if (publicKeyCbor[1] !== 2 || publicKeyCbor[3] !== -7) { // kty: EC, alg: ES256
      throw new Error('Unsupported public key type or algorithm')
    }

    const x = this.bufferToBase64Url(new Uint8Array(publicKeyCbor[-2]))
    const y = this.bufferToBase64Url(new Uint8Array(publicKeyCbor[-3]))

    return {
      kty: 'EC',
      crv: 'P-256',
      x: x,
      y: y,
    }
  }

  /**
   * Parse DER-encoded ECDSA signature
   */
  private parseDERSignature(signature: Uint8Array): { r: Uint8Array; s: Uint8Array } {
    if (signature.length < 6) {
      throw new Error('DER signature too short')
    }

    let offset = 0
    
    // Verify sequence tag (0x30)
    if (signature[offset] !== 0x30) {
      throw new Error('Invalid DER signature: missing sequence tag')
    }
    offset += 1
    
    // Skip sequence length
    offset += 1
    
    // Parse r component
    if (signature[offset] !== 0x02) {
      throw new Error('Invalid DER signature: missing integer tag for r')
    }
    offset += 1
    
    const rLength = signature[offset]
    offset += 1
    let r = signature.slice(offset, offset + rLength)
    offset += rLength
    
    // Parse s component  
    if (signature[offset] !== 0x02) {
      throw new Error('Invalid DER signature: missing integer tag for s')
    }
    offset += 1
    
    const sLength = signature[offset]
    offset += 1
    let s = signature.slice(offset, offset + sLength)
    
    // Remove leading zero bytes (DER padding) but ensure we have valid lengths
    r = this.removeLeadingZeros(r)
    s = this.removeLeadingZeros(s)
    
    // Ensure r and s are not empty
    if (r.length === 0) r = new Uint8Array([0])
    if (s.length === 0) s = new Uint8Array([0])
    
    return { r, s }
  }

  /**
   * Remove leading zero bytes from signature component
   */
  private removeLeadingZeros(bytes: Uint8Array): Uint8Array {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) {
      start++
    }
    return bytes.slice(start)
  }

  private bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private hexToBuffer(hex: string): Uint8Array {
    const bytes = hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
    return new Uint8Array(bytes)
  }

  /**
   * Simple CBOR parser for WebAuthn attestation objects
   */
  private parseCBOR(bytes: Uint8Array): any {
    let offset = 0
    
    const readMajorType = () => {
      if (offset >= bytes.length) throw new Error('Unexpected end of CBOR data')
      const firstByte = bytes[offset++]
      const majorType = (firstByte >> 5) & 0x07
      const additionalInfo = firstByte & 0x1f
      return { majorType, additionalInfo }
    }

    const readUint = (additionalInfo: number) => {
      if (additionalInfo < 24) {
        return additionalInfo
      } else if (additionalInfo === 24) {
        return bytes[offset++]
      } else if (additionalInfo === 25) {
        const value = (bytes[offset] << 8) | bytes[offset + 1]
        offset += 2
        return value
      } else if (additionalInfo === 26) {
        const value = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | 
                     (bytes[offset + 2] << 8) | bytes[offset + 3]
        offset += 4
        return value
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
          const byteResult = bytes.slice(offset, offset + byteLength)
          offset += byteLength
          return byteResult
        
        case 3: // text string
          const textLength = readUint(additionalInfo)
          const textResult = new TextDecoder().decode(bytes.slice(offset, offset + textLength))
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

  /**
   * Convert base64url to hex
   */
  private base64UrlToHex(base64url: string): string {
    // Add padding if needed
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + padding
    
    // Decode base64 to bytes
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    
    return this.bufferToHex(bytes)
  }

  /**
   * Convert buffer to base64url
   */
  private bufferToBase64Url(buffer: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < buffer.byteLength; i++) {
      binary += String.fromCharCode(buffer[i])
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  /**
   * Store passkey locally for immediate access
   */
  private storePasskeyLocally(credential: PasskeyCredential): void {
    try {
      const key = `openpasskey_${credential.credentialId}`
      localStorage.setItem(key, JSON.stringify(credential))
      console.log('🔐 Stored passkey locally:', credential.credentialId.slice(0, 16) + '...')
    } catch (error) {
      console.warn('Failed to store passkey locally:', error)
    }
  }

  /**
   * Retrieve passkey from local storage
   */
  private getStoredPasskey(credentialId: string): PasskeyCredential | null {
    try {
      const key = `openpasskey_${credentialId}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const credential: PasskeyCredential = JSON.parse(stored)
        // Validate the credential has required data
        if (credential.publicKey?.x && credential.publicKey?.y) {
          return credential
        }
      }
    } catch (error) {
      console.warn('Failed to retrieve stored passkey:', error)
    }
    return null
  }

  /**
   * Get all stored passkey credential IDs for current rpId
   */
  getStoredPasskeyIds(): string[] {
    try {
      const credentialIds: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('openpasskey_')) {
          const credentialId = key.replace('openpasskey_', '')
          const stored = this.getStoredPasskey(credentialId)
          // Only return credentials for current rpId
          if (stored && (!stored.rpId || stored.rpId === this.rpId)) {
            credentialIds.push(credentialId)
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
   * Clear stored passkey data (for logout/reset)
   */
  clearStoredPasskey(credentialId: string): void {
    try {
      const key = `openpasskey_${credentialId}`
      localStorage.removeItem(key)
      console.log('🗑️ Cleared stored passkey:', credentialId.slice(0, 16) + '...')
    } catch (error) {
      console.warn('Failed to clear stored passkey:', error)
    }
  }

  /**
   * Update stored passkey with complete public key data (from Recovery API)
   */
  updateStoredPasskey(credentialId: string, publicKey: { x: string; y: string }): void {
    try {
      let credential = this.getStoredPasskey(credentialId)
      if (!credential) {
        credential = {
          credentialId,
          publicKey: { x: '', y: '' },
          rpId: this.rpId,
        }
      }
      
      credential.publicKey = publicKey
      this.storePasskeyLocally(credential)
      console.log('✅ Updated stored passkey with public key data')
    } catch (error) {
      console.error('Failed to update stored passkey:', error)
    }
  }
}
