/**
 * POST /api/passkey/register
 * Register a new passkey credential
 * 
 * Body: {
 *   credentialId: string
 *   publicKey: Hex (0x04||x||y format)
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
import crypto from 'crypto'

interface RegisterRequest {
  credentialId: string
  publicKey: Hex
  rpId: string
  userHandle: string
  smartAccountAddress: Hex
  challenge: Hex
  attestationObject?: string
  clientDataJSON?: string
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
    if (!body.credentialId || !body.publicKey || !body.rpId || !body.userHandle || !body.smartAccountAddress || !body.challenge) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
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

    // Mark challenge as used
    store.markChallengeUsed(body.challenge)

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

    // Store the passkey
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
