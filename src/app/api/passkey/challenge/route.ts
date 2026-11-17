/**
 * GET /api/passkey/challenge
 * Create a new WebAuthn challenge for registration or authentication
 */

import { NextRequest, NextResponse } from 'next/server'
import { PasskeyStore } from '@/lib/passkey-store'

export async function GET(request: NextRequest) {
  const store = new PasskeyStore()

  try {
    const searchParams = request.nextUrl.searchParams
    const type = searchParams.get('type') as 'registration' | 'authentication' || 'authentication'

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (store.checkRateLimit(ip, '/api/passkey/challenge', 20, 60)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    const challenge = store.createChallenge(type, 300) // 5 minute TTL

    // Clean up old challenges periodically
    if (Math.random() < 0.1) {
      store.cleanupExpiredChallenges()
    }

    return NextResponse.json({
      challenge: challenge.challenge,
      expiresAt: challenge.expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('Challenge creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create challenge' },
      { status: 500 }
    )
  } finally {
    store.close()
  }
}
