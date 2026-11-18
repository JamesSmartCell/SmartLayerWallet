/**
 * Tests for P-256 public key recovery from WebAuthn signatures
 */

import { describe, it, expect } from 'vitest'
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha256'
import { recoverPublicKeys, findCommonKey, bytesToBase64Url } from '../p256-recovery'
import { Hex } from 'viem'

describe('P-256 Public Key Recovery', () => {
  function createWebAuthnSignature(
    privateKeyBytes: Uint8Array,
    authenticatorData: Uint8Array,
    clientDataJSON: Uint8Array
  ): { signature: string; publicKey: Hex } {
    const publicKeyPoint = p256.getPublicKey(privateKeyBytes, false)
    const publicKeyHex = '0x' + Array.from(publicKeyPoint).map(b => b.toString(16).padStart(2, '0')).join('') as Hex

    const clientDataHash = sha256(clientDataJSON)
    const message = new Uint8Array(authenticatorData.length + clientDataHash.length)
    message.set(authenticatorData, 0)
    message.set(clientDataHash, authenticatorData.length)
    const messageHash = sha256(message)

    const sig = p256.sign(messageHash, privateKeyBytes)
    const sigDER = sig.toDERRawBytes()
    const signatureBase64url = bytesToBase64Url(sigDER)

    return { signature: signatureBase64url, publicKey: publicKeyHex }
  }

  it('should recover correct public key from WebAuthn signature', () => {
    const privateKey = p256.utils.randomPrivateKey()
    const authenticatorData = new Uint8Array(37).fill(0xaa)
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({
      type: 'webauthn.get',
      challenge: 'test',
      origin: 'https://percolate.one'
    }))
    
    const { signature, publicKey } = createWebAuthnSignature(privateKey, authenticatorData, clientDataJSON)
    
    const candidates = recoverPublicKeys({
      signature,
      authenticatorData: bytesToBase64Url(authenticatorData),
      clientDataJSON: bytesToBase64Url(clientDataJSON),
    })
    
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.some(k => k.toLowerCase() === publicKey.toLowerCase())).toBe(true)
  })

  it('should find common key from two assertions', () => {
    const privateKey = p256.utils.randomPrivateKey()
    
    const auth1 = new Uint8Array(37).fill(0x11)
    const client1 = new TextEncoder().encode(JSON.stringify({
      type: 'webauthn.get',
      challenge: 'challenge-1',
      origin: 'https://percolate.one'
    }))
    
    const auth2 = new Uint8Array(37).fill(0x22)
    const client2 = new TextEncoder().encode(JSON.stringify({
      type: 'webauthn.get',
      challenge: 'challenge-2',
      origin: 'https://percolate.one'
    }))
    
    const sig1 = createWebAuthnSignature(privateKey, auth1, client1)
    const sig2 = createWebAuthnSignature(privateKey, auth2, client2)
    
    const candidates1 = recoverPublicKeys({
      signature: sig1.signature,
      authenticatorData: bytesToBase64Url(auth1),
      clientDataJSON: bytesToBase64Url(client1),
    })
    
    const candidates2 = recoverPublicKeys({
      signature: sig2.signature,
      authenticatorData: bytesToBase64Url(auth2),
      clientDataJSON: bytesToBase64Url(client2),
    })
    
    const recoveredKey = findCommonKey(candidates1, candidates2)
    
    expect(recoveredKey).toBeTruthy()
    expect(recoveredKey?.toLowerCase()).toBe(sig1.publicKey.toLowerCase())
  })
})
