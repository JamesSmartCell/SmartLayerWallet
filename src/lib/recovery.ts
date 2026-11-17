/**
 * RecoveryService - Minimal Recovery API integration
 * For credentialId -> publicKey(x||y) sync only
 */

export interface PasskeyRecord {
  credentialId: string
  rpId: string
  xyHex: string // 64 bytes hex (x||y)
}

export class RecoveryService {
  constructor(private baseUrl: string) {}

  /**
   * Upsert passkey record to recovery API
   */
  async upsertPasskey(record: PasskeyRecord): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/passkeys`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(record),
      })

      if (!response.ok) {
        throw new Error(`Recovery API error: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to upsert passkey to recovery API:', error)
      // Don't throw - recovery API is optional for core functionality
    }
  }

  /**
   * Get passkey record from recovery API
   */
  async getPasskey(credentialId: string): Promise<PasskeyRecord | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/passkeys/${credentialId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 404) {
          return null // Not found
        }
        throw new Error(`Recovery API error: ${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Failed to get passkey from recovery API:', error)
      return null
    }
  }

  /**
   * Delete passkey record from recovery API
   */
  async deletePasskey(credentialId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/passkeys/${credentialId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok && response.status !== 404) {
        throw new Error(`Recovery API error: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to delete passkey from recovery API:', error)
      // Don't throw - recovery API is optional
    }
  }

  /**
   * Health check for recovery API
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      return response.ok
    } catch (error) {
      console.error('Recovery API health check failed:', error)
      return false
    }
  }
}
