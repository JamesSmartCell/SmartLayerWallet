# Passkey Storage Audit - Root Cause Analysis

## Problem Statement
iPhone/Safari users lose their passkey after ~1 month. Safari ITP wipes localStorage/IndexedDB after 7 days without interaction, causing wallet to lose credential ID/public key even though the passkey still exists in iCloud Keychain.

## TRUE Root Cause - Server Registration Always Failed

### Registration Never Sent Attestation Data
**Location:** `src/components/wallet-provider-real.tsx:165-172` (before fix)

```typescript
await backendService.registerPasskey({
  credentialId: credential.id,
  publicKey: credential.publicKey,
  rpId: state.rpId,
  userHandle: username,
  smartAccountAddress: walletAddress,
  challenge,
  // ❌ MISSING: attestationObject, clientDataJSON
})
```

**Location:** `/api/passkey/register/route.ts:53-59`

```typescript
if (!body.credentialId || !body.publicKey || !body.rpId || !body.userHandle || 
    !body.smartAccountAddress || !body.challenge || !body.attestationObject || !body.clientDataJSON) {
  return NextResponse.json(
    { error: 'Missing required fields' },
    { status: 400 }
  )
}
```

**THE REAL ISSUE:** 
- `passkeyService.create()` returned only `PasskeyCredential` (id + publicKey)
- Registration call to server never included `attestationObject` or `clientDataJSON`
- Server API `/api/passkey/register` **requires both fields** for WebAuthn verification
- Server registration returned **400 Bad Request: "Missing required fields"**
- Error was silently swallowed by try-catch with `console.warn`
- Result: **EVERY passkey registration has always failed server-side**
- **ALL passkeys are localStorage-only**, explaining why server DB is empty
- When Safari ITP wipes localStorage, users lose access even though passkey exists in iCloud

### Why It Seemed To Work
Registration appeared successful because:
1. Local passkey creation succeeded (WebAuthn API worked)
2. Passkey was stored in localStorage
3. Server registration error was silently ignored
4. Login checked localStorage first, so it worked...until Safari ITP wiped it

### Secondary Issues Found

#### 2. Fallback to Local Challenge Cannot Verify
**Location:** `src/components/wallet-provider-real.tsx:140-143` (before fix)

```typescript
} catch (error) {
  console.warn('Failed to get challenge from backend, using local:', error)
  challenge = PasskeyService.generateChallenge()
}
```

**Issue:** If server challenge fails, code falls back to locally-generated challenge. But server-side WebAuthn verification REQUIRES the challenge it issued. A local challenge will always fail verification, so this fallback just delays the failure.

#### 3. Migration Path Was Insecure
**Issue:** Original migration attempt called `registerPasskey` with no attestation (would 400), and reused login challenge (type 'authentication' but route requires 'registration'). Deriving smart account address is not proof of possession.

**Fix:** New `/api/passkey/migrate` endpoint that:
- Takes a fresh WebAuthn assertion (authenticatorData, clientDataJSON, signature)
- Verifies P-256 signature against supplied publicKey
- Checks rpId, origin, challenge
- Only stores passkey after signature verification succeeds

#### 4. Database Directory Not Auto-Created
**Issue:** Production Pi logs showed `TypeError: Cannot open database because the directory does not exist` for `WALLET_DB_PATH=./data/wallet.db` when `data/` dir was missing.

**Fix:** PasskeyStore constructor now calls `fs.mkdirSync(dirname, {recursive:true})` before opening SQLite database.

## Solution Requirements

1. **Server-First Architecture:** Make server registration REQUIRED, not optional
2. **Zero LocalStorage Dependency:** Authentication must work with cleared localStorage
3. **True Discoverable Credentials:** Use `residentKey: 'required'` and no `allowCredentials`
4. **Server as Source of Truth:** Fetch public key/address from server, not localStorage
5. **Migration Path:** Upload localStorage-only passkeys to server with signature verification
6. **Clear Error Messages:** Tell users to re-register if neither localStorage nor server has data
