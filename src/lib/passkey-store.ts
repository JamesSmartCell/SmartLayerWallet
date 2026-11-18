/**
 * Passkey Storage Layer - SQLite backend for server-side passkey persistence
 * 
 * Schema:
 * - passkeys: credential storage (id, public_key, rp_id, user_handle, address, created_at, last_used, sign_count)
 * - challenges: challenge storage for registration/auth (id, challenge, type, expires_at, used)
 * - rate_limits: simple rate limiting by IP (ip, endpoint, count, window_start)
 */

import Database from 'better-sqlite3'
import { Hex } from 'viem'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface PasskeyRecord {
  id: string                    // credential ID
  publicKey: Hex               // P-256 public key (0x04||x||y)
  rpId: string
  userHandle: string           // user identifier
  smartAccountAddress: Hex     // associated smart account address
  createdAt: Date
  lastUsed: Date
  signCount: number
}

export interface ChallengeRecord {
  id: string
  challenge: Hex
  type: 'registration' | 'authentication'
  expiresAt: Date
  used: boolean
}

export class PasskeyStore {
  private db: Database.Database

  constructor(dbPath: string = process.env.WALLET_DB_PATH || './data/wallet.db') {
    // Resolve path and ensure directory exists
    const resolvedPath = path.resolve(dbPath)
    const dbDir = path.dirname(resolvedPath)
    
    // Create directory if it doesn't exist (recursive: true creates parent directories)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
      console.log(`📁 Created database directory: ${dbDir}`)
    }
    
    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.initializeSchema()
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS passkeys (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        user_handle TEXT NOT NULL,
        smart_account_address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_passkeys_user_handle ON passkeys(user_handle);
      CREATE INDEX IF NOT EXISTS idx_passkeys_address ON passkeys(smart_account_address);
      CREATE INDEX IF NOT EXISTS idx_passkeys_rp_id ON passkeys(rp_id);

      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        challenge TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);
      CREATE INDEX IF NOT EXISTS idx_challenges_used ON challenges(used);

      CREATE TABLE IF NOT EXISTS rate_limits (
        ip TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        window_start INTEGER NOT NULL,
        PRIMARY KEY (ip, endpoint)
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
    `)
  }

  /**
   * Store a new passkey credential (insert-only, does not overwrite existing)
   * Returns true if inserted, false if already exists
   */
  storePasskey(passkey: Omit<PasskeyRecord, 'createdAt' | 'lastUsed' | 'signCount'>): boolean {
    const now = Date.now()
    
    // Check if already exists
    const existing = this.getPasskey(passkey.id)
    if (existing) {
      // Do not overwrite - this is intentional security behavior
      return false
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO passkeys (id, public_key, rp_id, user_handle, smart_account_address, created_at, last_used, sign_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `)
    stmt.run(
      passkey.id,
      passkey.publicKey,
      passkey.rpId,
      passkey.userHandle,
      passkey.smartAccountAddress,
      now,
      now
    )
    return true
  }

  /**
   * Get passkey by credential ID
   */
  getPasskey(credentialId: string): PasskeyRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, public_key, rp_id, user_handle, smart_account_address, created_at, last_used, sign_count
      FROM passkeys
      WHERE id = ?
    `)
    const row = stmt.get(credentialId) as any
    if (!row) return null

    return {
      id: row.id,
      publicKey: row.public_key as Hex,
      rpId: row.rp_id,
      userHandle: row.user_handle,
      smartAccountAddress: row.smart_account_address as Hex,
      createdAt: new Date(row.created_at),
      lastUsed: new Date(row.last_used),
      signCount: row.sign_count,
    }
  }

  /**
   * Get all passkeys for a user
   */
  getPasskeysForUser(userHandle: string): PasskeyRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, public_key, rp_id, user_handle, smart_account_address, created_at, last_used, sign_count
      FROM passkeys
      WHERE user_handle = ?
      ORDER BY last_used DESC
    `)
    const rows = stmt.all(userHandle) as any[]
    return rows.map(row => ({
      id: row.id,
      publicKey: row.public_key as Hex,
      rpId: row.rp_id,
      userHandle: row.user_handle,
      smartAccountAddress: row.smart_account_address as Hex,
      createdAt: new Date(row.created_at),
      lastUsed: new Date(row.last_used),
      signCount: row.sign_count,
    }))
  }

  /**
   * Update passkey last used time and sign count
   */
  updatePasskeyUsage(credentialId: string, signCount: number): void {
    const stmt = this.db.prepare(`
      UPDATE passkeys
      SET last_used = ?, sign_count = ?
      WHERE id = ?
    `)
    stmt.run(Date.now(), signCount, credentialId)
  }

  /**
   * Create a new challenge
   */
  createChallenge(type: 'registration' | 'authentication', ttlSeconds: number = 300): ChallengeRecord {
    const id = crypto.randomUUID()
    const challenge = `0x${crypto.randomBytes(32).toString('hex')}` as Hex
    const expiresAt = Date.now() + (ttlSeconds * 1000)

    const stmt = this.db.prepare(`
      INSERT INTO challenges (id, challenge, type, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `)
    stmt.run(id, challenge, type, expiresAt)

    return {
      id,
      challenge,
      type,
      expiresAt: new Date(expiresAt),
      used: false,
    }
  }

  /**
   * Get and validate a challenge
   */
  getChallenge(challenge: Hex): ChallengeRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, challenge, type, expires_at, used
      FROM challenges
      WHERE challenge = ?
    `)
    const row = stmt.get(challenge) as any
    if (!row) return null

    const now = Date.now()
    if (row.expires_at < now) {
      return null // Expired
    }

    if (row.used) {
      return null // Already used
    }

    return {
      id: row.id,
      challenge: row.challenge as Hex,
      type: row.type,
      expiresAt: new Date(row.expires_at),
      used: Boolean(row.used),
    }
  }

  /**
   * Mark a challenge as used
   */
  markChallengeUsed(challenge: Hex): void {
    const stmt = this.db.prepare(`
      UPDATE challenges
      SET used = 1
      WHERE challenge = ?
    `)
    stmt.run(challenge)
  }

  /**
   * Clean up expired challenges
   */
  cleanupExpiredChallenges(): void {
    const stmt = this.db.prepare(`
      DELETE FROM challenges
      WHERE expires_at < ?
    `)
    stmt.run(Date.now())
  }

  /**
   * Check rate limit (simple per-IP per-endpoint limit)
   * Returns true if rate limit is exceeded
   */
  checkRateLimit(ip: string, endpoint: string, maxRequests: number = 10, windowSeconds: number = 60): boolean {
    const now = Date.now()
    const windowStart = now - (windowSeconds * 1000)

    // Clean up old windows
    const cleanupStmt = this.db.prepare(`
      DELETE FROM rate_limits
      WHERE window_start < ?
    `)
    cleanupStmt.run(windowStart)

    // Check current window
    const checkStmt = this.db.prepare(`
      SELECT count
      FROM rate_limits
      WHERE ip = ? AND endpoint = ? AND window_start >= ?
    `)
    const row = checkStmt.get(ip, endpoint, windowStart) as any

    if (row && row.count >= maxRequests) {
      return true // Rate limit exceeded
    }

    // Increment counter
    const upsertStmt = this.db.prepare(`
      INSERT INTO rate_limits (ip, endpoint, count, window_start)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(ip, endpoint) DO UPDATE SET
        count = count + 1
    `)
    upsertStmt.run(ip, endpoint, now)

    return false
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close()
  }
}
