/**
 * POST /api/passkey/migrate
 * Migrate a localStorage-only passkey to server storage with signature verification
 * 
 * This endpoint is for users who have passkeys in localStorage but not on server
 * (e.g. users from before server storage was reliable, or whose registration failed silently).
 * 
 * Body: {
 *   credentialId: string
 *   publicKey: Hex (0x04||x||y format)
 *   rpId: string
 *   userHandle: string
 *   smartAccountAddress: Hex
 *   challenge: Hex (fresh challenge from /api/passkey/challenge?type=authentication)
 *   authenticatorData: string (base64url)
 *   clientDataJSON: string (base64url)
 *   signature: string (base64url)
 * }
 * 
 * Verification:
 * 1. Validates rpId against server-configured NEXT_PUBLIC_RP_ID
 * 2. Verifies P-256 signature against supplied publicKey
 * 3. Checks rpId, origin (WALLET_ALLOWED_ORIGINS), challenge in clientData
 * 4. Verifies authenticatorData rpIdHash, UP, and UV flags
 * 5. Validates challenge against stored unused challenge
 * 6. Stores passkey if verification succeeds and marks challenge used
 * 7. Refuses to overwrite existing different records
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

interface MigrateRequest {
  credentialId: string
  publicKey: Hex
  rpId: string
  userHandle: string
  smartAccountAddress: Hex
  challenge: Hex
  authenticatorData: string
  clientDataJSON: string
  signature: string
}

function getConfiguredRpId(): string {
  return process.env.NEXT_PUBLIC_RP_ID || 'localhost'
}

export async function POST(request: NextRequest) {
  const store = new PasskeyStore()

  try {
    // Rate limiting - stricter than registration (migration should be rare)
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (store.checkRateLimit(ip, '/api/passkey/migrate', 3, 300)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    const body: MigrateRequest = await request.json()

    // Validate required fields
    if (!body.credentialId || !body.publicKey || !body.rpId || !body.userHandle || 
        !body.smartAccountAddress || !body.challenge || !body.authenticatorData || 
        !body.clientDataJSON || !body.signature) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate rpId against server configuration (do not trust client)
    const configuredRpId = getConfiguredRpId()
    if (body.rpId !== configuredRpId) {
      return NextResponse.json(
        { error: 'Invalid RP ID' },
        { status: 400 }
      )
    }

    // Check if credential already exists - prevent overwrite of different records
    const existing = store.getPasskey(body.credentialId)
    if (existing) {
      // Check if it's the same key and address
      if (existing.publicKey !== body.publicKey || existing.smartAccountAddress !== body.smartAccountAddress) {
        return NextResponse.json(
          { error: 'Credential already exists with different key or address. Migration not needed.' },
          { status: 409 }
        )
      }
      // Same credential, return success (idempotent)
      return NextResponse.json({
        success: true,
        credentialId: body.credentialId,
        message: 'Credential already migrated',
      })
    }

    // Verify challenge exists, unused, and correct type
    const challengeRecord = store.getChallenge(body.challenge)
    if (!challengeRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired challenge' },
        { status: 400 }
      )
    }

    if (challengeRecord.type !== 'authentication') {
      return NextResponse.json(
        { error: 'Challenge type must be authentication for migration' },
        { status: 400 }
      )
    }

    // Parse and verify client data (includes origin allowlist check)
    let clientData
    try {
      clientData = parseClientDataJSON(body.clientDataJSON)
    } catch {
      return NextResponse.json(
        { error: 'Invalid client data JSON' },
        { status: 400 }
      )
    }
    
    const clientDataVerification = verifyClientData(
      clientData,
      'webauthn.get', // Migration uses authentication (get) ceremony
      body.challenge,
      configuredRpId
    )
    
    if (!clientDataVerification.valid) {
      console.error('Client data verification failed:', clientDataVerification.error)
      return NextResponse.json(
        { error: `Client data verification failed: ${clientDataVerification.error}` },
        { status: 400 }
      )
    }

    // Parse and verify authenticator data (rpIdHash, UP, UV)
    let authData
    try {
      authData = parseAuthenticatorData(body.authenticatorData)
    } catch {
      return NextResponse.json(
        { error: 'Invalid authenticator data' },
        { status: 400 }
      )
    }

    const authDataVerification = verifyAuthenticatorData(authData, configuredRpId, 0)
    if (!authDataVerification.valid) {
      return NextResponse.json(
        { error: `Authenticator data verification failed: ${authDataVerification.error}` },
        { status: 400 }
      )
    }

    // Verify signature against supplied public key
    const signatureValid = verifySignature(
      body.publicKey,
      body.signature,
      body.authenticatorData,
      body.clientDataJSON
    )
    
    if (!signatureValid) {
      console.error('Signature verification failed')
      return NextResponse.json(
        { error: 'Signature verification failed. Invalid passkey or tampered data.' },
        { status: 401 }
      )
    }

    // Store the passkey
    const stored = store.storePasskey({
      id: body.credentialId,
      publicKey: body.publicKey,
      rpId: configuredRpId,
      userHandle: body.userHandle,
      smartAccountAddress: body.smartAccountAddress,
    })

    if (!stored) {
      // This shouldn't happen since we checked above, but handle it gracefully
      console.warn('Failed to store passkey - may already exist')
    }

    // Mark challenge as used only after successful migration
    store.markChallengeUsed(body.challenge)

    console.log('✅ Passkey migrated successfully:', {
      credentialId: body.credentialId.slice(0, 16) + '...',
      smartAccountAddress: body.smartAccountAddress,
    })

    return NextResponse.json({
      success: true,
      credentialId: body.credentialId,
      message: 'Passkey migrated successfully',
    })

  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    )
  } finally {
    store.close()
  }
}
