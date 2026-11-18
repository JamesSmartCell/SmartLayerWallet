# Passkey Storage Audit - Root Cause Analysis

## Problem Statement
iPhone/Safari users lose their passkey after ~1 month. Safari ITP wipes localStorage/IndexedDB after 7 days without interaction, causing wallet to lose credential ID/public key even though the passkey still exists in iCloud Keychain.

## Root Cause Findings

### 1. Registration Swallows Server Storage Failures
**Location:** `src/components/wallet-provider-real.tsx:163-175`

```typescript
try {
  await backendService.registerPasskey({...})
} catch (error) {
  console.warn('Failed to register passkey on server:', error)
  // Continue anyway - passkey is stored locally  <-- PROBLEM!
}
```

**Issue:** If server registration fails, the passkey ONLY exists in localStorage. When Safari ITP wipes localStorage after 7 days, the passkey is gone from the app but still exists in iCloud Keychain, causing confusion.

### 2. Authentication Prioritizes localStorage Over Server
**Location:** `src/lib/passkey-real.ts:192-200`

```typescript
let credential = this.getStoredPasskey(assertion.id) // <-- Checks localStorage FIRST
if (!credential) {
  // Create partial credential - caller should fetch from server API
  credential = { id: assertion.id, publicKey: '0x' as Hex, rpId: this.rpId }
}
```

**Issue:** Authentication looks in localStorage FIRST, only falling back to server if not found. This means:
- Old passkeys that failed server registration still "work" from localStorage
- When Safari wipes localStorage, authentication fails even though server has the data

### 3. No True Discoverable Credentials
**Location:** `src/lib/passkey-real.ts:62-64`

```typescript
authenticatorSelection: {
  userVerification: 'required',
  residentKey: 'preferred',  // <-- Should be 'required'
```

**Location:** `src/lib/passkey-real.ts:169-174`

```typescript
if (options.credentialId) {
  publicKey.allowCredentials = [{ // <-- Always passes hint
    type: 'public-key',
    id: options.credentialId,
```

**Issue:** 
- `residentKey: 'preferred'` is weak - allows non-discoverable passkeys
- Authentication always passes `credentialId` hint, preventing true discoverable flow
- Cannot authenticate without localStorage (which stores the credentialId list)

### 4. User Session in localStorage
**Location:** `src/components/wallet-provider-real.tsx:178, 262, 274`

```typescript
localStorage.setItem('wallet_user', JSON.stringify(user))
```

**Issue:** Entire user session stored in localStorage, not derived from server data.

## Why Old Passkey Works Without Server Record

**Answer:** Lines 163-175 in wallet-provider-real.tsx wrap server registration in try-catch and continue on failure. The passkey is stored in localStorage (line 344 in passkey-real.ts), and authentication checks localStorage FIRST (line 192). So an old passkey works entirely from localStorage until Safari ITP wipes it.

## Solution Requirements

1. **Server-First Architecture:** Make server registration REQUIRED, not optional
2. **Zero LocalStorage Dependency:** Authentication must work with cleared localStorage
3. **True Discoverable Credentials:** Use `residentKey: 'required'` and no `allowCredentials`
4. **Server as Source of Truth:** Fetch public key/address from server, not localStorage
5. **Migration Path:** Upload localStorage-only passkeys to server with signature verification
6. **Clear Error Messages:** Tell users to re-register if neither localStorage nor server has data
