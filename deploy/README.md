# Raspberry Pi Deployment Guide

This guide covers deploying SmartLayerWallet to a Raspberry Pi with auto-deploy via GitHub Actions.

## Overview

- **Repository path**: `/home/pi/dev/SmartLayerWallet`
- **User**: `pi`
- **Public URL**: https://wallet.percolate.one
- **Next.js backend**: http://127.0.0.1:8088
- **HTTPS proxy**: https://127.0.0.1:8089 (or external port 443)
- **Services**: `smartlayer-wallet` (Next.js) + `smartlayer-wallet-https` (HTTPS proxy)
- **Database**: `./data/wallet.db` (SQLite, gitignored, survives deploys)

## One-Time Setup on Raspberry Pi

### 1. Install System Dependencies

```bash
# Essential build tools (needed for better-sqlite3 native compilation on arm64)
sudo apt update
sudo apt install -y build-essential python3 git

# Node.js 20+ (if not already installed)
# Option A: Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Option B: Using nvm (if you prefer version management)
# curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
# source ~/.bashrc
# nvm install 20
# nvm use 20
```

### 2. Clone Repository

```bash
mkdir -p /home/pi/dev
cd /home/pi/dev
git clone https://github.com/JamesSmartCell/SmartLayerWallet.git
cd SmartLayerWallet
git checkout main
```

### 3. Create Environment File

Copy and configure `.env` from the example:

```bash
cp .env.example .env
nano .env
```

Required environment variables in `.env`:

```env
# ===== SERVER-SIDE ONLY =====
# Coinbase CDP API Key (required for ERC-4337 bundler/paymaster)
# Get from https://portal.cdp.coinbase.com/
# Server-side only - proxied via /api/bundler/[chainId]
CDP_API_KEY=your_coinbase_api_key_here

# Server-side SQLite database path (for passkey storage)
WALLET_DB_PATH=./data/wallet.db

# Allowed origins for WebAuthn (comma-separated)
# Defaults to https://<rpId> and localhost:* for development
WALLET_ALLOWED_ORIGINS=https://percolate.one,https://wallet.percolate.one

# Optional: Custom RPC URL per chain (server-side reads via waterfall-rpc)
# CUSTOM_RPC_URL_84532=https://base-sepolia.g.alchemy.com/v2/your_key
# CUSTOM_RPC_URL_8453=https://base-mainnet.g.alchemy.com/v2/your_key

# Optional: Custom CDP bundler URL per chain
# CDP_BUNDLER_URL_84532=https://custom-bundler.example.com/base-sepolia

# ===== CLIENT-SIDE (NEXT_PUBLIC_*) =====
# WebAuthn RP ID (auto-detected from hostname if not set)
# For production: percolate.one
NEXT_PUBLIC_RP_ID=percolate.one

# Garage Door NFT Configuration
NEXT_PUBLIC_GARAGE_DOOR_NFT_ADDRESS=0x3158e836ec0e85A46f7a7208d91EA9837A0C6ccC
NEXT_PUBLIC_IOT_DEVICE_ADDRESS=0xb1a6929c36c0ad999806a96dfe718777e650f395
NEXT_PUBLIC_IOT_CAMERA_ADDRESS=0x38Ba3A68D4460Cf4747A0303D8e2C106cFF68F3f
NEXT_PUBLIC_GARAGE_API_BASE=https://proxy.percolate.one/api
NEXT_PUBLIC_GARAGE_ADMIN_ADDRESSES=0xC067A53c91258ba513059919E03B81CF93f57Ac7,0x7e4b1da13c4a2a73fd05e928a6ed81b0a5d3007b

# Camera gate URL (proxied via server-https.js)
NEXT_PUBLIC_CAMERA_GATE_URL=/cam-gate

# Optional: Custom ERC-4337 contract addresses
# NEXT_PUBLIC_ENTRY_POINT=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
# NEXT_PUBLIC_ACCOUNT_FACTORY=0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a
```

### 4. Create Data Directory

```bash
mkdir -p /home/pi/dev/SmartLayerWallet/data
# The wallet.db file will be created automatically on first use
```

### 5. Install Dependencies and Build

```bash
cd /home/pi/dev/SmartLayerWallet
npm ci
npm run build
```

**Note**: `better-sqlite3` compiles natively during `npm ci` on arm64. If you see compilation errors, ensure `build-essential` and `python3` are installed (step 1).

### 6. Set Up SSL Certificates

Use Let's Encrypt certbot to obtain certificates:

```bash
# Install certbot
sudo apt install -y certbot

# Obtain certificate (standalone mode - requires port 80/443 to be free temporarily)
sudo certbot certonly --standalone -d wallet.percolate.one

# Certificates will be at:
# /etc/letsencrypt/live/wallet.percolate.one/fullchain.pem
# /etc/letsencrypt/live/wallet.percolate.one/privkey.pem
```

**Make certificates readable by user `pi`:**

**Option 1 - ACL (recommended):**

```bash
sudo setfacl -R -m u:pi:rX /etc/letsencrypt/live
sudo setfacl -R -m u:pi:rX /etc/letsencrypt/archive

# Verify access
sudo -u pi cat /etc/letsencrypt/live/wallet.percolate.one/fullchain.pem
```

**Option 2 - Deploy hook to copy certs:**

```bash
sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/copy-wallet-certs.sh > /dev/null <<'EOF'
#!/bin/bash
mkdir -p /home/pi/dev/SmartLayerWallet/certs
cp /etc/letsencrypt/live/wallet.percolate.one/fullchain.pem /home/pi/dev/SmartLayerWallet/certs/
cp /etc/letsencrypt/live/wallet.percolate.one/privkey.pem /home/pi/dev/SmartLayerWallet/certs/
chown pi:pi /home/pi/dev/SmartLayerWallet/certs/*.pem
chmod 600 /home/pi/dev/SmartLayerWallet/certs/*.pem
systemctl restart smartlayer-wallet-https
EOF

sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/copy-wallet-certs.sh
sudo /etc/letsencrypt/renewal-hooks/deploy/copy-wallet-certs.sh

# If using this option, edit the service file SSL_CERT/SSL_KEY paths to:
# /home/pi/dev/SmartLayerWallet/certs/fullchain.pem
# /home/pi/dev/SmartLayerWallet/certs/privkey.pem
```

### 7. Install Systemd Services

```bash
cd /home/pi/dev/SmartLayerWallet

# Copy service files to systemd directory
sudo cp deploy/smartlayer-wallet.service /etc/systemd/system/
sudo cp deploy/smartlayer-wallet-https.service /etc/systemd/system/

# If using nvm, edit the service files to use your node path:
# sudo nano /etc/systemd/system/smartlayer-wallet.service
# sudo nano /etc/systemd/system/smartlayer-wallet-https.service
# Change ExecStart to: /home/pi/.nvm/versions/node/v20.x.x/bin/node ...

# Reload systemd
sudo systemctl daemon-reload

# Enable services to start on boot
sudo systemctl enable smartlayer-wallet
sudo systemctl enable smartlayer-wallet-https

# Start services
sudo systemctl start smartlayer-wallet
sudo systemctl start smartlayer-wallet-https

# Check status
sudo systemctl status smartlayer-wallet
sudo systemctl status smartlayer-wallet-https
```

### 8. Configure Passwordless Sudo for Deploy Workflow

The GitHub Actions deploy workflow needs to restart services without a password prompt:

```bash
# Get full path to systemctl
which systemctl
# Output: /usr/bin/systemctl (or /bin/systemctl)

# Create sudoers drop-in file
sudo visudo -f /etc/sudoers.d/smartlayer-wallet-deploy
```

Add this line (use the actual systemctl path from `which systemctl`):

```
pi ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart smartlayer-wallet, /usr/bin/systemctl restart smartlayer-wallet-https
```

Save and exit. Verify the configuration:

```bash
sudo visudo -c
# Should output: /etc/sudoers.d/smartlayer-wallet-deploy: parsed OK

# Test passwordless restart
sudo systemctl restart smartlayer-wallet
sudo systemctl restart smartlayer-wallet-https
```

If prompted for a password, double-check the systemctl path and the sudoers syntax.

### 9. Set Up GitHub Actions Self-Hosted Runner

Register the Pi as a self-hosted runner with the `smartlayer` label:

1. Go to your GitHub repository → Settings → Actions → Runners → New self-hosted runner
2. Follow the instructions to download and configure the runner on the Pi
3. **Important**: Add the `smartlayer` label when configuring the runner
4. Install the runner as a service so it starts on boot:

```bash
cd /path/to/actions-runner
sudo ./svc.sh install
sudo ./svc.sh start
```

### 10. Network Configuration

Ensure port 8089 (or 443) is accessible externally:

- **Router port forwarding**: Forward external port 443 → Pi's 8089
- **Cloudflare Tunnel**: Set up a tunnel pointing to `https://127.0.0.1:8089`
- **Direct exposure**: If the Pi has a public IP, ensure firewall allows 8089

Verify DNS:

```bash
dig +short wallet.percolate.one
# Should resolve to your Pi's public IP or Cloudflare proxy
```

### 11. First Deploy

Trigger the deploy workflow manually to verify everything works:

1. Go to GitHub repository → Actions → Deploy wallet
2. Click "Run workflow" → Select branch `main` → Run workflow
3. Monitor the workflow output

Or push a commit to `main`:

```bash
git push origin main
```

The workflow will:
1. Pull latest code on the Pi
2. Install dependencies (`npm ci`)
3. Run tests (`npm test` = lint + type-check)
4. Build the app (`npm run build`)
5. Restart both services
6. Health check: wait up to 30s for services to be active and responding

## Maintenance

### View Logs

```bash
# Real-time logs
sudo journalctl -u smartlayer-wallet -f
sudo journalctl -u smartlayer-wallet-https -f

# Last 100 lines
sudo journalctl -u smartlayer-wallet -n 100
sudo journalctl -u smartlayer-wallet-https -n 100
```

### Manual Restart

```bash
sudo systemctl restart smartlayer-wallet
sudo systemctl restart smartlayer-wallet-https
```

### Check Service Status

```bash
systemctl status smartlayer-wallet
systemctl status smartlayer-wallet-https
```

### Update Certificates

Certbot auto-renews certificates. If using the deploy hook (Option 2), certs are automatically copied and services restarted on renewal.

### Database Backups

The SQLite database at `./data/wallet.db` contains all passkey credentials. Back it up regularly:

```bash
# Manual backup
cp /home/pi/dev/SmartLayerWallet/data/wallet.db /home/pi/backups/wallet.db.$(date +%Y%m%d)

# Or set up a cron job
crontab -e
# Add: 0 2 * * * cp /home/pi/dev/SmartLayerWallet/data/wallet.db /home/pi/backups/wallet.db.$(date +\%Y\%m\%d)
```

## Troubleshooting

### Service Won't Start

```bash
# Check service status
sudo systemctl status smartlayer-wallet

# View detailed logs
sudo journalctl -u smartlayer-wallet -n 50

# Common issues:
# - Missing .env file
# - Wrong Node.js path (if using nvm)
# - Port already in use
# - Missing dependencies (run npm ci)
```

### HTTPS Service Fails

```bash
# Check if Next.js backend is running
curl http://127.0.0.1:8088/

# Check certificate permissions
sudo -u pi cat /etc/letsencrypt/live/wallet.percolate.one/fullchain.pem

# View HTTPS service logs
sudo journalctl -u smartlayer-wallet-https -n 50
```

### GitHub Actions Deploy Fails

```bash
# Check runner status on the Pi
cd /path/to/actions-runner
./run.sh

# Verify sudo permissions
sudo systemctl restart smartlayer-wallet

# Check if repository is clean
cd /home/pi/dev/SmartLayerWallet
git status
git pull --ff-only
```

### Database Not Persisting

Ensure `./data/wallet.db` is gitignored and not deleted during deploys:

```bash
ls -la /home/pi/dev/SmartLayerWallet/data/wallet.db
# Should exist after first use

git check-ignore ./data/wallet.db
# Should output: ./data/wallet.db
```

### Build Failures

```bash
# Clear node_modules and rebuild
cd /home/pi/dev/SmartLayerWallet
rm -rf node_modules .next
npm ci
npm run build
```

## Security Notes

- **Never commit `.env`** - it contains API keys and secrets
- **Database contains passkey credentials** - back up `./data/wallet.db` securely
- **Restrict sudo permissions** - only allow specific systemctl restart commands
- **Keep certificates accessible** - but limit to user `pi` only
- **Monitor logs** - watch for failed authentication attempts or errors
