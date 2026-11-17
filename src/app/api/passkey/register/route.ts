/**
 * POST /api/passkey/register
 * Register a new passkey credential with full WebAuthn verification
 * 
 * Body: {
 *   credentialId: string
 *   publicKey: Hex (0x04||x||y format) - verified against attestation
 *   rpId: string
 *   userHandle: string
 *   smartAccountAddress: Hex
 *   challenge: Hex
 *   attestationObject: string (base64url)
 *   clientDataJSON: string (base64url)
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { PasskeyStore } from '@/lib/passkey-store'
import { Hex } from 'viem'
import {
  parseClientDataJSON,
  verifyClientData,
  extractPublicKeyFromAttestation,
} from '@/lib/webauthn-verifier'

interface RegisterRequest {
  credentialId: string
  publicKey: Hex
  rpId: string
  userHandle: string
  smartAccountAddress: Hex
  challenge: Hex
  attestationObject: string
  clientDataJSON: string
}

export async function POST(request: NextRequest) {
  const store = new PasskeyStore()

  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (store.checkRateLimit(ip, '/api/passkey/register', 5, 300)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    const body: RegisterRequest = await request.json()

    // Validate required fields
    if (!body.credentialId || !body.publicKey || !body.rpId || !body.userHandle || 
        !body.smartAccountAddress || !body.challenge || !body.attestationObject || !body.clientDataJSON) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Check if credential already exists - prevent overwrite
    const existing = store.getPasskey(body.credentialId)
    if (existing) {
      // Check if it's the same key
      if (existing.publicKey !== body.publicKey || existing.smartAccountAddress !== body.smartAccountAddress) {
        return NextResponse.json(
          { error: 'Credential already exists with different key or address' },
          { status: 409 }
        )
      }
      // Same credential, return success (idempotent)
      return NextResponse.json({
        success: true,
        credentialId: body.credentialId,
      })
    }

    // Verify challenge
    const challengeRecord = store.getChallenge(body.challenge)
    if (!challengeRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired challenge' },
        { status: 400 }
      )
    }

    if (challengeRecord.type !== 'registration') {
      return NextResponse.json(
        { error: 'Challenge type mismatch' },
        { status: 400 }
      )
    }

    // Parse client data
    let clientData
    try {
      clientData = parseClientDataJSON(body.clientDataJSON)
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid client data JSON' },
        { status: 400 }
      )
    }

    // Verify client data
    const clientDataVerification = verifyClientData(
      clientData,
      'webauthn.create',
      body.challenge,
      body.rpId
    )
    if (!clientDataVerification.valid) {
      return NextResponse.json(
        { error: `Client data verification failed: ${clientDataVerification.error}` },
        { status: 400 }
      )
    }

    // Extract public key from attestation object and verify it matches
    let extractedPublicKey: Hex
    try {
      extractedPublicKey = extractPublicKeyFromAttestation(body.attestationObject)
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to extract public key from attestation' },
        { status: 400 }
      )
    }

    // Normalize both keys for comparison
    const normalizeKey = (key: string) => key.toLowerCase().replace(/^0x/, '')
    if (normalizeKey(extractedPublicKey) !== normalizeKey(body.publicKey)) {
      return NextResponse.json(
        { error: 'Public key mismatch: client-supplied key does not match attestation' },
        { status: 400 }
      )
    }

    // Validate public key format (should be 0x04||x||y, 65 bytes total = 130 hex chars + 0x)
    if (!body.publicKey.startsWith('0x') || body.publicKey.length !== 132) {
      return NextResponse.json(
        { error: 'Invalid public key format' },
        { status: 400 }
      )
    }

    // Validate smart account address format
    if (!body.smartAccountAddress.startsWith('0x') || body.smartAccountAddress.length !== 42) {
      return NextResponse.json(
        { error: 'Invalid smart account address format' },
        { status: 400 }
      )
    }

    // Mark challenge as used (only after all verification passes)
    store.markChallengeUsed(body.challenge)

    // Store the passkey (insert-only, we already checked it doesn't exist)
    store.storePasskey({
      id: body.credentialId,
      publicKey: body.publicKey,
      rpId: body.rpId,
      userHandle: body.userHandle,
      smartAccountAddress: body.smartAccountAddress,
    })

    return NextResponse.json({
      success: true,
      credentialId: body.credentialId,
    })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    )
  } finally {
    store.close()
  }
}
