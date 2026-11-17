/**
 * GET /api/passkey/[credentialId]
 * Retrieve a passkey by credential ID
 * 
 * Used for cross-device recovery - when a passkey exists locally but public key is missing
 */

import { NextRequest, NextResponse } from 'next/server'
import { PasskeyStore } from '@/lib/passkey-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ credentialId: string }> }
) {
  const store = new PasskeyStore()

  try {
    const { credentialId } = await params

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (store.checkRateLimit(ip, '/api/passkey/get', 20, 60)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    if (!credentialId) {
      return NextResponse.json(
        { error: 'Credential ID required' },
        { status: 400 }
      )
    }

    const passkey = store.getPasskey(credentialId)
    if (!passkey) {
      return NextResponse.json(
        { error: 'Passkey not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      credentialId: passkey.id,
      publicKey: passkey.publicKey,
      rpId: passkey.rpId,
      smartAccountAddress: passkey.smartAccountAddress,
      userHandle: passkey.userHandle,
      createdAt: passkey.createdAt.toISOString(),
      lastUsed: passkey.lastUsed.toISOString(),
    })
  } catch (error) {
    console.error('Passkey retrieval error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve passkey' },
      { status: 500 }
    )
  } finally {
    store.close()
  }
}
