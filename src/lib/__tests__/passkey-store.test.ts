/**
 * Tests for PasskeyStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PasskeyStore } from '../passkey-store'
import { Hex } from 'viem'
import fs from 'fs'
import path from 'path'

const TEST_DB_PATH = path.join(__dirname, 'test-wallet.db')

describe('PasskeyStore', () => {
  let store: PasskeyStore

  beforeEach(() => {
    // Remove test DB if it exists
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH)
    }
    store = new PasskeyStore(TEST_DB_PATH)
  })

  afterEach(() => {
    store.close()
    // Cleanup
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH)
    }
    // Clean up WAL files
    const walPath = `${TEST_DB_PATH}-wal`
    const shmPath = `${TEST_DB_PATH}-shm`
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
  })

  describe('storePasskey', () => {
    it('should store a new passkey', () => {
      const passkey = {
        id: 'test-credential-id',
        publicKey: '0x04' + 'a'.repeat(128) as Hex,
        rpId: 'percolate.one',
        userHandle: 'test@example.com',
        smartAccountAddress: '0x' + '1'.repeat(40) as Hex,
      }

      store.storePasskey(passkey)

      const retrieved = store.getPasskey(passkey.id)
      expect(retrieved).toBeTruthy()
      expect(retrieved?.id).toBe(passkey.id)
      expect(retrieved?.publicKey).toBe(passkey.publicKey)
      expect(retrieved?.rpId).toBe(passkey.rpId)
      expect(retrieved?.userHandle).toBe(passkey.userHandle)
      expect(retrieved?.smartAccountAddress).toBe(passkey.smartAccountAddress)
      expect(retrieved?.signCount).toBe(0)
    })

    it('should NOT overwrite existing passkey (insert-only)', () => {
      const passkey = {
        id: 'test-credential-id',
        publicKey: '0x04' + 'a'.repeat(128) as Hex,
        rpId: 'percolate.one',
        userHandle: 'test@example.com',
        smartAccountAddress: '0x' + '1'.repeat(40) as Hex,
      }

      const result1 = store.storePasskey(passkey)
      expect(result1).toBe(true)

      // Attempt to overwrite with new public key
      const updatedPasskey = {
        ...passkey,
        publicKey: '0x04' + 'b'.repeat(128) as Hex,
      }
      const result2 = store.storePasskey(updatedPasskey)
      expect(result2).toBe(false) // Should fail

      // Original key should be preserved
      const retrieved = store.getPasskey(passkey.id)
      expect(retrieved?.publicKey).toBe(passkey.publicKey)
    })
  })

  describe('getPasskey', () => {
    it('should return null for non-existent passkey', () => {
      const result = store.getPasskey('non-existent-id')
      expect(result).toBeNull()
    })

    it('should retrieve stored passkey', () => {
      const passkey = {
        id: 'test-credential-id',
        publicKey: '0x04' + 'a'.repeat(128) as Hex,
        rpId: 'percolate.one',
        userHandle: 'test@example.com',
        smartAccountAddress: '0x' + '1'.repeat(40) as Hex,
      }

      store.storePasskey(passkey)
      const retrieved = store.getPasskey(passkey.id)

      expect(retrieved).toBeTruthy()
      expect(retrieved?.id).toBe(passkey.id)
    })
  })

  describe('getPasskeysForUser', () => {
    it('should return empty array for user with no passkeys', () => {
      const result = store.getPasskeysForUser('no-passkeys@example.com')
      expect(result).toEqual([])
    })

    it('should return all passkeys for a user', () => {
      const userHandle = 'test@example.com'
      const passkey1 = {
        id: 'credential-1',
        publicKey: '0x04' + 'a'.repeat(128) as Hex,
        rpId: 'percolate.one',
        userHandle,
        smartAccountAddress: '0x' + '1'.repeat(40) as Hex,
      }
      const passkey2 = {
        id: 'credential-2',
        publicKey: '0x04' + 'b'.repeat(128) as Hex,
        rpId: 'percolate.one',
        userHandle,
        smartAccountAddress: '0x' + '2'.repeat(40) as Hex,
      }

      store.storePasskey(passkey1)
      store.storePasskey(passkey2)

      const result = store.getPasskeysForUser(userHandle)
      expect(result).toHaveLength(2)
      expect(result.map(p => p.id).sort()).toEqual(['credential-1', 'credential-2'])
    })
  })

  describe('updatePasskeyUsage', () => {
    it('should update last used time and sign count', async () => {
      const passkey = {
        id: 'test-credential-id',
        publicKey: '0x04' + 'a'.repeat(128) as Hex,
        rpId: 'percolate.one',
        userHandle: 'test@example.com',
        smartAccountAddress: '0x' + '1'.repeat(40) as Hex,
      }

      store.storePasskey(passkey)
      const initial = store.getPasskey(passkey.id)

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10))
      
      store.updatePasskeyUsage(passkey.id, 5)
      const updated = store.getPasskey(passkey.id)

      expect(updated?.signCount).toBe(5)
      expect(updated?.lastUsed.getTime()).toBeGreaterThan(initial!.lastUsed.getTime())
    })
  })

  describe('createChallenge', () => {
    it('should create a registration challenge', () => {
      const challenge = store.createChallenge('registration', 300)

      expect(challenge.id).toBeTruthy()
      expect(challenge.challenge).toMatch(/^0x[0-9a-f]{64}$/i)
      expect(challenge.type).toBe('registration')
      expect(challenge.used).toBe(false)
      expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('should create an authentication challenge', () => {
      const challenge = store.createChallenge('authentication', 300)

      expect(challenge.type).toBe('authentication')
      expect(challenge.challenge).toMatch(/^0x[0-9a-f]{64}$/i)
    })
  })

  describe('getChallenge', () => {
    it('should return null for non-existent challenge', () => {
      const result = store.getChallenge('0x' + '0'.repeat(64) as Hex)
      expect(result).toBeNull()
    })

    it('should return null for expired challenge', () => {
      const challenge = store.createChallenge('authentication', 0) // Expire immediately

      // Wait a bit to ensure expiry
      setTimeout(() => {
        const result = store.getChallenge(challenge.challenge)
        expect(result).toBeNull()
      }, 10)
    })

    it('should return valid unused challenge', () => {
      const challenge = store.createChallenge('authentication', 300)

      const result = store.getChallenge(challenge.challenge)
      expect(result).toBeTruthy()
      expect(result?.challenge).toBe(challenge.challenge)
    })

    it('should return null for used challenge', () => {
      const challenge = store.createChallenge('authentication', 300)

      store.markChallengeUsed(challenge.challenge)

      const result = store.getChallenge(challenge.challenge)
      expect(result).toBeNull()
    })
  })

  describe('markChallengeUsed', () => {
    it('should mark challenge as used', () => {
      const challenge = store.createChallenge('authentication', 300)

      store.markChallengeUsed(challenge.challenge)

      const result = store.getChallenge(challenge.challenge)
      expect(result).toBeNull()
    })
  })

  describe('checkRateLimit', () => {
    it('should allow requests under limit', () => {
      const ip = '127.0.0.1'
      const endpoint = '/test'

      for (let i = 0; i < 5; i++) {
        const exceeded = store.checkRateLimit(ip, endpoint, 10, 60)
        expect(exceeded).toBe(false)
      }
    })

    it('should block requests over limit', () => {
      const ip = '127.0.0.1'
      const endpoint = '/test'
      const maxRequests = 3

      for (let i = 0; i < maxRequests; i++) {
        store.checkRateLimit(ip, endpoint, maxRequests, 60)
      }

      const exceeded = store.checkRateLimit(ip, endpoint, maxRequests, 60)
      expect(exceeded).toBe(true)
    })

    it('should reset after window expires', async () => {
      const ip = '127.0.0.1'
      const endpoint = '/test'
      const maxRequests = 2
      const windowSeconds = 1

      // Fill up the limit
      for (let i = 0; i < maxRequests; i++) {
        store.checkRateLimit(ip, endpoint, maxRequests, windowSeconds)
      }

      // Should be blocked
      expect(store.checkRateLimit(ip, endpoint, maxRequests, windowSeconds)).toBe(true)

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      // Should be allowed again
      expect(store.checkRateLimit(ip, endpoint, maxRequests, windowSeconds)).toBe(false)
    })
  })
})
