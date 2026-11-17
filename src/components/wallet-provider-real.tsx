'use client'

import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Address, Hex } from 'viem'
import { PasskeyService, PasskeyCredential } from '@/lib/passkey-real'
import { SmartAccountService, UserOperationCall } from '@/lib/smart-account-real'
import { RecoveryApiService, PasskeyBackendService } from '@/lib/recovery-api'
import { ActivityService, type ActivityItem } from '@/lib/activity'
import { ENV } from '@/lib/env'
import { useNetwork } from '@/components/network-provider'
import { getPaymentRequestSignHash, signPaymentRequestHash } from '@/lib/payment-request'
import { decodePaymentError } from '@/lib/payment-errors'

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

  // Payment request (CoSignedPaymentRequest for PaymentHandlerDeployCandidate)
  signPaymentRequest: (signedPaymentRequest: {
    deviceSignature: Hex
    timestamp: bigint
    paymentRequest: { paymentAmount: bigint; tokenAddress: Hex; salt: Hex }
  }) => Promise<Hex>

  // Direct payment via processPaymentDirect - UserOp from smart account, no user signature needed
  sendPaymentDirect: (signedPaymentRequest: {
    deviceSignature: Hex
    timestamp: bigint
    paymentRequest: { paymentAmount: bigint; tokenAddress: Hex; salt: Hex }
  }) => Promise<Hex>

  // Check balance/allowance before payment
  checkPaymentReadiness: (paymentRequest: { paymentAmount: bigint; tokenAddress: Hex }) => Promise<{ ok: boolean; error?: string }>

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
  } else if (rpId === 'opkdev.com') {
    return { rpId, environment: 'dev' }
  } else if (rpId === 'opkproto.com') {
    return { rpId, environment: 'proto' }
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
  const recoveryService = useMemo(() => new RecoveryApiService(), [])
  const backendService = useMemo(() => new PasskeyBackendService(), [])

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
      
      // Fetch registration options from backend (openpasskey.com pattern)
      const reg = await backendService.getRegistrationChallenge()
      if (!reg?.success) throw new Error(reg?.error || 'Failed to get registration options')
      const { sessionId, options } = reg.data
      
      // Create passkey with backend-provided options
      const { credential, attestation } = await passkeyService.createWithBackendOptions(options, username)
      
      // Verify registration with backend
      const verify = await backendService.verifyRegistrationChallenge(sessionId, attestation)
      if (!verify?.success) throw new Error(verify?.error || 'Registration verification failed')

      // Use backend-verified public key (matches what device recovers from signature)
      const verifiedPublicKey = verify.data?.publicKey as `0x${string}` || credential.publicKey

      // Build credential with verified key for SDK
      const credentialWithVerifiedKey = { ...credential, publicKey: verifiedPublicKey }

      // Use SDK canonical address (toCoinbaseSmartAccount → getSmartAccountAddress)
      const walletAddress = await smartAccountService.getSmartAccountAddress(credentialWithVerifiedKey) as `0x${string}`

      // Create user object following real implementation schema
      const user = {
        id: crypto.randomUUID(),
        username,
        walletAddress: walletAddress as `0x${string}`,
        passkeyId: credential.id,
        passkeyPublicKey: verifiedPublicKey,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Store in recovery API for cross-device sync
      // Store xyHex (x||y only, 64+64 hex). Strip 0x04 if present.
      const full = verifiedPublicKey.startsWith('0x') ? verifiedPublicKey.slice(2) : verifiedPublicKey
      const xyHex = full.startsWith('04') ? full.slice(2) : full
      await recoveryService.upsertPasskey({
        credentialId: credential.id,
        rpId: state.rpId,
        xyHex,
      })
      
      // Store user session locally (in real implementation, this would be server-side)
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
  }, [passkeyService, smartAccountService, recoveryService, backendService, updateState, state.rpId])

  /**
   * Login with existing passkey - EXACT pattern from real implementation
   */
  const login = useCallback(async (credentialId?: string) => {
    updateState({ isLoading: true, error: null })
    
    try {
      console.log('🔐 Starting login:', credentialId ? 'with specific credential' : 'discoverable')
      
      // Fetch authentication options from backend
      const auth = await backendService.getAuthChallenge(credentialId)
      if (!auth?.success) throw new Error(auth?.error || 'Failed to get auth options')
      const { sessionId, options } = auth.data
      
      // Authenticate with passkey using backend options
      const { assertion } = await passkeyService.authenticateWithBackendOptions(options)
      
      // Verify assertion with backend
      const verify = await backendService.verifyAuthChallenge(sessionId, assertion)
      if (!verify?.success) throw new Error(verify?.error || 'Auth verification failed')
      
      // Build minimal credential from verified payload or stored key
      const credential: PasskeyCredential = {
        id: verify.data.id,
        publicKey: verify.data.publicKey ? toUncompressedPublicKey(verify.data.publicKey) : ('0x' as Hex),
        rpId: verify.data.rpId,
        username: undefined,
      }
      
      // Verified by backend; proceed
      
      // Build minimal credential; fill from recovery API if needed
      let vc = credential
      
      // If credential missing public key, fetch from recovery API
      if (vc.publicKey === '0x') {
        console.log('🔍 Fetching public key from recovery API...')
        const recovered = await recoveryService.getPasskey(vc.id)
        
        if (!recovered) {
          throw new Error('Credential not found in recovery API')
        }
        
        vc = {
          ...vc,
          publicKey: (`0x04${recovered.xyHex}`) as Hex,
        }
        
        // Update local storage
        passkeyService.updateStoredPasskey(vc.id, vc.publicKey)
      }
      
      // Note: backend already verified the WebAuthn assertion. No local signature verification required here.
      
      // Use SDK canonical address (toCoinbaseSmartAccount → getSmartAccountAddress)
      const walletAddress = await smartAccountService.getSmartAccountAddress(vc) as `0x${string}`
      
      // Create/load user object - always use backend-verified public key
      let user = JSON.parse(localStorage.getItem('wallet_user') || 'null')
      
      if (!user || user.passkeyId !== vc.id) {
        user = {
          id: crypto.randomUUID(),
          username: vc.username || 'Unknown User',
          walletAddress,
          passkeyId: vc.id,
          passkeyPublicKey: vc.publicKey,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        localStorage.setItem('wallet_user', JSON.stringify(user))
      } else if (user.passkeyPublicKey !== vc.publicKey) {
        // Update stored key if backend has a different (correct) one
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
  }, [passkeyService, smartAccountService, recoveryService, backendService, updateState])

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

  /**
   * Sign a payment request for CoSignedPaymentRequest (EIP-712 typed data)
   * Uses NEXT_PUBLIC_PAYMENT_CONTRACT_BASE_SEPOLIA and chainId 84532 for Base Sepolia
   */
  const signPaymentRequest = useCallback(
    async (signedPaymentRequest: {
      deviceSignature: Hex
      timestamp: bigint
      paymentRequest: { paymentAmount: bigint; tokenAddress: Hex; salt: Hex }
    }) => {
      if (!state.user) throw new Error('Not connected')
      const contractAddress = ENV.PAYMENT_CONTRACT_BASE_SEPOLIA
      if (!contractAddress) throw new Error('Payment contract not configured (NEXT_PUBLIC_PAYMENT_CONTRACT_BASE_SEPOLIA)')
      const chainId = 84532 // Base Sepolia
      const hash = getPaymentRequestSignHash(signedPaymentRequest, chainId, contractAddress)
      return signPaymentRequestHash(hash, state.user.passkeyId, state.rpId)
    },
    [state.user, state.rpId]
  )

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
   * Send payment via processPaymentDirect - UserOp from smart account (msg.sender).
   * User signs UserOp with passkey - same flow as send ERC20.
   */
  const sendPaymentDirect = useCallback(
    async (signedPaymentRequest: {
      deviceSignature: Hex
      timestamp: bigint
      paymentRequest: { paymentAmount: bigint; tokenAddress: Hex; salt: Hex }
    }) => {
      if (!state.user || !state.address) throw new Error('Not connected')
      const credential: PasskeyCredential = {
        id: state.user.passkeyId,
        publicKey: state.user.passkeyPublicKey,
        rpId: state.rpId,
        username: state.user.username,
      }
      updateState({ isLoading: true })
      try {
        const txHash = await smartAccountService.sendPaymentDirect(credential, signedPaymentRequest)
        updateState({ isLoading: false })
        setTimeout(() => refreshBalance(), 2000)

        // Send to payment backend for internal accounting (fire-and-forget)
        const backend = ENV.PAYMENT_BACKEND
        if (backend && state.address) {
          const accountingPayload = {
            signedPaymentRequest: {
              deviceSignature: signedPaymentRequest.deviceSignature,
              timestamp: signedPaymentRequest.timestamp.toString(),
              paymentRequest: {
                paymentAmount: signedPaymentRequest.paymentRequest.paymentAmount.toString(),
                tokenAddress: signedPaymentRequest.paymentRequest.tokenAddress,
                salt: signedPaymentRequest.paymentRequest.salt,
              },
            },
            userAddress: state.address,
            txHash,
          }
          fetch(`${backend.replace(/\/$/, '')}/payment-direct-accounting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountingPayload),
          }).catch(() => {})
        }

        return txHash
      } catch (error: unknown) {
        const friendlyMessage = decodePaymentError(error)
        updateState({ isLoading: false, error: friendlyMessage })
        throw new Error(friendlyMessage)
      }
    },
    [state.user, state.address, state.rpId, smartAccountService, updateState, refreshBalance]
  )

  const checkPaymentReadiness = useCallback(
    async (paymentRequest: { paymentAmount: bigint; tokenAddress: Hex }) => {
      if (!state.address) return { ok: false, error: 'Not connected' }
      return smartAccountService.checkPaymentReadiness(
        state.address,
        paymentRequest.tokenAddress,
        paymentRequest.paymentAmount
      )
    },
    [state.address, smartAccountService]
  )

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
    signPaymentRequest,
    sendPaymentDirect,
    checkPaymentReadiness,
    getTransactionHistory,
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}
