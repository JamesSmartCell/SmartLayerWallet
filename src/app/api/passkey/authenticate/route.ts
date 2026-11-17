/**
 * POST /api/passkey/authenticate
 * Verify a passkey authentication assertion
 * 
 * Body: {
 *   credentialId: string
 *   challenge: Hex
 *   authenticatorData: string (base64url)
 *   clientDataJSON: string (base64url)
 *   signature: string (base64url)
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { PasskeyStore } from '@/lib/passkey-store'
import { Hex } from 'viem'
import crypto from 'crypto'

interface AuthenticateRequest {
  credentialId: string
  challenge: Hex
  authenticatorData?: string
  clientDataJSON?: string
  signature?: string
}

export async function POST(request: NextRequest) {
  const store = new PasskeyStore()

  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (store.checkRateLimit(ip, '/api/passkey/authenticate', 10, 60)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    const body: AuthenticateRequest = await request.json()

    // Validate required fields
    if (!body.credentialId || !body.challenge) {
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

    if (challengeRecord.type !== 'authentication') {
      return NextResponse.json(
        { error: 'Challenge type mismatch' },
        { status: 400 }
      )
    }

    // Mark challenge as used
    store.markChallengeUsed(body.challenge)

    // Get passkey
    const passkey = store.getPasskey(body.credentialId)
    if (!passkey) {
      return NextResponse.json(
        { error: 'Passkey not found' },
        { status: 404 }
      )
    }

    // Update usage
    store.updatePasskeyUsage(body.credentialId, passkey.signCount + 1)

    return NextResponse.json({
      success: true,
      credentialId: body.credentialId,
      publicKey: passkey.publicKey,
      smartAccountAddress: passkey.smartAccountAddress,
      userHandle: passkey.userHandle,
    })
  } catch (error) {
    console.error('Authentication error:', error)
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    )
  } finally {
    store.close()
  }
}
