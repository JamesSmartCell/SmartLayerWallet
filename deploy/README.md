# Raspberry Pi Deployment Guide

This guide covers deploying SmartLayerWallet to a Raspberry Pi with auto-deploy via GitHub Actions.

## Overview

**New topology:** Caddy on Linode terminates TLS and reverse-proxies through an SSH reverse tunnel to Next.js on the Pi. No TLS on the Pi.

- **Repository path**: `/home/pi/dev/SmartLayerWallet`
- **User**: `pi`
- **Public URL**: https://wallet.percolate.one (Caddy on Linode with auto-TLS)
- **SSH tunnel**: Linode port 9011 → Pi 127.0.0.1:8088
- **Next.js**: Listens on 127.0.0.1:8088 (no TLS)
- **Camera**: Accessed on LAN at 192.168.50.224:8787 via Next.js `/cam-gate` route
- **Service**: `smartlayer-wallet` (single systemd unit, no HTTPS service)
- **Database**: `./data/wallet.db` (SQLite passkeys, gitignored, survives deploys)

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

# Option B: Using nvm (recommended if you need version management)
# curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
# source ~/.bashrc
# nvm install 24
# nvm use 24
```

**IMPORTANT for nvm users:** If you install node via nvm, systemd cannot find it via `/usr/bin/env node`. You MUST use the absolute path to node in the service file (see step 7).

### 2. Clone Repository

```bash
mkdir -p /home/pi/dev
cd /home/pi/dev
git clone https://github.com/JamesSmartCell/SmartLayerWallet.git
cd SmartLayerWallet
git checkout main
```

### 3. Create Environment File

Copy and configure `.env` from `.env.example`:

```bash
cp .env.example .env
nano .env
```

**Required environment variables in `.env`:**

```env
# Server-side CDP API Key (get from https://portal.cdp.coinbase.com/)
# WARNING: NEVER put this in a NEXT_PUBLIC_ variable
CDP_API_KEY=your_coinbase_api_key_here

# SQLite database path (passkey storage)
WALLET_DB_PATH=./data/wallet.db

# Allowed WebAuthn origins (production)
WALLET_ALLOWED_ORIGINS=https://wallet.percolate.one

# Camera upstream (LAN address)
CAMERA_GATE_UPSTREAM=http://192.168.50.224:8787

# WebAuthn RP ID (auto-detected, but can be explicit)
NEXT_PUBLIC_RP_ID=percolate.one

# Garage Door NFT/Device addresses
NEXT_PUBLIC_GARAGE_DOOR_NFT_ADDRESS=0x3158e836ec0e85A46f7a7208d91EA9837A0C6ccC
NEXT_PUBLIC_IOT_DEVICE_ADDRESS=0xb1a6929c36c0ad999806a96dfe718777e650f395
NEXT_PUBLIC_IOT_CAMERA_ADDRESS=0x38Ba3A68D4460Cf4747A0303D8e2C106cFF68F3f

# Garage API (SmartLayerProxy)
NEXT_PUBLIC_GARAGE_API_BASE=https://scriptproxy.percolate.one/api

# Admin addresses (comma-separated)
NEXT_PUBLIC_GARAGE_ADMIN_ADDRESSES=0xC067A53c91258ba513059919E03B81CF93f57Ac7,0x7e4b1da13c4a2a73fd05e928a6ed81b0a5d3007b
```

**IMPORTANT:** Systemd `EnvironmentFile` does NOT strip inline `#` comments. Your `.env` must have NO inline comments like `SOME_VAR=value # comment`. Put comments on separate lines only.

### 4. Create Data Directory

```bash
mkdir -p /home/pi/dev/SmartLayerWallet/data
# The wallet.db file will be created automatically on first passkey registration
```

### 5. Install Dependencies and Build

```bash
cd /home/pi/dev/SmartLayerWallet
npm ci
npm run build
```

**Note**: `better-sqlite3` compiles natively during `npm ci` on arm64. If you see compilation errors, ensure `build-essential` and `python3` are installed (step 1).

### 6. Set Up SSH Reverse Tunnel

The SSH reverse tunnel forwards Linode port 9011 to the Pi's Next.js on 127.0.0.1:8088.

#### Create SSH Config

Create or edit `~/.ssh/config`:

```bash
nano ~/.ssh/config
```

Add:

```
Host linode-wallet-tunnel
    HostName <your-linode-ip>
    User <your-linode-user>
    Port 22
    IdentityFile ~/.ssh/id_rsa
    ServerAliveInterval 60
    ServerAliveCountMax 3
    RemoteForward 9011 127.0.0.1:8088
```

Replace `<your-linode-ip>` and `<your-linode-user>` with actual values.

#### Generate SSH Key (if needed)

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa
ssh-copy-id -i ~/.ssh/id_rsa.pub <your-linode-user>@<your-linode-ip>
```

#### Test the tunnel manually

```bash
ssh -N linode-wallet-tunnel
# Should hang (tunnel running in foreground)
# Press Ctrl+C to stop
```

#### Create systemd service for tunnel

Create `/etc/systemd/system/ssh-tunnel-wallet.service`:

```bash
sudo nano /etc/systemd/system/ssh-tunnel-wallet.service
```

Contents:

```ini
[Unit]
Description=SSH Reverse Tunnel for SmartLayerWallet
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
Restart=always
RestartSec=10
ExecStart=/usr/bin/ssh -N -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes linode-wallet-tunnel

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ssh-tunnel-wallet
sudo systemctl start ssh-tunnel-wallet
sudo systemctl status ssh-tunnel-wallet
```

### 7. Install Systemd Service for Next.js

```bash
cd /home/pi/dev/SmartLayerWallet

# Copy service file to systemd directory
sudo cp deploy/smartlayer-wallet.service /etc/systemd/system/

# IMPORTANT: If using nvm, edit the service file with absolute node path
# Find your node path first:
which node
# Example output: /home/pi/.nvm/versions/node/v24.11.0/bin/node

# Edit the service file:
sudo nano /etc/systemd/system/smartlayer-wallet.service
# Replace ExecStart line with your actual node path:
# ExecStart=/home/pi/.nvm/versions/node/v24.11.0/bin/node /home/pi/dev/SmartLayerWallet/start-server.js

# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable smartlayer-wallet

# Start service
sudo systemctl start smartlayer-wallet

# Check status
sudo systemctl status smartlayer-wallet
```

Verify Next.js is running:

```bash
curl http://127.0.0.1:8088/
# Should return HTML
```

### 8. Configure Passwordless Sudo for Deploy Workflow

The GitHub Actions deploy workflow needs to restart the service without a password prompt:

```bash
# Get full path to systemctl
which systemctl
# Output: /usr/bin/systemctl (or /bin/systemctl)

# Create sudoers drop-in file
sudo visudo -f /etc/sudoers.d/smartlayer-wallet-deploy
```

Add this line (use the actual systemctl path from `which systemctl`):

```
pi ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart smartlayer-wallet
```

Save and exit. Verify the configuration:

```bash
sudo visudo -c
# Should output: /etc/sudoers.d/smartlayer-wallet-deploy: parsed OK

# Test passwordless restart
sudo systemctl restart smartlayer-wallet
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

### 10. Configure Caddy on Linode

On your Linode server, configure Caddy to reverse-proxy to the SSH tunnel:

Create or edit `/etc/caddy/Caddyfile`:

```
wallet.percolate.one {
    reverse_proxy 127.0.0.1:9011
    
    # Increase max request body size for uploads
    request_body {
        max_size 10MB
    }
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

Caddy will automatically obtain and manage TLS certificates via Let's Encrypt.

### 11. Network Configuration

Ensure the Pi has:
- Stable LAN connection
- Fixed local IP (or DHCP reservation)
- SSH access to Linode (outbound only, no inbound ports needed)
- LAN access to camera at 192.168.50.224:8787

Verify SSH tunnel is working:

```bash
# On Linode:
curl http://127.0.0.1:9011/
# Should return Next.js HTML

# From external:
curl https://wallet.percolate.one/
# Should return Next.js HTML over HTTPS
```

### 12. First Deploy

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
3. Run tests (`npm test` = vitest)
4. Build the app (`npm run build`)
5. Restart the service
6. Health check: wait up to 30s for service to be active and responding on 127.0.0.1:8088

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│         https://wallet.percolate.one        │
│              (Caddy on Linode)              │
│           Auto-TLS via Let's Encrypt        │
└───────────────────┬─────────────────────────┘
                    │ reverse_proxy 127.0.0.1:9011
                    │
            ┌───────▼─────────────────────────┐
            │   SSH Reverse Tunnel            │
            │   -R 9011:127.0.0.1:8088        │
            │   (Pi → Linode)                 │
            └───────┬─────────────────────────┘
                    │
    ┌───────────────▼───────────────┐
    │   Raspberry Pi 5              │
    │   smartlayer-wallet service   │
    │   Next.js on 127.0.0.1:8088   │
    └───────────────┬───────────────┘
                    │
                    │ proxies /cam-gate/* to
                    │
        ┌───────────▼───────────────────┐
        │   Camera (LAN)                │
        │   192.168.50.224:8787         │
        └───────────────────────────────┘
```

## Maintenance

### View Logs

```bash
# Real-time logs
sudo journalctl -u smartlayer-wallet -f
sudo journalctl -u ssh-tunnel-wallet -f

# Last 100 lines
sudo journalctl -u smartlayer-wallet -n 100
sudo journalctl -u ssh-tunnel-wallet -n 100
```

### Manual Restart

```bash
sudo systemctl restart smartlayer-wallet
sudo systemctl restart ssh-tunnel-wallet
```

### Check Service Status

```bash
systemctl status smartlayer-wallet
systemctl status ssh-tunnel-wallet
```

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
# - Wrong Node.js path (if using nvm, use absolute path in service file)
# - Port already in use
# - Missing dependencies (run npm ci)
# - Inline comments in .env (systemd doesn't strip them)
```

### SSH Tunnel Fails

```bash
# Check tunnel status
sudo systemctl status ssh-tunnel-wallet

# View tunnel logs
sudo journalctl -u ssh-tunnel-wallet -n 50

# Test manual connection
ssh -v -N linode-wallet-tunnel

# Common issues:
# - SSH key not set up (run ssh-copy-id)
# - Firewall blocking outbound SSH (port 22)
# - Linode GatewayPorts not enabled (add "GatewayPorts yes" to /etc/ssh/sshd_config on Linode)
# - Network connectivity issues
```

### Can't Access from External

```bash
# On Pi: Check service is running
curl http://127.0.0.1:8088/

# On Linode: Check tunnel endpoint
curl http://127.0.0.1:9011/

# Check Caddy is running
sudo systemctl status caddy

# Check Caddy logs
sudo journalctl -u caddy -n 50

# Check DNS
dig +short wallet.percolate.one
```

### Camera Gate Errors

If `/cam-gate/` routes return 502:

```bash
# Check camera is accessible from Pi
curl http://192.168.50.224:8787/health

# Verify CAMERA_GATE_UPSTREAM env var
grep CAMERA_GATE_UPSTREAM /home/pi/dev/SmartLayerWallet/.env

# Check Next.js logs for upstream errors
sudo journalctl -u smartlayer-wallet -n 50 | grep camera
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
# Should exist after first passkey registration

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

### nvm Node Path Issues

If the service fails with "node: command not found":

```bash
# Find node path
which node
# Example: /home/pi/.nvm/versions/node/v24.11.0/bin/node

# Edit service file
sudo nano /etc/systemd/system/smartlayer-wallet.service

# Replace ExecStart with absolute path:
# ExecStart=/home/pi/.nvm/versions/node/v24.11.0/bin/node /home/pi/dev/SmartLayerWallet/start-server.js

# Reload and restart
sudo systemctl daemon-reload
sudo systemctl restart smartlayer-wallet
```

## Optional: Standalone HTTPS Server

The repository includes `server-https.js` for standalone/dev deployments where you need local TLS termination. **This is NOT used in production** (production uses Caddy on Linode).

If you want to use it:

```bash
# Install certbot and get certs
sudo apt install -y certbot
sudo certbot certonly --standalone -d wallet.percolate.one

# Set environment variables
export SSL_CERT=/etc/letsencrypt/live/wallet.percolate.one/fullchain.pem
export SSL_KEY=/etc/letsencrypt/live/wallet.percolate.one/privkey.pem
export PORT=8089
export BACKEND_PORT=8088

# Run HTTPS proxy
npm run start:https
```

See `deploy/smartlayer-wallet-https.service` (from earlier PRs) if you need a systemd service for this.

## Security Notes

- **Never commit `.env`** - it contains API keys and secrets
- **Database contains passkey credentials** - back up `./data/wallet.db` securely
- **Restrict sudo permissions** - only allow specific systemctl restart command
- **SSH tunnel uses key auth** - no passwords
- **Caddy auto-renews TLS certs** - no manual cert management needed
- **Monitor logs** - watch for failed authentication attempts or errors
- **Camera is LAN-only** - not exposed to internet directly, proxied via Next.js
