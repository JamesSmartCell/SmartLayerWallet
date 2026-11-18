/**
 * Route-level tests for /api/passkey/recover and /api/passkey/migrate
 * Uses real @noble/curves P-256 keypairs to produce WebAuthn-shaped assertions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha256'
import { Hex } from 'viem'
import { PasskeyStore } from '@/lib/passkey-store'
import { bytesToBase64Url } from '@/lib/p256-recovery'

const TEST_DB_PATH = path.join(__dirname, 'test-recover-migrate.db')
const RP_ID = 'localhost'
const ORIGIN = 'http://localhost:8089'
const SMART_ACCOUNT = ('0x' + '1'.repeat(40)) as Hex

vi.mock('@/lib/smart-account-real', () => ({
  SmartAccountService: class {
    async getSmartAccountAddress() {
      return SMART_ACCOUNT
    }
  },
}))

function cleanupDb() {
  for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}

function createAuthenticatorData(rpId: string, signCount: number = 1, flags: number = 0x05): string {
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest()
  const flagsByte = Buffer.from([flags])
  const signCountBytes = Buffer.alloc(4)
  signCountBytes.writeUInt32BE(signCount, 0)
  return Buffer.concat([rpIdHash, flagsByte, signCountBytes]).toString('base64url')
}

function createClientDataJSON(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: Hex,
  origin: string
): string {
  const challengeHex = challenge.startsWith('0x') ? challenge.slice(2) : challenge
  const challengeBase64 = Buffer.from(challengeHex, 'hex').toString('base64url')
  return Buffer.from(JSON.stringify({ type, challenge: challengeBase64, origin })).toString('base64url')
}

function generateNobleKeyPair() {
  const privateKey = p256.utils.randomPrivateKey()
  const publicKeyBytes = p256.getPublicKey(privateKey, false)
  const publicKey = ('0x' + Buffer.from(publicKeyBytes).toString('hex')) as Hex
  return { privateKey, publicKey }
}

function createNobleSignature(
  privateKey: Uint8Array,
  authenticatorData: string,
  clientDataJSON: string
): string {
  const authDataBytes = base64UrlToBytes(authenticatorData)
  const clientDataBytes = base64UrlToBytes(clientDataJSON)
  const clientDataHash = sha256(clientDataBytes)
  const message = new Uint8Array(authDataBytes.length + clientDataHash.length)
  message.set(authDataBytes, 0)
  message.set(clientDataHash, authDataBytes.length)
  const messageHash = sha256(message)
  const sig = p256.sign(messageHash, privateKey)
  return bytesToBase64Url(sig.toDERRawBytes())
}

function base64UrlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  return new Uint8Array(Buffer.from(base64 + padding, 'base64'))
}

function makeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `127.0.0.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify(body),
  })
}

describe('/api/passkey/recover', () => {
  beforeEach(() => {
    cleanupDb()
    process.env.WALLET_DB_PATH = TEST_DB_PATH
    process.env.NEXT_PUBLIC_RP_ID = RP_ID
    process.env.WALLET_ALLOWED_ORIGINS = ORIGIN
    vi.resetModules()
  })

  afterEach(() => {
    cleanupDb()
    delete process.env.WALLET_DB_PATH
  })

  async function setupChallenges() {
    const store = new PasskeyStore(TEST_DB_PATH)
    const c1 = store.createChallenge('authentication')
    const c2 = store.createChallenge('authentication')
    store.close()
    return { challenge1: c1.challenge, challenge2: c2.challenge }
  }

  function buildAssertion(privateKey: Uint8Array, challenge: Hex, opts?: {
    rpId?: string
    origin?: string
    flags?: number
  }) {
    const rpId = opts?.rpId ?? RP_ID
    const origin = opts?.origin ?? ORIGIN
    const authenticatorData = createAuthenticatorData(rpId, 1, opts?.flags ?? 0x05)
    const clientDataJSON = createClientDataJSON('webauthn.get', challenge, origin)
    const signature = createNobleSignature(privateKey, authenticatorData, clientDataJSON)
    return { challenge, authenticatorData, clientDataJSON, signature }
  }

  it('happy path: recovers passkey from two real P-256 assertions', async () => {
    const { POST } = await import('../recover/route')
    const { privateKey, publicKey } = generateNobleKeyPair()
    const { challenge1, challenge2 } = await setupChallenges()

    const body = {
      credentialId: 'recover-cred-1',
      rpId: RP_ID,
      userHandle: 'user@example.com',
      assertion1: buildAssertion(privateKey, challenge1),
      assertion2: buildAssertion(privateKey, challenge2),
    }

    const res = await POST(makeRequest('http://localhost/api/passkey/recover', body))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.publicKey.toLowerCase()).toBe(publicKey.toLowerCase())
    expect(json.smartAccountAddress).toBe(SMART_ACCOUNT)

    // Challenges must be marked used
    const store = new PasskeyStore(TEST_DB_PATH)
    expect(store.getChallenge(challenge1)).toBeNull()
    expect(store.getChallenge(challenge2)).toBeNull()
    const stored = store.getPasskey('recover-cred-1')
    expect(stored?.publicKey.toLowerCase()).toBe(publicKey.toLowerCase())
    store.close()
  })

  it('rejects reused challenge', async () => {
    const { POST } = await import('../recover/route')
    const { privateKey } = generateNobleKeyPair()
    const { challenge1, challenge2 } = await setupChallenges()

    const store = new PasskeyStore(TEST_DB_PATH)
    store.markChallengeUsed(challenge1)
    store.close()

    const body = {
      credentialId: 'recover-cred-reuse',
      rpId: RP_ID,
      userHandle: 'user@example.com',
      assertion1: buildAssertion(privateKey, challenge1),
      assertion2: buildAssertion(privateKey, challenge2),
    }

    const res = await POST(makeRequest('http://localhost/api/passkey/recover', body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/challenge/i)
  })

  it('rejects wrong rpId', async () => {
    const { POST } = await import('../recover/route')
    const { privateKey } = generateNobleKeyPair()
    const { challenge1, challenge2 } = await setupChallenges()

    const body = {
      credentialId: 'recover-cred-rpid',
      rpId: 'evil.example',
      userHandle: 'user@example.com',
      assertion1: buildAssertion(privateKey, challenge1, { rpId: 'evil.example' }),
      assertion2: buildAssertion(privateKey, challenge2, { rpId: 'evil.example' }),
    }

    const res = await POST(makeRequest('http://localhost/api/passkey/recover', body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/RP ID/i)
  })

  it('rejects disallowed origin', async () => {
    const { POST } = await import('../recover/route')
    const { privateKey } = generateNobleKeyPair()
    const { challenge1, challenge2 } = await setupChallenges()

    const body = {
      credentialId: 'recover-cred-origin',
      rpId: RP_ID,
      userHandle: 'user@example.com',
      assertion1: buildAssertion(privateKey, challenge1, { origin: 'https://evil.com' }),
      assertion2: buildAssertion(privateKey, challenge2, { origin: 'https://evil.com' }),
    }

    const res = await POST(makeRequest('http://localhost/api/passkey/recover', body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/origin/i)
  })

  it('rejects identical challenges', async () => {
    const { POST } = await import('../recover/route')
    const { privateKey } = generateNobleKeyPair()
    const store = new PasskeyStore(TEST_DB_PATH)
    const challenge = store.createChallenge('authentication').challenge
    store.close()

    const assertion = buildAssertion(privateKey, challenge)
    const body = {
      credentialId: 'recover-cred-same',
      rpId: RP_ID,
      userHandle: 'user@example.com',
      assertion1: assertion,
      assertion2: { ...assertion },
    }

    const res = await POST(makeRequest('http://localhost/api/passkey/recover', body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/different challenges/i)
  })
})

describe('/api/passkey/migrate', () => {
  beforeEach(() => {
    cleanupDb()
    process.env.WALLET_DB_PATH = TEST_DB_PATH
    process.env.NEXT_PUBLIC_RP_ID = RP_ID
    process.env.WALLET_ALLOWED_ORIGINS = ORIGIN
    vi.resetModules()
  })

  afterEach(() => {
    cleanupDb()
    delete process.env.WALLET_DB_PATH
  })

  function buildMigrateBody(privateKey: Uint8Array, publicKey: Hex, challenge: Hex, opts?: {
    rpId?: string
    origin?: string
  }) {
    const rpId = opts?.rpId ?? RP_ID
    const origin = opts?.origin ?? ORIGIN
    const authenticatorData = createAuthenticatorData(rpId)
    const clientDataJSON = createClientDataJSON('webauthn.get', challenge, origin)
    const signature = createNobleSignature(privateKey, authenticatorData, clientDataJSON)

    return {
      credentialId: 'migrate-cred-1',
      publicKey,
      rpId,
      userHandle: 'migrate@example.com',
      smartAccountAddress: SMART_ACCOUNT,
      challenge,
      authenticatorData,
      clientDataJSON,
      signature,
    }
  }

  it('happy path: migrates passkey with valid assertion', async () => {
    const { POST } = await import('../migrate/route')
    const { privateKey, publicKey } = generateNobleKeyPair()
    const store = new PasskeyStore(TEST_DB_PATH)
    const challenge = store.createChallenge('authentication').challenge
    store.close()

    const body = buildMigrateBody(privateKey, publicKey, challenge)
    const res = await POST(makeRequest('http://localhost/api/passkey/migrate', body))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.credentialId).toBe('migrate-cred-1')

    const verifyStore = new PasskeyStore(TEST_DB_PATH)
    expect(verifyStore.getChallenge(challenge)).toBeNull()
    expect(verifyStore.getPasskey('migrate-cred-1')?.publicKey).toBe(publicKey)
    verifyStore.close()
  })

  it('rejects reused challenge', async () => {
    const { POST } = await import('../migrate/route')
    const { privateKey, publicKey } = generateNobleKeyPair()
    const store = new PasskeyStore(TEST_DB_PATH)
    const challenge = store.createChallenge('authentication').challenge
    store.markChallengeUsed(challenge)
    store.close()

    const body = buildMigrateBody(privateKey, publicKey, challenge)
    const res = await POST(makeRequest('http://localhost/api/passkey/migrate', body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/challenge/i)
  })

  it('rejects wrong rpId', async () => {
    const { POST } = await import('../migrate/route')
    const { privateKey, publicKey } = generateNobleKeyPair()
    const store = new PasskeyStore(TEST_DB_PATH)
    const challenge = store.createChallenge('authentication').challenge
    store.close()

    const body = buildMigrateBody(privateKey, publicKey, challenge, { rpId: 'evil.example' })
    const res = await POST(makeRequest('http://localhost/api/passkey/migrate', body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/RP ID/i)
  })

  it('rejects disallowed origin', async () => {
    const { POST } = await import('../migrate/route')
    const { privateKey, publicKey } = generateNobleKeyPair()
    const store = new PasskeyStore(TEST_DB_PATH)
    const challenge = store.createChallenge('authentication').challenge
    store.close()

    const body = buildMigrateBody(privateKey, publicKey, challenge, { origin: 'https://evil.com' })
    const res = await POST(makeRequest('http://localhost/api/passkey/migrate', body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/origin/i)
  })
})
