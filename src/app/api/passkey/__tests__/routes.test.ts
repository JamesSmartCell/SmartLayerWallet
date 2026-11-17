/**
 * Tests for passkey API routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { PasskeyStore } from '@/lib/passkey-store'
import {
  parseClientDataJSON,
  parseAuthenticatorData,
  verifyClientData,
  verifyAuthenticatorData,
  verifySignature,
  base64UrlToBuffer,
  extractPublicKeyFromAttestation,
} from '@/lib/webauthn-verifier'
import { Hex } from 'viem'
import path from 'path'
import fs from 'fs'

const TEST_DB_PATH = path.join(__dirname, 'test-routes.db')

// Helper to generate P-256 key pair
function generateP256KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  
  // Export public key as JWK to get x and y coordinates
  const jwk = publicKey.export({ format: 'jwk' })
  const x = Buffer.from(jwk.x!, 'base64url')
  const y = Buffer.from(jwk.y!, 'base64url')
  
  // Build uncompressed public key (0x04 || x || y)
  const uncompressedPublicKey = `0x04${x.toString('hex')}${y.toString('hex')}` as Hex
  
  return { publicKey, privateKey, uncompressedPublicKey, x, y }
}

// Helper to create synthetic authenticatorData
function createAuthenticatorData(rpId: string, signCount: number, flags: number = 0x05): string {
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest()
  const flagsByte = Buffer.from([flags]) // UP (0x01) + UV (0x04) = 0x05
  const signCountBytes = Buffer.alloc(4)
  signCountBytes.writeUInt32BE(signCount, 0)
  
  const authData = Buffer.concat([rpIdHash, flagsByte, signCountBytes])
  return authData.toString('base64url')
}

// Helper to create synthetic clientDataJSON
function createClientDataJSON(type: 'webauthn.create' | 'webauthn.get', challenge: Hex, origin: string): string {
  const challengeHex = challenge.startsWith('0x') ? challenge.slice(2) : challenge
  const challengeBase64 = Buffer.from(challengeHex, 'hex').toString('base64url')
  
  const clientData = {
    type,
    challenge: challengeBase64,
    origin,
  }
  
  return Buffer.from(JSON.stringify(clientData)).toString('base64url')
}

// Helper to create ES256 signature
function createSignature(
  privateKey: crypto.KeyObject,
  authenticatorData: string,
  clientDataJSON: string
): string {
  const authDataBuffer = base64UrlToBuffer(authenticatorData)
  const clientDataBuffer = base64UrlToBuffer(clientDataJSON)
  const clientDataHash = crypto.createHash('sha256').update(clientDataBuffer).digest()
  const signedData = Buffer.concat([authDataBuffer, clientDataHash])
  
  const sign = crypto.createSign('SHA256')
  sign.update(signedData)
  sign.end()
  
  const signature = sign.sign(privateKey)
  return signature.toString('base64url')
}

describe('WebAuthn Verifier', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH)
    }
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH)
    }
    const walPath = `${TEST_DB_PATH}-wal`
    const shmPath = `${TEST_DB_PATH}-shm`
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
  })

  describe('Client Data Verification', () => {
    it('should verify valid client data', () => {
      const challenge = '0x' + crypto.randomBytes(32).toString('hex') as Hex
      const rpId = 'localhost'
      const clientDataJSON = createClientDataJSON('webauthn.get', challenge, 'http://localhost:8089')
      const clientData = parseClientDataJSON(clientDataJSON)
      
      const result = verifyClientData(clientData, 'webauthn.get', challenge, rpId)
      expect(result.valid).toBe(true)
    })

    it('should reject wrong origin', () => {
      const challenge = '0x' + crypto.randomBytes(32).toString('hex') as Hex
      const rpId = 'localhost'
      const clientDataJSON = createClientDataJSON('webauthn.get', challenge, 'https://evil.com')
      const clientData = parseClientDataJSON(clientDataJSON)
      
      const result = verifyClientData(clientData, 'webauthn.get', challenge, rpId)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Origin')
    })

    it('should reject wrong challenge', () => {
      const challenge = '0x' + crypto.randomBytes(32).toString('hex') as Hex
      const wrongChallenge = '0x' + crypto.randomBytes(32).toString('hex') as Hex
      const rpId = 'localhost'
      const clientDataJSON = createClientDataJSON('webauthn.get', wrongChallenge, 'http://localhost:8089')
      const clientData = parseClientDataJSON(clientDataJSON)
      
      const result = verifyClientData(clientData, 'webauthn.get', challenge, rpId)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Challenge')
    })

    it('should reject wrong type', () => {
      const challenge = '0x' + crypto.randomBytes(32).toString('hex') as Hex
      const rpId = 'localhost'
      const clientDataJSON = createClientDataJSON('webauthn.create', challenge, 'http://localhost:8089')
      const clientData = parseClientDataJSON(clientDataJSON)
      
      const result = verifyClientData(clientData, 'webauthn.get', challenge, rpId)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('type')
    })
  })

  describe('Authenticator Data Verification', () => {
    it('should verify valid authenticator data', () => {
      const rpId = 'localhost'
      const authenticatorData = createAuthenticatorData(rpId, 1)
      const authData = parseAuthenticatorData(authenticatorData)
      
      const result = verifyAuthenticatorData(authData, rpId, 0)
      expect(result.valid).toBe(true)
    })

    it('should reject wrong rpIdHash', () => {
      const rpId = 'localhost'
      const authenticatorData = createAuthenticatorData('wrong-rpid', 1)
      const authData = parseAuthenticatorData(authenticatorData)
      
      const result = verifyAuthenticatorData(authData, rpId, 0)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('RP ID')
    })

    it('should reject missing UP flag', () => {
      const rpId = 'localhost'
      const authenticatorData = createAuthenticatorData(rpId, 1, 0x00) // No flags
      const authData = parseAuthenticatorData(authenticatorData)
      
      const result = verifyAuthenticatorData(authData, rpId, 0)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('User present')
    })

    it('should detect counter regression', () => {
      const rpId = 'localhost'
      const authenticatorData = createAuthenticatorData(rpId, 5)
      const authData = parseAuthenticatorData(authenticatorData)
      
      const result = verifyAuthenticatorData(authData, rpId, 10)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Sign count regression')
    })

    it('should allow counter 0 (like Windows Hello)', () => {
      const rpId = 'localhost'
      const authenticatorData = createAuthenticatorData(rpId, 0)
      const authData = parseAuthenticatorData(authenticatorData)
      
      const result = verifyAuthenticatorData(authData, rpId, 0)
      expect(result.valid).toBe(true)
    })

    it('should allow counter increase from 0', () => {
      const rpId = 'localhost'
      const authenticatorData = createAuthenticatorData(rpId, 5)
      const authData = parseAuthenticatorData(authenticatorData)
      
      const result = verifyAuthenticatorData(authData, rpId, 0)
      expect(result.valid).toBe(true)
    })
  })

  describe('Signature Verification', () => {
    it('should verify valid signature', () => {
      const { privateKey, uncompressedPublicKey } = generateP256KeyPair()
      const rpId = 'localhost'
      const challenge = '0x' + crypto.randomBytes(32).toString('hex') as Hex
      
      const authenticatorData = createAuthenticatorData(rpId, 1)
      const clientDataJSON = createClientDataJSON('webauthn.get', challenge, 'http://localhost:8089')
      const signature = createSignature(privateKey, authenticatorData, clientDataJSON)
      
      const result = verifySignature(uncompressedPublicKey, signature, authenticatorData, clientDataJSON)
      expect(result).toBe(true)
    })

    it('should reject bad signature', () => {
      const { uncompressedPublicKey } = generateP256KeyPair()
      const { privateKey: wrongPrivateKey } = generateP256KeyPair()
      const rpId = 'localhost'
      const challenge = '0x' + crypto.randomBytes(32).toString('hex') as Hex
      
      const authenticatorData = createAuthenticatorData(rpId, 1)
      const clientDataJSON = createClientDataJSON('webauthn.get', challenge, 'http://localhost:8089')
      const signature = createSignature(wrongPrivateKey, authenticatorData, clientDataJSON)
      
      const result = verifySignature(uncompressedPublicKey, signature, authenticatorData, clientDataJSON)
      expect(result).toBe(false)
    })
  })

  describe('End-to-End Authentication', () => {
    it('should successfully authenticate with valid assertion', () => {
      const store = new PasskeyStore(TEST_DB_PATH)
      const { privateKey, uncompressedPublicKey } = generateP256KeyPair()
      const rpId = 'localhost'
      const credentialId = 'test-credential-id'
      const userHandle = 'test@example.com'
      const smartAccountAddress = '0x' + '1'.repeat(40) as Hex
      
      // Store passkey
      store.storePasskey({
        id: credentialId,
        publicKey: uncompressedPublicKey,
        rpId,
        userHandle,
        smartAccountAddress,
      })
      
      // Create challenge
      const challenge = store.createChallenge('authentication')
      
      // Generate valid assertion
      const authenticatorData = createAuthenticatorData(rpId, 1)
      const clientDataJSON = createClientDataJSON('webauthn.get', challenge.challenge, 'http://localhost:8089')
      const signature = createSignature(privateKey, authenticatorData, clientDataJSON)
      
      // Verify everything
      const clientData = parseClientDataJSON(clientDataJSON)
      const authData = parseAuthenticatorData(authenticatorData)
      const passkey = store.getPasskey(credentialId)
      
      expect(passkey).toBeTruthy()
      expect(verifyClientData(clientData, 'webauthn.get', challenge.challenge, rpId).valid).toBe(true)
      expect(verifyAuthenticatorData(authData, rpId, 0).valid).toBe(true)
      expect(verifySignature(uncompressedPublicKey, signature, authenticatorData, clientDataJSON)).toBe(true)
      
      store.close()
    })

    it('should reject reused challenge', () => {
      const store = new PasskeyStore(TEST_DB_PATH)
      const rpId = 'localhost'
      
      const challenge = store.createChallenge('authentication')
      store.markChallengeUsed(challenge.challenge)
      
      const result = store.getChallenge(challenge.challenge)
      expect(result).toBeNull()
      
      store.close()
    })

    it('should reject expired challenge', async () => {
      const store = new PasskeyStore(TEST_DB_PATH)
      const rpId = 'localhost'
      
      const challenge = store.createChallenge('authentication', 0) // Expire immediately
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const result = store.getChallenge(challenge.challenge)
      expect(result).toBeNull()
      store.close()
    })
  })

  describe('Registration Protection', () => {
    it('should prevent overwriting existing credential', () => {
      const store = new PasskeyStore(TEST_DB_PATH)
      const { uncompressedPublicKey: key1 } = generateP256KeyPair()
      const { uncompressedPublicKey: key2 } = generateP256KeyPair()
      const rpId = 'localhost'
      const credentialId = 'test-credential-id'
      
      // Store first passkey
      const result1 = store.storePasskey({
        id: credentialId,
        publicKey: key1,
        rpId,
        userHandle: 'user1',
        smartAccountAddress: '0x' + '1'.repeat(40) as Hex,
      })
      expect(result1).toBe(true)
      
      // Attempt to overwrite with different key
      const result2 = store.storePasskey({
        id: credentialId,
        publicKey: key2,
        rpId,
        userHandle: 'user2',
        smartAccountAddress: '0x' + '2'.repeat(40) as Hex,
      })
      expect(result2).toBe(false)
      
      // Verify original key is still there
      const passkey = store.getPasskey(credentialId)
      expect(passkey?.publicKey).toBe(key1)
      expect(passkey?.userHandle).toBe('user1')
      
      store.close()
    })
  })
})
