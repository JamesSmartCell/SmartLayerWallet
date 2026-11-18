/**
 * POST /api/passkey/recover
 * Recover and register a passkey using public key recovery from two assertions
 * 
 * When a user has a passkey in their authenticator but no server record exists,
 * we can recover the public key by requesting two separate assertions over
 * different challenges. P-256 ECDSA signatures allow recovering 2 candidate
 * public keys per signature. By finding the common key across both assertions,
 * we cryptographically verify possession without trusting localStorage data.
 * 
 * Body: {
 *   credentialId: string
 *   rpId: string
 *   userHandle: string
 *   assertion1: {
 *     challenge: Hex
 *     authenticatorData: string (base64url)
 *     clientDataJSON: string (base64url)
 *     signature: string (base64url)
 *   }
 *   assertion2: {
 *     challenge: Hex
 *     authenticatorData: string (base64url)
 *     clientDataJSON: string (base64url)
 *     signature: string (base64url)
 *   }
 * }
 * 
 * Security:
 * - Both challenges must be server-issued and unused
 * - Both assertions must have matching rpId, origin, type
 * - Public key must be common to both recovery attempts
 * - Both signatures must verify with the recovered key
 * - Smart account address is derived server-side
 * - Rate limited to prevent abuse
 */

import { NextRequest, NextResponse } from 'next/server'
import { PasskeyStore } from '@/lib/passkey-store'
import { Hex } from 'viem'
import {
  parseClientDataJSON,
  verifyClientData,
  verifySignature,
} from '@/lib/webauthn-verifier'
import { recoverPublicKeys, findCommonKey } from '@/lib/p256-recovery'
import { SmartAccountService } from '@/lib/smart-account-real'
import { NETWORK_KEYS } from '@/lib/env'

interface RecoverRequest {
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
}

export async function POST(request: NextRequest) {
  const store = new PasskeyStore()

  try {
    // Strict rate limiting - recovery should be rare
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (store.checkRateLimit(ip, '/api/passkey/recover', 2, 300)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    const body: RecoverRequest = await request.json()

    // Validate required fields
    if (!body.credentialId || !body.rpId || !body.userHandle ||
        !body.assertion1?.challenge || !body.assertion1?.authenticatorData ||
        !body.assertion1?.clientDataJSON || !body.assertion1?.signature ||
        !body.assertion2?.challenge || !body.assertion2?.authenticatorData ||
        !body.assertion2?.clientDataJSON || !body.assertion2?.signature) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Assertions must use different challenges
    if (body.assertion1.challenge === body.assertion2.challenge) {
      return NextResponse.json(
        { error: 'Both assertions must use different challenges' },
        { status: 400 }
      )
    }

    // Check if credential already exists - refuse recovery if different key
    const existing = store.getPasskey(body.credentialId)
    if (existing) {
      return NextResponse.json(
        { error: 'Credential already registered. Recovery not needed.' },
        { status: 409 }
      )
    }

    // Verify both challenges were server-issued
    const challenge1 = store.getChallenge(body.assertion1.challenge)
    const challenge2 = store.getChallenge(body.assertion2.challenge)

    if (!challenge1 || !challenge2) {
      return NextResponse.json(
        { error: 'Invalid or expired challenge' },
        { status: 400 }
      )
    }

    if (challenge1.type !== 'authentication' || challenge2.type !== 'authentication') {
      return NextResponse.json(
        { error: 'Recovery requires authentication-type challenges' },
        { status: 400 }
      )
    }

    // Parse and verify client data for both assertions
    const clientData1 = parseClientDataJSON(body.assertion1.clientDataJSON)
    const clientData2 = parseClientDataJSON(body.assertion2.clientDataJSON)
    
    const origin = request.headers.get('origin') || `https://${body.rpId}`

    const verify1 = verifyClientData(clientData1, 'webauthn.get', body.assertion1.challenge, body.rpId)
    const verify2 = verifyClientData(clientData2, 'webauthn.get', body.assertion2.challenge, body.rpId)

    if (!verify1.valid) {
      return NextResponse.json(
        { error: `Assertion 1 client data verification failed: ${verify1.error}` },
        { status: 400 }
      )
    }

    if (!verify2.valid) {
      return NextResponse.json(
        { error: `Assertion 2 client data verification failed: ${verify2.error}` },
        { status: 400 }
      )
    }

    // Recover public key candidates from both assertions
    let candidates1: Hex[]
    let candidates2: Hex[]

    try {
      candidates1 = recoverPublicKeys({
        signature: body.assertion1.signature,
        authenticatorData: body.assertion1.authenticatorData,
        clientDataJSON: body.assertion1.clientDataJSON,
      })
    } catch (error: any) {
      console.error('Public key recovery failed for assertion 1:', error.message)
      return NextResponse.json(
        { error: 'Failed to recover public key from first assertion' },
        { status: 400 }
      )
    }

    try {
      candidates2 = recoverPublicKeys({
        signature: body.assertion2.signature,
        authenticatorData: body.assertion2.authenticatorData,
        clientDataJSON: body.assertion2.clientDataJSON,
      })
    } catch (error: any) {
      console.error('Public key recovery failed for assertion 2:', error.message)
      return NextResponse.json(
        { error: 'Failed to recover public key from second assertion' },
        { status: 400 }
      )
    }

    // Find common public key
    const recoveredPublicKey = findCommonKey(candidates1, candidates2)

    if (!recoveredPublicKey) {
      console.error('No common public key found between assertions')
      console.error('Candidates from assertion 1:', candidates1)
      console.error('Candidates from assertion 2:', candidates2)
      return NextResponse.json(
        { error: 'Public key recovery failed: no common key found. Passkey may be invalid.' },
        { status: 400 }
      )
    }

    // Verify both signatures with recovered public key
    const sig1Valid = verifySignature(
      recoveredPublicKey,
      body.assertion1.signature,
      body.assertion1.authenticatorData,
      body.assertion1.clientDataJSON
    )

    const sig2Valid = verifySignature(
      recoveredPublicKey,
      body.assertion2.signature,
      body.assertion2.authenticatorData,
      body.assertion2.clientDataJSON
    )

    if (!sig1Valid || !sig2Valid) {
      return NextResponse.json(
        { error: 'Signature verification failed with recovered public key' },
        { status: 401 }
      )
    }

    // Derive smart account address from recovered public key
    const smartAccountService = new SmartAccountService(NETWORK_KEYS.BASE_SEPOLIA)
    const smartAccountAddress = await smartAccountService.getSmartAccountAddress({
      id: body.credentialId,
      publicKey: recoveredPublicKey,
      rpId: body.rpId,
    }) as Hex

    // Store the recovered passkey
    const stored = store.storePasskey({
      id: body.credentialId,
      publicKey: recoveredPublicKey,
      rpId: body.rpId,
      userHandle: body.userHandle,
      smartAccountAddress,
    })

    if (!stored) {
      console.warn('Failed to store recovered passkey - may already exist')
    }

    console.log('✅ Passkey recovered and registered successfully:', {
      credentialId: body.credentialId.slice(0, 16) + '...',
      publicKey: recoveredPublicKey.slice(0, 20) + '...',
      smartAccountAddress,
    })

    return NextResponse.json({
      success: true,
      credentialId: body.credentialId,
      publicKey: recoveredPublicKey,
      smartAccountAddress,
      message: 'Passkey recovered and registered successfully',
    })

  } catch (error: any) {
    console.error('Recovery error:', error)
    return NextResponse.json(
      { error: error.message || 'Recovery failed' },
      { status: 500 }
    )
  }
}
