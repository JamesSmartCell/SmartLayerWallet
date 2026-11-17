/**
 * POST /api/passkey/authenticate
 * Verify a passkey authentication assertion with full WebAuthn verification
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
import {
  parseClientDataJSON,
  parseAuthenticatorData,
  verifyClientData,
  verifyAuthenticatorData,
  verifySignature,
} from '@/lib/webauthn-verifier'

interface AuthenticateRequest {
  credentialId: string
  challenge: Hex
  authenticatorData: string
  clientDataJSON: string
  signature: string
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
    if (!body.credentialId || !body.challenge || !body.authenticatorData || !body.clientDataJSON || !body.signature) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verify challenge exists and is valid
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

    // Get passkey
    const passkey = store.getPasskey(body.credentialId)
    if (!passkey) {
      return NextResponse.json(
        { error: 'Passkey not found' },
        { status: 404 }
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
      'webauthn.get',
      body.challenge,
      passkey.rpId
    )
    if (!clientDataVerification.valid) {
      return NextResponse.json(
        { error: `Client data verification failed: ${clientDataVerification.error}` },
        { status: 400 }
      )
    }

    // Parse authenticator data
    let authData
    try {
      authData = parseAuthenticatorData(body.authenticatorData)
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid authenticator data' },
        { status: 400 }
      )
    }

    // Verify authenticator data
    const authDataVerification = verifyAuthenticatorData(
      authData,
      passkey.rpId,
      passkey.signCount
    )
    if (!authDataVerification.valid) {
      return NextResponse.json(
        { error: `Authenticator data verification failed: ${authDataVerification.error}` },
        { status: 400 }
      )
    }

    // Verify signature
    const signatureValid = verifySignature(
      passkey.publicKey,
      body.signature,
      body.authenticatorData,
      body.clientDataJSON
    )

    if (!signatureValid) {
      return NextResponse.json(
        { error: 'Signature verification failed' },
        { status: 400 }
      )
    }

    // All verification passed - mark challenge as used
    store.markChallengeUsed(body.challenge)

    // Update passkey usage with authenticator's sign count
    // (Not +1, as many authenticators like Windows Hello and iCloud report 0)
    store.updatePasskeyUsage(body.credentialId, authData.signCount)

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
