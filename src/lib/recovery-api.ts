/**
 * OpenPasskey Recovery API Service
 * Implements the minimal recovery API for credentialId → publicKey(x‖y) sync
 * Based on: open_passkey_serverless_passkey_wallet_architecture_v_2_aug_19_2025.md
 * 
 * Endpoints:
 * - PUT /api/v1/passkeys - Upsert passkey data
 * - GET /api/v1/passkeys/{credentialId} - Fetch passkey data
 */

import { ENV } from './env'

export class PasskeyBackendService {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || ENV.BACKEND_API_BASE || '').replace(/\/$/, '')
    if (!this.baseUrl) {
      console.warn('PasskeyBackendService: BACKEND_API_BASE is empty. Passkey API calls will hit current origin.')
    }
  }

  private async parseJsonResponse<T>(r: Response, url: string): Promise<T> {
    const text = await r.text()
    if (!text || !text.trim()) {
      throw new Error(`Empty response from ${url} (${r.status})`)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      const preview = text.slice(0, 80).replace(/\s+/g, ' ')
      throw new Error(`Invalid JSON from ${url} (${r.status}): ${preview}${text.length > 80 ? '...' : ''}`)
    }
  }

  async getRegistrationChallenge(): Promise<any> {
    const url = `${this.baseUrl}/passkey/registration-challenge`
    const r = await fetch(url)
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Registration challenge failed: ${r.status}`)
    return data
  }

  async verifyRegistrationChallenge(sessionId: string, attestationResponse: any): Promise<any> {
    const url = `${this.baseUrl}/passkey/verify-registration-challenge`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, attestationResponse }),
    })
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Verify registration failed: ${r.status}`)
    return data
  }

  async getAuthChallenge(credentialId?: string): Promise<any> {
    const url = credentialId
      ? `${this.baseUrl}/passkey/build-auth-challenge/${encodeURIComponent(credentialId)}`
      : `${this.baseUrl}/passkey/build-auth-challenge`
    const r = await fetch(url)
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Auth challenge failed: ${r.status}`)
    return data
  }

  async verifyAuthChallenge(sessionId: string, assertionResponse: any): Promise<any> {
    const url = `${this.baseUrl}/passkey/verify-auth-challenge`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, assertionResponse }),
    })
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Verify auth failed: ${r.status}`)
    return data
  }
}

export interface PasskeyRecord {
  credentialId: string
  rpId: string
  xyHex: string // P-256 x‖y coordinates as hex (64 bytes)
}

export interface PasskeyUpsertRequest {
  credentialId: string
  rpId: string
  xyHex: string
}

export interface PasskeyResponse {
  credentialId: string
  rpId: string
  xyHex: string
  updatedAt?: string
}

export class RecoveryApiService {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || ENV.RECOVERY_API_BASE
  }

  /**
   * Upsert passkey data to Recovery API
   * MUST be executed by all surfaces when creating/accessing passkeys
   * (app.openpasskey.com, wallet.openpasskey.com, pass.openpasskey.com, etc.)
   */
  async upsertPasskey(data: PasskeyUpsertRequest): Promise<void> {
    const url = `${this.baseUrl}/api/v1/passkeys`
    
    console.log('Upserting passkey to Recovery API:', {
      credentialId: data.credentialId.slice(0, 16) + '...',
      rpId: data.rpId,
      xyHexLength: data.xyHex.length
    })

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`Recovery API upsert failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      console.log('✅ Successfully upserted passkey to Recovery API')
    } catch (error) {
      console.error('❌ Failed to upsert passkey to Recovery API:', error)
      // Note: Don't throw here - Recovery API is optional for local operation
      // but log the error for debugging
    }
  }

  /**
   * Fetch passkey data from Recovery API
   * Used when local (x‖y) data is missing on new device
   * All services MUST check the Recovery API before failing
   */
  async getPasskey(credentialId: string): Promise<PasskeyResponse | null> {
    const url = `${this.baseUrl}/api/v1/passkeys/${encodeURIComponent(credentialId)}`
    
    console.log('Fetching passkey from Recovery API:', {
      credentialId: credentialId.slice(0, 16) + '...'
    })

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      })

      if (response.status === 404) {
        console.log('⚠️ Passkey not found in Recovery API')
        return null
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`Recovery API fetch failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const data: PasskeyResponse = await response.json()
      
      console.log('✅ Successfully fetched passkey from Recovery API:', {
        credentialId: data.credentialId.slice(0, 16) + '...',
        rpId: data.rpId,
        xyHexLength: data.xyHex?.length || 0
      })

      return data
    } catch (error) {
      console.error('❌ Failed to fetch passkey from Recovery API:', error)
      return null // Return null instead of throwing - let caller handle gracefully
    }
  }

  /**
   * Validate passkey record format
   */
  validatePasskeyRecord(record: Partial<PasskeyRecord>): boolean {
    if (!record.credentialId || !record.rpId || !record.xyHex) {
      return false
    }

    // xyHex should be exactly 128 hex characters (64 bytes: 32-byte x + 32-byte y)
    if (record.xyHex.length !== 128) {
      console.warn('Invalid xyHex length:', record.xyHex.length, 'expected 128')
      return false
    }

    // Validate hex format
    if (!/^[0-9a-fA-F]{128}$/.test(record.xyHex)) {
      console.warn('Invalid xyHex format - must be 128 hex characters')
      return false
    }

    return true
  }

  /**
   * Extract x and y coordinates from xyHex
   */
  extractCoordinates(xyHex: string): { x: string; y: string } | null {
    if (xyHex.length !== 128) {
      console.error('Invalid xyHex length:', xyHex.length)
      return null
    }

    return {
      x: xyHex.slice(0, 64),   // First 64 chars = 32 bytes x
      y: xyHex.slice(64, 128), // Last 64 chars = 32 bytes y
    }
  }

  /**
   * Combine x and y coordinates into xyHex
   */
  combineCoordinates(x: string, y: string): string {
    // Ensure x and y are exactly 32 bytes (64 hex chars) each
    const normalizedX = x.startsWith('0x') ? x.slice(2) : x
    const normalizedY = y.startsWith('0x') ? y.slice(2) : y
    
    if (normalizedX.length !== 64 || normalizedY.length !== 64) {
      throw new Error(`Invalid coordinate lengths: x=${normalizedX.length}, y=${normalizedY.length} (expected 64 each)`)
    }

    return normalizedX + normalizedY
  }
}
