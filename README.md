# SmartLayerWallet

A self-hosted passkey wallet for controlling and reading telemetry from embedded ESP32 devices (GarageDoor NFT-gated firmware and camera).

## Overview

SmartLayerWallet is a Progressive Web App (PWA) that uses WebAuthn passkeys for authentication and ERC-4337 Account Abstraction for blockchain transactions. It runs as a long-lived Node.js server with server-side passkey storage, enabling:

- **Garage Door Control**: NFT-gated ESP32 firmware control via SmartLayerProxy
- **Camera Access**: Live camera feed and HLS streaming via the `/cam-gate` route
- **Passkey Authentication**: WebAuthn-based authentication with no seed phrases
- **Smart Wallet**: Coinbase Smart Wallet (ERC-4337) on Base Sepolia
- **Cross-Device Sync**: Server-side SQLite storage for passkey recovery

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      SmartLayerWallet                        │
│  (wallet.percolate.one - Next.js 15 on Node.js)              │
├──────────────────────────────────────────────────────────────┤
│  Passkey Auth (WebAuthn)  │  Smart Account (ERC-4337)        │
│  - Server-side storage    │  - Coinbase Smart Wallet         │
│  - SQLite database        │  - Base Sepolia                  │
│  - Challenge/response     │  - Bundler + Paymaster           │
└──────────────────────────────────────────────────────────────┘
          │                              │
          │                              ▼
          │                   ┌──────────────────┐
          │                   │  Base Blockchain │
          │                   │  - Smart Account │
          │                   │  - ERC20 tokens  │
          │                   └──────────────────┘
          ▼
┌────────────────────────┐
│  SmartLayerProxy       │
│  (proxy.percolate.one) │
│  - Garage door API     │
│  - ESP32 interface     │
└────────────────────────┘
          │
          ▼
┌────────────────────────┐
│  ESP32 Devices         │
│  - GarageDoor (NFT)    │
│  - Camera (Pi + ESP32) │
└────────────────────────┘
```

## Tech Stack

- **Framework**: Next.js 15 (App Router) - runs as Node.js server
- **Language**: TypeScript
- **Styling**: TailwindCSS + Radix UI
- **Auth**: WebAuthn via @github/webauthn-json + webauthn-p256
- **Blockchain**: viem + permissionless (ERC-4337 Account Abstraction)
- **Smart Wallet**: Coinbase Smart Wallet
- **Storage**: better-sqlite3 (server-side passkey persistence)
- **Camera**: hls.js for HLS streaming, MJPEG for live feed

## Features

### Passkey Authentication
- No seed phrases or private keys in browser
- WebAuthn platform authenticators (Face ID, Touch ID, Windows Hello)
- Cross-device recovery via server-side storage
- Support for Microsoft/Windows Hello quirks and workarounds

### Smart Wallet
- Counterfactual ERC-4337 smart account (Coinbase)
- Gas sponsorship via Coinbase Paymaster on Base Sepolia
- Send/receive ETH and ERC20 tokens
- Add owners to multi-owner accounts

### Garage Door
- NFT-gated access control
- Challenge-response authentication with ESP32
- Control via SmartLayerProxy at proxy.percolate.one

### Camera
- Live MJPEG stream at `/cam-gate/live/mjpeg`
- HLS stream at `/cam-gate/hls/stream.m3u8`
- Snapshots at `/cam-gate/snapshot/latest.jpg`
- Proxied via server-https.js to Raspberry Pi camera

## Setup

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Environment Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Server-Side Environment Variables

**Required**:
- `CDP_API_KEY`: Coinbase CDP API key for ERC-4337 bundler/paymaster (get from [Coinbase Developer Platform](https://portal.cdp.coinbase.com/))
  - **Server-side only** - never exposed to client
  - Proxied via `/api/bundler/[chainId]` route

**Optional**:
- `WALLET_DB_PATH`: Path to SQLite database (defaults to `./data/wallet.db`)
- `WALLET_ALLOWED_ORIGINS`: Comma-separated allowed WebAuthn origins (defaults to `https://<rpId>` and localhost)
- `CUSTOM_RPC_URL_<CHAIN_ID>`: Custom RPC URL per chain (e.g. `CUSTOM_RPC_URL_84532` for Base Sepolia)
- `CDP_BUNDLER_URL_<CHAIN_ID>`: Custom bundler URL per chain (overrides default Coinbase endpoints)

### Client-Side Environment Variables

**Optional**:
- `NEXT_PUBLIC_RP_ID`: WebAuthn Relying Party ID (auto-detected from hostname)
- `NEXT_PUBLIC_GARAGE_DOOR_NFT_ADDRESS`: Garage door NFT contract address
- `NEXT_PUBLIC_IOT_DEVICE_ADDRESS`: Garage door ESP32 device address
- `NEXT_PUBLIC_IOT_CAMERA_ADDRESS`: Camera ESP32 device address
- `NEXT_PUBLIC_GARAGE_API_BASE`: SmartLayerProxy base URL
- `NEXT_PUBLIC_GARAGE_ADMIN_ADDRESSES`: Comma-separated admin addresses
- `NEXT_PUBLIC_CAMERA_GATE_URL`: Camera gate path (defaults to `/cam-gate`)

### Database Initialization

The SQLite database is created automatically on first run at the path specified by `WALLET_DB_PATH`. The schema includes:

- `passkeys`: Credential storage (id, public_key, rp_id, user_handle, address, timestamps, sign_count)
- `challenges`: WebAuthn challenge storage with expiry and single-use enforcement
- `rate_limits`: Simple per-IP rate limiting for API routes

## Running

### Development

```bash
npm run dev
```

Opens at `http://localhost:8089`

### Production

Build and run:

```bash
npm run build
npm run start
```

Runs Next.js on port 8088.

### HTTPS with server-https.js

For production deployment with TLS:

```bash
# Set certificate paths (or use defaults for Let's Encrypt at /etc/letsencrypt/live/wallet.percolate.one/)
export SSL_CERT=/path/to/fullchain.pem
export SSL_KEY=/path/to/privkey.pem

# Run HTTPS proxy (port 8089 -> Next.js on 8088)
npm run start:https
```

The HTTPS proxy:
- Serves Next.js on port 8089 (configurable via `PORT`)
- Proxies `/cam-gate/*` to Raspberry Pi camera (default: `http://127.0.0.1:8787`)
- Allows unlimited streaming timeouts for camera feeds

### RPC Configuration

SmartLayerWallet uses **@smarttokenlabs/waterfall-rpc** for all read-only blockchain access:
- Automatic fallback between RPC providers
- Web-based caching for faster reads
- Connection pooling

The wallet creates cached waterfall clients per chain in `src/lib/rpc.ts`. Custom RPC URLs can be provided via `CUSTOM_RPC_URL_<CHAIN_ID>` env vars.

### Bundler/Paymaster Proxy

The CDP API key is kept server-side. Client requests go through `/api/bundler/[chainId]` which:
- Allowlists only ERC-4337 and paymaster methods
- Rate limits per IP (30 req/min)
- Proxies to Coinbase CDP bundler endpoints

Allowlisted methods: `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_getUserOperationByHash`, `eth_supportedEntryPoints`, `eth_chainId`, `pm_*`

## API Routes

### Passkey API

All routes enforce rate limiting and challenge expiry.

#### `GET /api/passkey/challenge`

Create a new WebAuthn challenge.

Query params:
- `type`: `registration` or `authentication` (default: `authentication`)

Response:
```json
{
  "challenge": "0x...",
  "expiresAt": "2024-01-01T00:00:00.000Z"
}
```

#### `POST /api/passkey/register`

Register a new passkey.

Body:
```json
{
  "credentialId": "...",
  "publicKey": "0x04...",
  "rpId": "percolate.one",
  "userHandle": "user@example.com",
  "smartAccountAddress": "0x...",
  "challenge": "0x...",
  "attestationObject": "...",
  "clientDataJSON": "..."
}
```

Response:
```json
{
  "success": true,
  "credentialId": "..."
}
```

#### `POST /api/passkey/authenticate`

Authenticate with a passkey.

Body:
```json
{
  "credentialId": "...",
  "challenge": "0x...",
  "authenticatorData": "...",
  "clientDataJSON": "...",
  "signature": "..."
}
```

Response:
```json
{
  "success": true,
  "credentialId": "...",
  "publicKey": "0x04...",
  "smartAccountAddress": "0x...",
  "userHandle": "..."
}
```

#### `GET /api/passkey/[credentialId]`

Retrieve passkey by credential ID (for cross-device recovery).

Response:
```json
{
  "credentialId": "...",
  "publicKey": "0x04...",
  "rpId": "percolate.one",
  "smartAccountAddress": "0x...",
  "userHandle": "...",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "lastUsed": "2024-01-01T00:00:00.000Z"
}
```

## Passkey Server-Side Storage

Passkeys are stored server-side in SQLite to enable cross-device recovery and multi-browser support.

### Storage Schema

Each passkey record contains:
- Credential ID
- Public key (P-256 in 0x04||x||y format)
- RP ID (Relying Party ID)
- User handle (username/email)
- Smart account address (ERC-4337 account)
- Created/last-used timestamps
- Sign counter (WebAuthn counter)

### Challenge Management

Challenges are:
- Generated server-side with crypto.randomBytes
- Valid for 5 minutes (configurable TTL)
- Single-use (marked as used after verification)
- Automatically cleaned up on expiry

### Rate Limiting

Simple per-IP rate limiting:
- Challenge endpoint: 20 requests/minute
- Register endpoint: 5 requests/5 minutes
- Authenticate endpoint: 10 requests/minute
- Get passkey endpoint: 20 requests/minute

### Migration from Existing Passkeys

If you have existing passkeys in localStorage from an external backend:

1. On first login with the new system, the client will detect missing server-side passkeys
2. The passkey will be automatically upserted to the server
3. Subsequent logins on other devices will load from the server

Note: This is a one-way migration. Old external backend passkeys are not deleted.

## Microsoft/Windows Hello Support

The wallet includes workarounds for Microsoft Authenticator and Windows Hello:

- Omits `authenticatorAttachment` to allow password manager passkeys
- Uses `residentKey: 'preferred'` instead of `'required'`
- Sets `requireResidentKey: false` for broader compatibility
- Handles Windows Hello certificate chain validation quirks
- Works around Edge-specific WebAuthn behavior

See `src/lib/passkey-real.ts` for implementation details.

## Camera Integration

The camera is accessed via the `/cam-gate` route proxied through `server-https.js`:

- `/cam-gate/live/mjpeg`: Live MJPEG stream
- `/cam-gate/hls/stream.m3u8`: HLS adaptive streaming
- `/cam-gate/snapshot/latest.jpg`: Latest snapshot
- `/cam-gate/challenge`: Get auth challenge from camera ESP32
- `/cam-gate/auth`: Authenticate with camera
- `/cam-gate/health`: Camera health check

The camera runs on a Raspberry Pi 5 connected via SSH reverse tunnel (default: `127.0.0.1:8787`).

## Deployment

### Production Deployment

1. Build the app:
```bash
npm run build
```

2. Set up systemd service for Next.js:
```ini
[Unit]
Description=SmartLayerWallet Next.js
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/smartlayer-wallet
Environment="NODE_ENV=production"
Environment="PORT=8088"
EnvironmentFile=/var/www/smartlayer-wallet/.env
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

3. Set up systemd service for HTTPS proxy:
```ini
[Unit]
Description=SmartLayerWallet HTTPS Proxy
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/smartlayer-wallet
Environment="NODE_ENV=production"
Environment="PORT=8089"
Environment="BACKEND_PORT=8088"
Environment="SSL_CERT=/etc/letsencrypt/live/wallet.percolate.one/fullchain.pem"
Environment="SSL_KEY=/etc/letsencrypt/live/wallet.percolate.one/privkey.pem"
EnvironmentFile=/var/www/smartlayer-wallet/.env
ExecStart=/usr/bin/node server-https.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

4. Enable and start services:
```bash
sudo systemctl enable smartlayer-wallet
sudo systemctl enable smartlayer-wallet-https
sudo systemctl start smartlayer-wallet
sudo systemctl start smartlayer-wallet-https
```

### TLS Certificates

Use Let's Encrypt with certbot:

```bash
sudo certbot certonly --standalone -d wallet.percolate.one
```

Certificates are stored at:
- `/etc/letsencrypt/live/wallet.percolate.one/fullchain.pem`
- `/etc/letsencrypt/live/wallet.percolate.one/privkey.pem`

## Development

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

### Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## Auto-Deploy to Raspberry Pi

SmartLayerWallet auto-deploys to a Raspberry Pi at `https://wallet.percolate.one` via GitHub Actions.

**Architecture:**
- **Caddy on Linode**: Terminates TLS (auto-managed via Let's Encrypt)
- **SSH reverse tunnel**: Linode port 9011 → Pi 127.0.0.1:8088
- **Next.js on Pi**: Listens on 127.0.0.1:8088 (no TLS)
- **Camera**: Accessed on LAN at 192.168.50.224:8787 via Next.js `/cam-gate` route
- **Service**: `smartlayer-wallet` (single systemd unit)
- **Database**: `./data/wallet.db` (SQLite passkeys, gitignored)

**Caddyfile (on Linode):**
```
wallet.percolate.one {
    reverse_proxy 127.0.0.1:9011
    request_body {
        max_size 10MB
    }
}
```

**SSH tunnel (on Pi):**
```bash
ssh -R 9011:127.0.0.1:8088 linode-wallet-tunnel
```

**Auto-deploy workflow:**
- Push to `main` triggers deployment on self-hosted Pi runner
- Runs: `git pull`, `npm ci`, `npm test`, `npm run build`, restart service
- Health check: waits for service to be active and responding on 127.0.0.1:8088

**One-time Pi setup:**

1. Clone repo to `/home/pi/dev/SmartLayerWallet`
2. Create `.env` from `.env.example` with production values (including `CAMERA_GATE_UPSTREAM`)
3. Install dependencies: `npm ci && npm run build`
4. Set up SSH reverse tunnel to Linode (systemd service)
5. Install `smartlayer-wallet` systemd service
6. Configure passwordless sudo for service restart
7. Set up GitHub Actions self-hosted runner with `smartlayer` label
8. Configure Caddy on Linode with reverse_proxy to 127.0.0.1:9011

**Detailed setup guide:** See [`deploy/README.md`](deploy/README.md) for complete step-by-step instructions.

**Database persistence:** The SQLite database at `./data/wallet.db` contains all passkey credentials and survives deploys. Back it up regularly.

**Logs:**

```bash
# View service logs
sudo journalctl -u smartlayer-wallet -f
sudo journalctl -u ssh-tunnel-wallet -f
```

## Project Structure

```
smartlayer-wallet/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main wallet UI
│   │   ├── layout.tsx            # Root layout
│   │   ├── globals.css           # Global styles
│   │   ├── cam-gate/             # Camera proxy route
│   │   └── api/
│   │       └── passkey/          # Passkey API routes
│   │           ├── challenge/
│   │           ├── register/
│   │           ├── authenticate/
│   │           └── [credentialId]/
│   ├── components/
│   │   ├── wallet-provider-real.tsx  # Wallet context provider
│   │   ├── network-provider.tsx      # Network switching
│   │   ├── portfolio.tsx             # Token balances
│   │   ├── activity.tsx              # Transaction history
│   │   ├── send-modal.tsx            # Send tokens
│   │   ├── receive-modal.tsx         # Receive address
│   │   ├── approve-modal.tsx         # Token approvals
│   │   ├── add-owner-modal.tsx       # Multi-owner support
│   │   ├── live-camera.tsx           # Camera feed component
│   │   └── ui/                       # Radix UI components
│   └── lib/
│       ├── passkey-real.ts           # WebAuthn service (with MS fixes)
│       ├── passkey-store.ts          # Server-side SQLite storage
│       ├── smart-account-real.ts     # ERC-4337 service
│       ├── recovery-api.ts           # Passkey server API client
│       ├── garage-door.ts            # Garage door control
│       ├── mjpeg-player.ts           # MJPEG streaming
│       ├── activity.ts               # Transaction history
│       ├── portfolio.ts              # Balance fetching
│       ├── explorer.ts               # Block explorer URLs
│       ├── env.ts                    # Environment config
│       └── utils.ts                  # Utilities
├── public/
│   └── manifest.json                 # PWA manifest
├── server-https.js                   # HTTPS proxy + camera gateway
├── .env.example                      # Environment template
├── data/                             # SQLite database (gitignored)
│   └── wallet.db
└── package.json

```

## Security

- **No private keys in browser**: Keys only exist in platform authenticators
- **Server-side storage**: Passkeys stored in SQLite with challenge expiry
- **Rate limiting**: Per-IP limits on all API routes
- **Challenge single-use**: Each challenge can only be used once
- **Domain-restricted API keys**: CDP keys restricted to specific domains
- **CSP headers**: Content Security Policy enabled
- **No seed phrases**: Passkey-only authentication

## Contract Addresses

### EntryPoint v0.6 (all networks)
`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`

### Coinbase Smart Wallet Factory (all networks)
`0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a`

## License

Private - All Rights Reserved

## Support

For issues or questions, contact the repository owner.
