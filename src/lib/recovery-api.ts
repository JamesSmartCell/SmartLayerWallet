/**
 * SmartLayerWallet Passkey Service
 * Uses local Next.js API routes for passkey storage and authentication
 * 
 * Endpoints:
 * - GET /api/passkey/challenge - Get WebAuthn challenge
 * - POST /api/passkey/register - Register new passkey
 * - POST /api/passkey/authenticate - Authenticate with passkey
 * - GET /api/passkey/{credentialId} - Retrieve passkey data
 */

import { Hex } from 'viem'

export class PasskeyBackendService {
  private baseUrl: string

  constructor(baseUrl?: string) {
    // Use same-origin API routes by default
    this.baseUrl = (baseUrl || '').replace(/\/$/, '') || ''
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

  /**
   * Get a new WebAuthn challenge
   */
  async getChallenge(type: 'registration' | 'authentication' = 'authentication'): Promise<{ challenge: Hex; expiresAt: string }> {
    const url = `${this.baseUrl}/api/passkey/challenge?type=${type}`
    const r = await fetch(url)
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Challenge failed: ${r.status}`)
    return data
  }

  /**
   * Register a new passkey
   */
  async registerPasskey(params: {
    credentialId: string
    publicKey: Hex
    rpId: string
    userHandle: string
    smartAccountAddress: Hex
    challenge: Hex
    attestationObject?: string
    clientDataJSON?: string
  }): Promise<{ success: boolean; credentialId: string }> {
    const url = `${this.baseUrl}/api/passkey/register`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Registration failed: ${r.status}`)
    return data
  }

  /**
   * Authenticate with a passkey
   */
  async authenticatePasskey(params: {
    credentialId: string
    challenge: Hex
    authenticatorData?: string
    clientDataJSON?: string
    signature?: string
  }): Promise<{ success: boolean; credentialId: string; publicKey: Hex; smartAccountAddress: Hex; userHandle: string }> {
    const url = `${this.baseUrl}/api/passkey/authenticate`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Authentication failed: ${r.status}`)
    return data
  }

  /**
   * Get passkey by credential ID (for cross-device recovery)
   */
  async getPasskey(credentialId: string): Promise<{
    credentialId: string
    publicKey: Hex
    rpId: string
    smartAccountAddress: Hex
    userHandle: string
    createdAt: string
    lastUsed: string
  } | null> {
    const url = `${this.baseUrl}/api/passkey/${encodeURIComponent(credentialId)}`
    const r = await fetch(url)
    if (r.status === 404) return null
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Get passkey failed: ${r.status}`)
    return data
  }

  /**
   * Migrate a localStorage-only passkey to server storage with signature verification
   */
  async migratePasskey(params: {
    credentialId: string
    publicKey: Hex
    rpId: string
    userHandle: string
    smartAccountAddress: Hex
    challenge: Hex
    authenticatorData: string
    clientDataJSON: string
    signature: string
  }): Promise<{ success: boolean; credentialId: string; message: string }> {
    const url = `${this.baseUrl}/api/passkey/migrate`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Migration failed: ${r.status}`)
    return data
  }

  /**
   * Recover passkey using public key recovery from two assertions
   */
  async recoverPasskey(params: {
    credentialId: string
    rpId: string
    userHandle: string
    assertion1: {
      challenge: Hex
      authenticatorData: string
      clientDataJSON: string
      signature: string
    }
    assertion2: {
      challenge: Hex
      authenticatorData: string
      clientDataJSON: string
      signature: string
    }
  }): Promise<{ success: boolean; credentialId: string; publicKey: Hex; smartAccountAddress: Hex; message: string }> {
    const url = `${this.baseUrl}/api/passkey/recover`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const data = await this.parseJsonResponse<any>(r, url)
    if (!r.ok) throw new Error(data?.error || `Recovery failed: ${r.status}`)
    return data
  }
}

