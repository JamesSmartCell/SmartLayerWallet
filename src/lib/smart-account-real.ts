/**
 * Real SmartAccountService Implementation
 * Based on stephancill/open-browser-wallet
 * 
 * Uses viem/account-abstraction with toCoinbaseSmartAccount and toWebAuthnAccount
 */

import {
  http,
  Hex,
  Address,
  encodeFunctionData,
} from 'viem'
import {
  toCoinbaseSmartAccount,
  toWebAuthnAccount,
  createBundlerClient,
  SmartAccount,
} from 'viem/account-abstraction'
import { verify } from 'webauthn-p256'
import { ENV, getEndpointsForNetwork, getDefaultNetworkKey, type NetworkKey } from './env'
import { getWaterfallClient } from './rpc'
import type { PasskeyCredential } from './passkey-real'

export interface UserOperationCall {
  to: Address
  value?: bigint
  data?: Hex
}

export class SmartAccountService {
  private publicClient: any
  private endpoints: ReturnType<typeof getEndpointsForNetwork>
  private chain: any
  private currentNetworkKey: NetworkKey

  constructor(networkKey?: NetworkKey) {
    this.currentNetworkKey = networkKey || getDefaultNetworkKey()
    this.endpoints = getEndpointsForNetwork(this.currentNetworkKey)
    this.chain = this.endpoints.chain
    
    // Initialize with waterfall RPC (async init deferred to first use)
    this.publicClient = null

    console.log('🏦 SmartAccountService initialized:', {
      network: this.endpoints.chainName,
      chainId: this.endpoints.chainId,
    })
  }

  /**
   * Get or create the waterfall public client
   */
  private async getPublicClient() {
    if (!this.publicClient) {
      this.publicClient = await getWaterfallClient(this.currentNetworkKey)
    }
    return this.publicClient
  }

  /**
   * Switch to a different network - reinitializes all clients
   */
  switchNetwork(networkKey: NetworkKey): void {
    if (networkKey === this.currentNetworkKey) {
      return // No change needed
    }

    this.currentNetworkKey = networkKey
    this.endpoints = getEndpointsForNetwork(networkKey)
    this.chain = this.endpoints.chain
    this.publicClient = null // Reset client, will be re-created on next use

    console.log('🌐 SmartAccountService network switched:', {
      network: this.endpoints.chainName,
      chainId: this.endpoints.chainId,
    })
  }

  /**
   * Get the current network key
   */
  getNetworkKey(): NetworkKey {
    return this.currentNetworkKey
  }

  /**
   * Get current endpoints (useful for UI display)
   */
  getEndpoints() {
    return this.endpoints
  }

  /**
   * Create Coinbase Smart Account from passkey credential - EXACT pattern from real implementation
   */
  async createSmartAccount(credential: PasskeyCredential): Promise<SmartAccount> {
    console.log('🏦 Creating smart account for credential:', {
      id: credential.id.slice(0, 16) + '...',
      hasPublicKey: credential.publicKey !== '0x'
    })

    if (credential.publicKey === '0x') {
      throw new Error('Credential missing public key - fetch from server API first')
    }

    // Create WebAuthn account from passkey credential
    const webAuthnAccount = toWebAuthnAccount({
      credential: {
        id: credential.id,
        // Mini-app expects 0x + (x||y) with no 0x04 prefix
        publicKey: (credential.publicKey.startsWith('0x04') ? (`0x${credential.publicKey.slice(4)}`) : credential.publicKey) as Hex,
      },
      rpId: ENV.RP_ID,
    })

    // Create Coinbase Smart Account with WebAuthn owner - EXACT pattern from real code
    const publicClient = await this.getPublicClient()
    const account = await toCoinbaseSmartAccount({
      owners: [webAuthnAccount],
      client: publicClient,
      version: '1.1', // Align with mini-app derivation
    })

    console.log('✅ Smart account created:', {
      address: account.address,
      factory: 'Coinbase Smart Wallet Factory'
    })

    return account
  }

  /**
   * Get smart account address without creating full account
   */
  async getSmartAccountAddress(credential: PasskeyCredential): Promise<Address> {
    const account = await this.createSmartAccount(credential)
    return account.address
  }

  /**
   * Check if smart account is deployed
   */
  async isAccountDeployed(address: Address): Promise<boolean> {
    try {
      const publicClient = await this.getPublicClient()
      const code = await publicClient.getBytecode({ address })
      return code !== undefined && code !== '0x'
    } catch (error) {
      console.error('Failed to check account deployment:', error)
      return false
    }
  }

  /**
   * Create bundler client for UserOperation submission - EXACT pattern from real implementation
   */
  private async createBundlerClient(account: SmartAccount) {
    const publicClient = await this.getPublicClient()
    return createBundlerClient({
      client: publicClient,
      chain: this.chain,
      account,
      transport: http(this.endpoints.bundlerUrl),
      // userOperation: {
      //   async estimateFeesPerGas(parameters) {
      //     const estimatedFees = await publicClient.estimateFeesPerGas()
      //     return {
      //       ...estimatedFees,
      //       // Add buffer for bundler requirements - EXACT pattern from real code
      //       maxFeePerGas: BigInt(Math.round(Number(estimatedFees.maxFeePerGas) * 1.12)),
      //       maxPriorityFeePerGas: BigInt(Math.round(Number(estimatedFees.maxPriorityFeePerGas) * 1.12)),
      //     }
      //   },
      // },
    })
  }

  /**
   * Send transaction using UserOperation - EXACT pattern from real implementation
   */
  async sendTransaction(
    credential: PasskeyCredential,
    calls: UserOperationCall[]
  ): Promise<Hex> {
    console.log(`🚀 Sending transaction on ${this.currentNetworkKey} with calls:`, calls.length)

    // Create smart account
    const account = await this.createSmartAccount(credential)
    console.log('Smart account created:', account)
    const bundlerClientInstance = await this.createBundlerClient(account)
    console.log('Bundler client created:', bundlerClientInstance)
    const paymasterEnabled = this.endpoints.paymaster

    let userOpHash: Hex
    if (paymasterEnabled) {
      try {
        console.log(`🚀 Attempting sponsored transaction on ${this.currentNetworkKey}...`)
        userOpHash = await bundlerClientInstance.sendUserOperation({
          calls: calls.map(call => ({
            to: call.to,
            value: call.value,
            data: call.data,
          })),
          paymaster: true,
        })
      } catch (err) {
        console.warn(`⚠️ Sponsored transaction failed on ${this.currentNetworkKey}, falling back to user-pays:`, err)
        userOpHash = await bundlerClientInstance.sendUserOperation({
          calls: calls.map(call => ({
            to: call.to,
            value: call.value,
            data: call.data,
          })),
        })
      }
    } else {
      console.log(`🚀 Attempting user-pays transaction on ${this.currentNetworkKey}...`, calls)
      userOpHash = await bundlerClientInstance.sendUserOperation({
        calls: calls.map(call => ({
          to: call.to,
          value: call.value,
          data: call.data,
        })),
      })
    }

    console.log('📤 UserOperation submitted:', {
      hash: userOpHash,
      account: account.address,
    })

    const receipt = await bundlerClientInstance.waitForUserOperationReceipt({
      hash: userOpHash,
    })

    console.log('✅ Transaction confirmed:', {
      txHash: receipt.receipt.transactionHash,
      gasUsed: receipt.receipt.gasUsed?.toString(),
    })

    return receipt.receipt.transactionHash
  }

  /**
   * Send simple ETH transfer
   */
  async sendEther(
    credential: PasskeyCredential,
    to: Address,
    value: bigint
  ): Promise<Hex> {
    return this.sendTransaction(credential, [{
      to,
      value,
      data: '0x',
    }])
  }

  /**
   * Verify WebAuthn signature - EXACT pattern from real implementation
   */
  async verifySignature(
    publicKey: Hex,
    signature: any,
    webauthn: any,
    hash: Hex
  ): Promise<boolean> {
    try {
      const result = await verify({
        hash,
        publicKey,
        signature,
        webauthn,
      })

      console.log('🔐 Signature verification:', result ? '✅ Valid' : '❌ Invalid')
      return result
    } catch (error) {
      console.error('Signature verification failed:', error)
      return false
    }
  }

  /**
   * Get account balance
   */
  async getBalance(address: Address): Promise<bigint> {
    try {
      const publicClient = await this.getPublicClient()
      return await publicClient.getBalance({ address })
    } catch (error) {
      console.error('Failed to get balance:', error)
      return 0n
    }
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(
    _credential: PasskeyCredential,
    _calls: UserOperationCall[]
  ): Promise<{
    verificationGasLimit: bigint
    callGasLimit: bigint
    preVerificationGas: bigint
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
  }> {
    try {
      // This would use bundler's estimation methods
      const publicClient = await this.getPublicClient()
      const fees = await publicClient.estimateFeesPerGas()

      // Rough estimates - real implementation would use bundler estimation
      return {
        verificationGasLimit: BigInt(100000), // WebAuthn verification is expensive
        callGasLimit: BigInt(100000), // Depends on call complexity
        preVerificationGas: BigInt(50000), // Pre-verification overhead
        maxFeePerGas: BigInt(Math.round(Number(fees.maxFeePerGas) * 1.12)),
        maxPriorityFeePerGas: BigInt(Math.round(Number(fees.maxPriorityFeePerGas) * 1.12)),
      }
    } catch (error) {
      console.error('Failed to estimate gas:', error)
      throw error
    }
  }

  /**
   * Read ERC20 balances via registry paging
   */
  async getRegistryBalances(user: Address): Promise<{ tokens: Address[]; balances: bigint[] }> {
    // Token registry not available in this wallet
    return { tokens: [], balances: [] }
  }

  /**
   * Send ERC20 transfer(to, amount) via smart account
   */
  async sendErc20(
    credential: PasskeyCredential,
    token: Address,
    to: Address,
    amount: bigint
  ): Promise<Hex> {
    console.log('🚀 Sending ERC20 transaction:', { token, to, amount, network: this.currentNetworkKey })

    const erc20Abi = [{
      name: 'transfer',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
      outputs: [{ name: '', type: 'bool' }],
    }] as const

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount]
    })

    return this.sendTransaction(credential, [{ to: token, data }])
  }


  /**
   * Send ERC20 approve(spender, amount) via smart account
   */
  async approveErc20(
    credential: PasskeyCredential,
    token: Address,
    spender: Address,
    amount: bigint
  ): Promise<Hex> {
    const erc20Abi = [{
      name: 'approve',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
      outputs: [{ name: '', type: 'bool' }],
    }] as const

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount]
    })

    return this.sendTransaction(credential, [{ to: token, data }])
  }

  /**
   * Check if an address is an owner of the smart wallet
   */
  async isOwnerAddress(
    smartWalletAddress: Address,
    ownerAddress: Address
  ): Promise<boolean> {
    const abi = [
      {
        inputs: [{ name: 'account', type: 'address' }],
        name: 'isOwnerAddress',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
      },
    ] as const

    try {
      return await this.publicClient.readContract({
        address: smartWalletAddress,
        abi,
        functionName: 'isOwnerAddress',
        args: [ownerAddress],
      })
    } catch (error) {
      console.error('Failed to check owner:', error)
      return false
    }
  }

  /**
   * Add an EOA address as a co-owner of the smart wallet via UserOperation
   */
  async addOwnerAddress(
    credential: PasskeyCredential,
    ownerAddress: Address
  ): Promise<Hex> {
    const account = await this.createSmartAccount(credential)

    const addOwnerAbi = [
      {
        inputs: [{ name: 'owner', type: 'address' }],
        name: 'addOwnerAddress',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ] as const

    const data = encodeFunctionData({
      abi: addOwnerAbi,
      functionName: 'addOwnerAddress',
      args: [ownerAddress],
    })

    const bundlerClientInstance = await this.createBundlerClient(account)

    const userOpHash = await bundlerClientInstance.sendUserOperation({
      calls: [{
        to: account.address,
        data,
      }],
    })

    console.log('📤 addOwnerAddress UserOp submitted:', userOpHash)

    const receipt = await bundlerClientInstance.waitForUserOperationReceipt({
      hash: userOpHash,
    })

    console.log('✅ Owner added:', {
      txHash: receipt.receipt.transactionHash,
      newOwner: ownerAddress,
    })

    return receipt.receipt.transactionHash
  }

  async getNonce(address: Address): Promise<bigint> {
    try {
      const count = await this.publicClient.getTransactionCount({ address })
      return BigInt(count)
    } catch (error) {
      console.error('Failed to get nonce:', error)
      return 0n
    }
  }
}
