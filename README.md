# wallet.percolate.one

Unified passkey-based smart wallet based on the OpenPasskey ecosystem.

## Overview

A cross-app asset management wallet built on ERC-4337 Account Abstraction using Coinbase Smart Wallet contracts. Users authenticate with passkeys (WebAuthn) instead of seed phrases.

**Live URL:** `https://wallet.openpasskey.com`

## Features

- **Passkey Authentication** - No seed phrases, powered by WebAuthn
- **Smart Wallet** - ERC-4337 Account Abstraction with Coinbase contracts
- **Cross-Device Sync** - Recovery API for credential synchronization
- **Gas Strategies** - User-pays, sponsored, or automatic mode
- **Base Networks** - Supports Base Mainnet and Base Sepolia
- **Portfolio View** - All loyalty token balances across merchants
- **Send/Receive** - Transfer ETH and ERC20 tokens

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: TailwindCSS
- **Blockchain**: viem + permissionless (Account Abstraction)
- **Smart Wallet**: Coinbase Smart Wallet (ERC-4337)
- **Auth**: WebAuthn via @github/webauthn-json + webauthn-p256
- **State**: Wagmi + TanStack Query

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    wallet.openpasskey.com                       │
├─────────────────────────────────────────────────────────────────┤
│  Passkey Service          │  Smart Account Service              │
│  - WebAuthn registration  │  - Coinbase Smart Wallet            │
│  - WebAuthn authentication│  - UserOperation building           │
│  - Key extraction         │  - Bundler submission               │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐            ┌─────────────────────┐
    │  Recovery API   │            │   Base Blockchain   │
    │                 │            │                     │
    │  - Key backup   │            │  - Token registry   │
    │  - Cross-device │            │  - ERC20 transfers  │
    └─────────────────┘            │  - UserOp execution │
                                   └─────────────────────┘
```

## Smart Wallet Details

### Contracts (Same on all networks)

| Contract | Address |
|----------|---------|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| Coinbase Smart Wallet Factory | `0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842` |

### Token Registry

| Network | Address |
|---------|---------|
| Base Mainnet | `0x1510271D3b40fde9B5699b188FcbF973655E513E` |
| Base Sepolia | `0xe22d1DC8145F4B931CDf82245Ea53F1444360BF6` |

## Project Structure

```
wallet.openpasskey.com/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main wallet UI
│   │   ├── layout.tsx            # Root layout
│   │   └── globals.css           # Global styles
│   ├── components/
│   │   ├── passkey-wallet-demo.tsx
│   │   ├── real-passkey-wallet-demo.tsx
│   │   ├── wallet-provider.tsx
│   │   ├── wallet-provider-real.tsx
│   │   ├── portfolio.tsx         # Token balances
│   │   ├── activity.tsx          # Transaction history
│   │   ├── send-modal.tsx        # Send tokens
│   │   ├── receive-modal.tsx     # Receive address
│   │   ├── approve-modal.tsx     # Token approvals
│   │   └── ui/                   # shadcn components
│   └── lib/
│       ├── passkey-real.ts       # WebAuthn service
│       ├── smart-account-real.ts # ERC-4337 service
│       ├── recovery-api.ts       # Key recovery
│       ├── portfolio.ts          # Balance fetching
│       ├── activity.ts           # Transaction history
│       ├── pricing.ts            # Token prices
│       └── env.ts                # Environment config
├── docs/
│   └── wallet.openpasskey.com-PRD.md
└── public/
    └── manifest.json             # PWA manifest
```

## Key Services

### PasskeyService (`lib/passkey-real.ts`)

Handles WebAuthn credential creation and authentication:

```typescript
class PasskeyService {
  // Create new passkey credential
  async create(options: { username: string; challenge: Hex }): Promise<PasskeyCredential>
  
  // Authenticate with existing passkey
  async authenticate(options: { challenge: Hex; credentialId?: string }): Promise<{
    credential: PasskeyCredential | null
    signature: any
    webauthn: any
  }>
}
```

### SmartAccountService (`lib/smart-account-real.ts`)

ERC-4337 smart wallet operations:

```typescript
class SmartAccountService {
  // Create Coinbase Smart Account from passkey
  async createSmartAccount(credential: PasskeyCredential): Promise<SmartAccount>
  
  // Send UserOperation
  async sendTransaction(credential: PasskeyCredential, calls: UserOperationCall[]): Promise<Hex>
  
  // ERC20 operations
  async sendErc20(credential, token, to, amount): Promise<Hex>
  async approveErc20(credential, token, spender, amount): Promise<Hex>
  
  // Registry balance fetch
  async getRegistryBalances(user: Address): Promise<{ tokens: Address[]; balances: bigint[] }>
}
```

## User Flows

### New User

1. Click "Create New Passkey Wallet"
2. Browser creates WebAuthn credential
3. Public key extracted from attestation
4. Sync to Recovery API
5. Counterfactual address computed
6. Ready to receive funds

### Existing User

1. Click "Connect with Passkey"
2. WebAuthn authentication
3. Credential ID matched to stored key
4. Address derived from public key
5. Check deployment status
6. Ready to transact

### First Transaction

1. Build UserOperation with initCode (deploys wallet)
2. Apply gas strategy (auto/user/sponsored)
3. Sign with passkey
4. Submit to Coinbase bundler
5. Account deployed + transaction executed

## Gas Strategies

| Mode | Behavior |
|------|----------|
| `auto` | User-pays first, fallback to sponsored on insufficient funds |
| `user` | Always user-pays with own ETH |
| `sponsored` | Always use Coinbase Paymaster (if policy allows) |

## Development Setup

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Environment Configuration

Create `.env.local`:

```env
# Required: Coinbase CDP API key (domain-allowlisted)
NEXT_PUBLIC_CDP_API_KEY=pk_your_coinbase_api_key

# Optional (using defaults)
NEXT_PUBLIC_RP_ID=openpasskey.com
NEXT_PUBLIC_GAS_MODE=auto
NEXT_PUBLIC_RECOVERY_API_BASE=https://api.openpasskey.com
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build
npm run start
```

### Type Checking

```bash
npm run type-check
```

## Security

- **No private keys in browser** - Keys only exist in platform authenticator
- **Domain-allowlisted API keys** - CDP keys restricted to specific domains
- **Passkey-only signing** - No seed phrases or mnemonic exposure
- **CSP headers** - Content Security Policy enabled
- **Minimal PII logging** - Privacy-focused logging

## WebAuthn Configuration

```typescript
// Registration options
{
  rp: { id: 'openpasskey.com', name: 'Passkey Wallet' },
  authenticatorSelection: {
    authenticatorAttachment: 'platform',
    userVerification: 'required',
    residentKey: 'required'
  },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }] // ES256 (P-256)
}
```

## Integration with OpenPasskey

The wallet integrates with the OpenPasskey ecosystem by:

1. **Reading from LoyaltyRegistry** - Fetches all user token balances via paginated `getAllBalances()`
2. **ERC20 transfers** - Send loyalty tokens between users
3. **Shared rpId** - Uses `openpasskey.com` for cross-app passkey compatibility

## Related Repositories

| Repository | Description |
|------------|-------------|
| [token-kit](https://github.com/Open-Passkey/token-kit) | Backend APIs |
| [smartcontract](https://github.com/Open-Passkey/smartcontract) | Token contracts |
| [app.openpasskey.com](https://github.com/Open-Passkey/app.openpasskey.com) | Consumer mini-apps |
| [merchant.openpasskey.com](https://github.com/Open-Passkey/merchant.openpasskey.com) | Merchant portal |
