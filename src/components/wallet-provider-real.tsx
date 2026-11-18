'use client'

import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Address, Hex } from 'viem'
import { PasskeyService, PasskeyCredential } from '@/lib/passkey-real'
import { SmartAccountService, UserOperationCall } from '@/lib/smart-account-real'
import { PasskeyBackendService } from '@/lib/recovery-api'
import { ActivityService, type ActivityItem } from '@/lib/activity'
import { ENV } from '@/lib/env'
import { useNetwork } from '@/components/network-provider'

/**
 * Real Wallet Provider Implementation
 * Based on stephancill/open-browser-wallet patterns
 */

interface WalletState {
  // Connection state
  isConnected: boolean
  isLoading: boolean
  error: string | null
  
  // User data (following real implementation schema)
  user: {
    id: string
    username: string
    walletAddress: Address
    passkeyId: string
    passkeyPublicKey: Hex
    createdAt: Date
    updatedAt: Date
  } | null

  // Wallet state
  address: Address | null
  balance: bigint
  isDeployed: boolean
  
  // Environment info
  rpId: string
  environment: 'prod' | 'dev' | 'proto' | 'local'
}

interface WalletContextValue extends WalletState {
  // Authentication methods - EXACT patterns from real implementation
  signUp: (username: string) => Promise<void>
  login: (credentialId?: string) => Promise<void>
  logout: () => void

  // Silent session restore (no passkey prompt) - for NFC/App Clip flows
  restoreSessionSilent: () => Promise<boolean>

  // Wallet operations
  sendTransaction: (calls: UserOperationCall[]) => Promise<Hex>
  sendEther: (to: Address, value: bigint) => Promise<Hex>
  sendErc20: (token: Address, to: Address, amount: bigint) => Promise<Hex>
  approveErc20: (token: Address, spender: Address, amount: bigint) => Promise<Hex>
  getErc20Balances: () => Promise<{ token: Address; balance: bigint }[]>

  // Owner management
  addOwner: (ownerAddress: Address) => Promise<Hex>
  isOwnerAddress: (ownerAddress: Address) => Promise<boolean>

  // Utility methods
  refreshBalance: () => Promise<void>
  getTransactionHistory: () => Promise<ActivityItem[]>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

// Environment detection helper
function getEnvironmentInfo(): { rpId: string; environment: 'prod' | 'dev' | 'proto' | 'local' } {
  const rpId = ENV.RP_ID
  if (rpId === 'percolate.one') {
    return { rpId, environment: 'prod' }
  }
  return { rpId, environment: 'local' }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const envInfo = getEnvironmentInfo()
  const { selectedNetwork } = useNetwork()
  
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    isLoading: false,
    error: null,
    user: null,
    address: null,
    balance: 0n,
    isDeployed: false,
    rpId: envInfo.rpId,
    environment: envInfo.environment,
  })

  // Initialize services (memoized to keep stable identities across renders)
  const passkeyService = useMemo(() => new PasskeyService(state.rpId), [state.rpId])
  // SmartAccountService now takes the selected network
  const smartAccountService = useMemo(() => new SmartAccountService(selectedNetwork), [selectedNetwork])

  // Ensure publicKey is uncompressed 0x04||x||y
  function toUncompressedPublicKey(input: string): Hex {
    const h = input.startsWith('0x') ? input.slice(2) : input
    if (h.length === 128) {
      return (`0x04${h}`) as Hex
    }
    if (h.length === 130 && h.startsWith('04')) {
      return (`0x${h}`) as Hex
    }
    return (`0x${h}`) as Hex
  }

  const updateState = useCallback((updates: Partial<WalletState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }, [])

  /**
   * Sign up with passkey - EXACT pattern from real implementation
   */
  const signUp = useCallback(async (username: string) => {
    updateState({ isLoading: true, error: null })
    
    try {
      console.log('🔐 Starting sign-up for username:', username)
      
      // Get challenge from our API - REQUIRED (no fallback to local challenge)
      const backendService = new PasskeyBackendService()
      let challenge
      try {
        const challengeResponse = await backendService.getChallenge('registration')
        challenge = challengeResponse.challenge
      } catch (error) {
        console.error('Failed to get challenge from backend:', error)
        throw new Error('Failed to get challenge from server. Please check your connection and try again.')
      }

      // Create passkey - now returns attestation data for server verification
      const { credential, attestationObject, clientDataJSON } = await passkeyService.create({ username, challenge })

      // Use SDK canonical address
      const walletAddress = await smartAccountService.getSmartAccountAddress(credential) as `0x${string}`

      // Create user object
      const user = {
        id: crypto.randomUUID(),
        username,
        walletAddress: walletAddress as `0x${string}`,
        passkeyId: credential.id,
        passkeyPublicKey: credential.publicKey,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Store passkey on server - REQUIRED for Safari ITP resistance
      // Server storage is the source of truth; localStorage is only for migration
      await backendService.registerPasskey({
        credentialId: credential.id,
        publicKey: credential.publicKey,
        rpId: state.rpId,
        userHandle: username,
        smartAccountAddress: walletAddress,
        challenge,
        attestationObject,
        clientDataJSON,
      })
      console.log('✅ Passkey registered on server')
      
      // Store user session locally
      localStorage.setItem('wallet_user', JSON.stringify(user))
      
      // Check if account is deployed
      const isDeployed = await smartAccountService.isAccountDeployed(walletAddress)
      const balance = await smartAccountService.getBalance(walletAddress)
      
      updateState({
        isConnected: true,
        isLoading: false,
        user,
        address: walletAddress,
        balance,
        isDeployed,
      })
      
      console.log('✅ Sign-up successful:', {
        username,
        address: walletAddress,
        isDeployed
      })
      
    } catch (error: any) {
      console.error('❌ Sign-up failed:', error)
      updateState({
        isLoading: false,
        error: error.message || 'Sign-up failed',
      })
    }
  }, [passkeyService, smartAccountService, updateState, state.rpId])

  /**
   * Login with existing passkey - EXACT pattern from real implementation
   */
  const login = useCallback(async (credentialId?: string) => {
    updateState({ isLoading: true, error: null })
    
    try {
      console.log('🔐 Starting login:', credentialId ? 'with specific credential' : 'discoverable')
      
      // Get challenge from our API
      const backendService = new PasskeyBackendService()
      let challenge
      try {
        const challengeResponse = await backendService.getChallenge('authentication')
        challenge = challengeResponse.challenge
      } catch (error) {
        console.warn('Failed to get challenge from backend, using local:', error)
        challenge = PasskeyService.generateChallenge()
      }
      
      // Authenticate with passkey
      const result = await passkeyService.authenticate({ challenge, credentialId })
      
      if (!result.credential) {
        throw new Error('Failed to authenticate - no credential returned')
      }
      
      let vc = result.credential
      
      // ALWAYS fetch from server (server is source of truth)
      console.log('🔍 Fetching passkey data from server...')
      const recovered = await backendService.getPasskey(vc.id)
      
      if (!recovered) {
        // Two-path recovery: try localStorage migration first (fast), then cryptographic recovery
        console.log('⚠️ Passkey not found on server')
        const localPasskey = passkeyService.getLocalStoragePasskeyForMigration(vc.id)
        
        if (localPasskey && localPasskey.publicKey !== '0x') {
          // Fast path: localStorage migration with signature verification
          console.log('🔄 Found passkey in localStorage, migrating to server with signature verification...')
          
          // Compute smart account address to verify this is the correct passkey
          const walletAddress = await smartAccountService.getSmartAccountAddress(localPasskey) as `0x${string}`
          
          // Migration requires signature verification - extract assertion data
          if (!result.signature || !result.webauthn) {
            throw new Error('Cannot migrate: missing signature data from authentication')
          }
          
          // Upload to server with signature verification
          try {
            await backendService.migratePasskey({
              credentialId: localPasskey.id,
              publicKey: localPasskey.publicKey,
              rpId: state.rpId,
              userHandle: localPasskey.username || 'migrated-user',
              smartAccountAddress: walletAddress,
              challenge,
              authenticatorData: result.webauthn.authenticatorData,
              clientDataJSON: result.webauthn.clientDataJSON,
              signature: result.signature,
            })
            console.log('✅ Migration successful - passkey now stored on server')
            
            // Use the migrated passkey
            vc = localPasskey
          } catch (migrationError: any) {
            console.error('❌ Migration failed:', migrationError)
            // Fall through to cryptographic recovery
            console.log('🔐 Attempting cryptographic public key recovery...')
          }
        }
        
        // Cryptographic recovery path: no localStorage or migration failed
        // NOTE: Public key recovery is EXPERIMENTAL and may not work reliably yet
        // See RECOVERY_STATUS.md for details
        if (vc.publicKey === '0x') {
          console.log('🔐 No server record and no localStorage. Attempting public key recovery...')
          console.log('   This uses two separate passkey verifications to cryptographically recover your public key.')
          console.log('   NOTE: This feature is experimental. If it fails, you will need to re-register.')
          
          // Get second challenge
          let challenge2: Hex
          try {
            const challengeResponse2 = await backendService.getChallenge('authentication')
            challenge2 = challengeResponse2.challenge
          } catch (error) {
            console.error('Failed to get second challenge:', error)
            throw new Error('Failed to get challenge from server. Please check your connection and try again.')
          }
          
          // Request second assertion with same credentialId
          console.log('   Please confirm with your passkey once more to restore your wallet...')
          const result2 = await passkeyService.authenticate({ challenge: challenge2, credentialId: vc.id })
          
          if (!result.signature || !result.webauthn || !result2.signature || !result2.webauthn) {
            throw new Error('Missing signature data for recovery')
          }
          
          // Call recovery endpoint (EXPERIMENTAL)
          try {
            const recoveryResult = await backendService.recoverPasskey({
              credentialId: vc.id,
              rpId: state.rpId,
              userHandle: 'recovered-user',
              assertion1: {
                challenge,
                authenticatorData: result.webauthn.authenticatorData,
                clientDataJSON: result.webauthn.clientDataJSON,
                signature: result.signature,
              },
              assertion2: {
                challenge: challenge2,
                authenticatorData: result2.webauthn.authenticatorData,
                clientDataJSON: result2.webauthn.clientDataJSON,
                signature: result2.signature,
              },
            })
            
            console.log('✅ Public key recovered successfully!')
            
            // Use the recovered passkey
            vc = {
              id: vc.id,
              rpId: vc.rpId,
              username: 'recovered-user',
              publicKey: recoveryResult.publicKey,
            }
          } catch (recoveryError: any) {
            console.error('❌ Public key recovery failed (experimental feature):', recoveryError)
            throw new Error(`Passkey not found. Please re-register your passkey. (Recovery failed: ${recoveryError.message})`)
          }
        }
      } else {
        // Use passkey from server
        vc = {
          id: vc.id,
          rpId: vc.rpId,
          username: recovered.userHandle,
          publicKey: recovered.publicKey,
        }
      }
      
      // Use SDK canonical address
      const walletAddress = await smartAccountService.getSmartAccountAddress(vc) as `0x${string}`
      
      // Load or create user object
      let user = JSON.parse(localStorage.getItem('wallet_user') || 'null')
      
      if (!user || user.passkeyId !== vc.id) {
        user = {
          id: crypto.randomUUID(),
          username: vc.username || 'User',
          walletAddress,
          passkeyId: vc.id,
          passkeyPublicKey: vc.publicKey,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        localStorage.setItem('wallet_user', JSON.stringify(user))
      } else if (user.passkeyPublicKey !== vc.publicKey) {
        user = { ...user, passkeyPublicKey: vc.publicKey, updatedAt: new Date() }
        localStorage.setItem('wallet_user', JSON.stringify(user))
      }
      
      // Check deployment and balance
      const isDeployed = await smartAccountService.isAccountDeployed(walletAddress as `0x${string}`)
      const balance = await smartAccountService.getBalance(walletAddress as `0x${string}`)
      
      updateState({
        isConnected: true,
        isLoading: false,
        user,
        address: walletAddress,
        balance,
        isDeployed,
      })
      
      console.log('✅ Login successful:', {
        address: walletAddress,
        isDeployed,
        balance: balance.toString()
      })
      
    } catch (error: any) {
      console.error('❌ Login failed:', error)
      updateState({
        isLoading: false,
        error: error.message || 'Login failed',
      })
      throw error
    }
  }, [passkeyService, smartAccountService, updateState])

  /**
   * Logout - clear session
   */
  const logout = useCallback(() => {
    localStorage.removeItem('wallet_user')
    // Clear stored passkeys if needed
    const credentialIds = passkeyService.getStoredPasskeyIds()
    credentialIds.forEach(id => passkeyService.clearStoredPasskey(id))
    
    updateState({
      isConnected: false,
      isLoading: false,
      error: null,
      user: null,
      address: null,
      balance: 0n,
      isDeployed: false,
    })
    
    console.log('👋 Logged out successfully')
  }, [passkeyService, updateState])

  /**
   * Refresh balance
   */
  const refreshBalance = useCallback(async () => {
    if (!state.address) return
    
    try {
      const balance = await smartAccountService.getBalance(state.address)
      const isDeployed = await smartAccountService.isAccountDeployed(state.address)
      
      updateState({ balance, isDeployed })
    } catch (error) {
      console.error('Failed to refresh balance:', error)
    }
  }, [state.address, smartAccountService, updateState])

  /**
   * Send transaction - EXACT pattern from real implementation
   */
  const sendTransaction = useCallback(async (calls: UserOperationCall[]) => {
    if (!state.user || !state.address) {
      throw new Error('Not connected')
    }
    
    const credential: PasskeyCredential = {
      id: state.user.passkeyId,
      publicKey: state.user.passkeyPublicKey,
      rpId: state.rpId,
      username: state.user.username,
    }
    
    updateState({ isLoading: true })
    
    try {
      const txHash = await smartAccountService.sendTransaction(credential, calls)
      
      // Refresh balance after transaction
      setTimeout(() => {
        refreshBalance()
      }, 2000) // Wait for block confirmation
      
      updateState({ isLoading: false })
      return txHash
      
    } catch (error: any) {
      updateState({ isLoading: false, error: error.message })
      throw error
    }
  }, [state.user, state.address, state.rpId, smartAccountService, updateState, refreshBalance])

  /**
   * Send ETH
   */
  const sendEther = useCallback(async (to: Address, value: bigint) => {
    return sendTransaction([{ to, value, data: '0x' }])
  }, [sendTransaction])

  const sendErc20 = useCallback(async (token: Address, to: Address, amount: bigint) => {
    if (!state.user) throw new Error('Not connected')
    const credential: PasskeyCredential = {
      id: state.user.passkeyId,
      publicKey: state.user.passkeyPublicKey,
      rpId: state.rpId,
      username: state.user.username,
    }
    updateState({ isLoading: true })
    try {
      const tx = await smartAccountService.sendErc20(credential, token, to, amount)
      updateState({ isLoading: false })
      setTimeout(() => {
        // defer to avoid dependency cycle warnings
        (async () => { await refreshBalance() })()
      }, 2000)
      return tx
    } catch (error: any) {
      updateState({ isLoading: false, error: error.message })
      throw error
    }
  }, [state.user, state.rpId, smartAccountService, updateState, refreshBalance])

  const approveErc20 = useCallback(async (token: Address, spender: Address, amount: bigint) => {
    if (!state.user) throw new Error('Not connected')
    const credential: PasskeyCredential = {
      id: state.user.passkeyId,
      publicKey: state.user.passkeyPublicKey,
      rpId: state.rpId,
      username: state.user.username,
    }
    updateState({ isLoading: true })
    try {
      const tx = await smartAccountService.approveErc20(credential, token, spender, amount)
      updateState({ isLoading: false })
      return tx
    } catch (error: any) {
      updateState({ isLoading: false, error: error.message })
      throw error
    }
  }, [state.user, state.rpId, smartAccountService, updateState])


  const getErc20Balances = useCallback(async () => {
    if (!state.address) return []
    try {
      const { tokens, balances } = await smartAccountService.getRegistryBalances(state.address)
      return tokens.map((t, i) => ({ token: t, balance: balances[i] || 0n }))
    } catch (e) {
      console.error('Failed to fetch registry balances', e)
      return []
    }
  }, [state.address, smartAccountService])


  /**
   * Get transaction history via ActivityService (on-chain log queries)
   */
  const getTransactionHistory = useCallback(async (): Promise<ActivityItem[]> => {
    if (!state.address) return []

    try {
      const activityService = new ActivityService(selectedNetwork)
      const feed = await activityService.getActivity(state.address)
      return feed.items
    } catch (error) {
      console.error('Failed to get transaction history:', error)
      return []
    }
  }, [state.address, selectedNetwork])

  /**
   * Restore session silently from localStorage WITHOUT passkey prompt.
   * Used for NFC/App Clip flows where we want only ONE passkey prompt (for TX signing).
   * Returns true if session was restored, false otherwise.
   */
  const restoreSessionSilent = useCallback(async (): Promise<boolean> => {
    const storedUser = localStorage.getItem('wallet_user')
    if (!storedUser) {
      console.log('🔐 No stored session to restore')
      return false
    }

    try {
      const user = JSON.parse(storedUser)
      
      // Validate stored user has required fields
      if (!user.walletAddress || !user.passkeyId || !user.passkeyPublicKey) {
        console.log('🔐 Stored session invalid, clearing')
        localStorage.removeItem('wallet_user')
        return false
      }

      console.log('🔐 Restoring session silently for:', user.walletAddress)

      // Check deployment and balance without passkey
      const isDeployed = await smartAccountService.isAccountDeployed(user.walletAddress as Address)
      const balance = await smartAccountService.getBalance(user.walletAddress as Address)

      // Restore state without passkey prompt
      updateState({
        isConnected: true,
        isLoading: false,
        user: {
          ...user,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt),
        },
        address: user.walletAddress as Address,
        balance,
        isDeployed,
      })

      console.log('✅ Session restored silently:', {
        address: user.walletAddress,
        isDeployed,
      })

      return true
    } catch (error) {
      console.error('❌ Silent restore failed:', error)
      return false
    }
  }, [smartAccountService, updateState])

  // Auto-login on mount (run at most once per load)
  // Now uses silent restore instead of full login to avoid passkey prompt
  const hasAutoLoginAttempted = useRef(false)
  useEffect(() => {
    if (hasAutoLoginAttempted.current) return
    hasAutoLoginAttempted.current = true

    ;(async () => {
      const restored = await restoreSessionSilent()
      if (!restored) {
        console.log('No session to restore, user needs to login manually')
      }
    })()
  }, [restoreSessionSilent])

  /**
   * Add an EOA address as co-owner of the smart wallet
   */
  const addOwner = useCallback(async (ownerAddress: Address): Promise<Hex> => {
    if (!state.user) throw new Error('Not connected')
    const credential: PasskeyCredential = {
      id: state.user.passkeyId,
      publicKey: state.user.passkeyPublicKey,
      rpId: state.rpId,
      username: state.user.username,
    }
    updateState({ isLoading: true })
    try {
      const txHash = await smartAccountService.addOwnerAddress(credential, ownerAddress)
      updateState({ isLoading: false })
      return txHash
    } catch (error: any) {
      updateState({ isLoading: false, error: error.message })
      throw error
    }
  }, [state.user, state.rpId, smartAccountService, updateState])

  /**
   * Check if an address is an owner of the smart wallet
   */
  const isOwnerAddress = useCallback(async (ownerAddress: Address): Promise<boolean> => {
    if (!state.address) return false
    return smartAccountService.isOwnerAddress(state.address, ownerAddress)
  }, [state.address, smartAccountService])

  // Refresh balance when network changes (and user is connected)
  const prevNetworkRef = useRef(selectedNetwork)
  useEffect(() => {
    if (prevNetworkRef.current !== selectedNetwork) {
      prevNetworkRef.current = selectedNetwork
      if (state.isConnected && state.address) {
        console.log('🌐 Network changed, refreshing balance...')
        refreshBalance()
      }
    }
  }, [selectedNetwork, state.isConnected, state.address, refreshBalance])

  const contextValue: WalletContextValue = {
    ...state,
    signUp,
    login,
    logout,
    restoreSessionSilent,
    sendTransaction,
    sendEther,
    refreshBalance,
    sendErc20,
    approveErc20,
    getErc20Balances,
    addOwner,
    isOwnerAddress,
    getTransactionHistory,
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}
