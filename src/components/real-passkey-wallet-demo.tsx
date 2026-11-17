'use client'

import React, { useState } from 'react'
import { Address } from 'viem'
import { useWallet } from './wallet-provider-real'
import { Button } from './ui/button'

/**
 * Real Passkey Wallet Demo Component
 * 
 * Uses EXACT patterns from stephancill/open-browser-wallet:
 * - webauthn-p256 for signature verification
 * - viem/account-abstraction with toCoinbaseSmartAccount
 * - Proper challenge-based authentication
 * - Recovery API integration
 * - Real UserOperation flow
 */
export function RealPasskeyWalletDemo() {
  const wallet = useWallet()
  
  // Form state
  const [signUpUsername, setSignUpUsername] = useState('')
  const [loginCredentialId, setLoginCredentialId] = useState('')
  const [sendToAddress, setSendToAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')

  const handleSignUp = async () => {
    if (!signUpUsername.trim()) {
      console.error('❌ Please enter a username')
      return
    }
    
    try {
      await wallet.signUp(signUpUsername.trim())
      setSignUpUsername('')
      console.log('✅ Sign-up successful!')
    } catch (error: any) {
      console.error('❌ Sign-up failed:', error.message)
    }
  }

  const handleLogin = async () => {
    try {
      await wallet.login(loginCredentialId.trim() || undefined)
      setLoginCredentialId('')
      console.log('✅ Login successful!')
    } catch (error: any) {
      console.error('❌ Login failed:', error.message)
    }
  }

  const handleSendEther = async () => {
    if (!sendToAddress.trim() || !sendAmount.trim()) {
      console.error('❌ Please enter recipient address and amount')
      return
    }

    try {
      const value = BigInt(parseFloat(sendAmount) * 1e18) // Convert to wei
      const txHash = await wallet.sendEther(sendToAddress.trim() as Address, value)
      console.log('✅ Transaction sent:', txHash)
      setSendToAddress('')
      setSendAmount('')
    } catch (error: any) {
      console.error('❌ Transaction failed:', error.message)
    }
  }

  const handleRefreshBalance = async () => {
    try {
      await wallet.refreshBalance()
      console.log('✅ Balance refreshed')
    } catch (error: any) {
      console.error('❌ Failed to refresh balance:', error.message)
    }
  }

  const formatBalance = (balance: bigint): string => {
    if (balance === 0n) return '0'
    const ethValue = Number(balance) / 1e18
    return ethValue.toFixed(6)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">Real Passkey Wallet Demo</h1>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h2 className="font-semibold text-green-900">🎯 Based on Real Implementation</h2>
          <p className="text-sm text-green-700">
            Uses <code className="bg-green-100 px-1 rounded">stephancill/open-browser-wallet</code> patterns
          </p>
          <p className="text-xs text-green-600 mt-2">
            ✓ webauthn-p256 for verification<br/>
            ✓ viem/account-abstraction with toCoinbaseSmartAccount<br/>
            ✓ Challenge-based authentication<br/>
            ✓ Real UserOperation flow
          </p>
        </div>
      </div>

      {/* Environment Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900">Environment Info</h3>
        <div className="grid grid-cols-2 gap-4 text-sm text-blue-700 mt-2">
          <div>
            <span className="font-medium">rpId:</span>
            <code className="bg-blue-100 px-1 rounded ml-1">{wallet.rpId}</code>
          </div>
          <div>
            <span className="font-medium">Environment:</span>
            <code className="bg-blue-100 px-1 rounded ml-1">{wallet.environment}</code>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Wallet Status</h3>
        
        {wallet.isLoading && (
          <div className="text-blue-600 mb-4">
            🔄 Loading...
          </div>
        )}
        
        {wallet.error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
            <div className="text-red-700">
              <strong>Error:</strong> {wallet.error}
            </div>
          </div>
        )}

        {wallet.isConnected && wallet.user ? (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded p-3">
              <h4 className="font-semibold text-green-900 mb-2">✅ Connected User</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Username:</span>
                  <div className="font-semibold">{wallet.user.username}</div>
                </div>
                <div>
                  <span className="text-gray-600">Address:</span>
                  <div className="font-mono text-xs">{wallet.user.walletAddress.slice(0, 20)}...</div>
                </div>
                <div>
                  <span className="text-gray-600">Passkey ID:</span>
                  <div className="font-mono text-xs">{wallet.user.passkeyId.slice(0, 20)}...</div>
                </div>
                <div>
                  <span className="text-gray-600">Deployed:</span>
                  <div className={`font-semibold ${wallet.isDeployed ? 'text-green-600' : 'text-orange-600'}`}>
                    {wallet.isDeployed ? 'Yes' : 'No'}
                  </div>
                </div>
              </div>
              
              <div className="mt-3 pt-3 border-t border-green-200">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-gray-600">Balance:</span>
                    <div className="font-semibold text-lg">{formatBalance(wallet.balance)} ETH</div>
                  </div>
                  <div className="space-x-2">
                    <Button onClick={handleRefreshBalance} size="sm" variant="outline" disabled={wallet.isLoading}>
                      Refresh
                    </Button>
                    <Button onClick={wallet.logout} size="sm" variant="destructive">
                      Logout
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-gray-600">
            Not connected - please sign up or login
          </div>
        )}
      </div>

      {/* Authentication Section */}
      {!wallet.isConnected && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-4">Authentication</h3>
          
          {/* Sign Up */}
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Create New Account</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter username"
                  value={signUpUsername}
                  onChange={(e) => setSignUpUsername(e.target.value)}
                  className="border rounded px-3 py-2 flex-1"
                  disabled={wallet.isLoading}
                />
                <Button 
                  onClick={handleSignUp} 
                  disabled={wallet.isLoading || !signUpUsername.trim()}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Sign Up
                </Button>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Creates a new passkey and smart wallet
              </p>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">Login with Existing Passkey</h4>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Credential ID (optional - leave empty for discoverable)"
                    value={loginCredentialId}
                    onChange={(e) => setLoginCredentialId(e.target.value)}
                    className="border rounded px-3 py-2 flex-1 text-sm"
                    disabled={wallet.isLoading}
                  />
                  <Button 
                    onClick={handleLogin} 
                    disabled={wallet.isLoading}
                    variant="outline"
                  >
                    Login
                  </Button>
                </div>
                <p className="text-xs text-gray-600">
                  Leave empty to use discoverable credentials, or enter specific credential ID
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Section */}
      {wallet.isConnected && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-4">Send Transaction</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipient Address
              </label>
              <input
                type="text"
                placeholder="0x..."
                value={sendToAddress}
                onChange={(e) => setSendToAddress(e.target.value)}
                className="border rounded px-3 py-2 w-full"
                disabled={wallet.isLoading}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount (ETH)
              </label>
              <input
                type="number"
                placeholder="0.001"
                step="0.001"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                className="border rounded px-3 py-2 w-full"
                disabled={wallet.isLoading}
              />
            </div>
            
            <Button 
              onClick={handleSendEther}
              disabled={wallet.isLoading || !sendToAddress.trim() || !sendAmount.trim()}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              Send ETH
            </Button>
            
            <p className="text-xs text-gray-600">
              Uses real UserOperation flow with viem/account-abstraction
            </p>
          </div>
        </div>
      )}

      {/* Implementation Details */}
      <div className="bg-gray-50 border rounded-lg p-4">
        <h3 className="font-semibold mb-4">🔧 Implementation Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Libraries Used</h4>
            <ul className="space-y-1 text-gray-600">
              <li>• <code>webauthn-p256</code> - WebAuthn verification</li>
              <li>• <code>@github/webauthn-json</code> - WebAuthn JSON</li>
              <li>• <code>viem/account-abstraction</code> - Smart accounts</li>
              <li>• <code>toCoinbaseSmartAccount</code> - Coinbase integration</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Key Features</h4>
            <ul className="space-y-1 text-gray-600">
              <li>• Challenge-based authentication</li>
              <li>• Real signature verification</li>
              <li>• UserOperation bundling</li>
              <li>• Recovery API sync</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Console Instructions */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold text-yellow-900 mb-2">📝 Console Output</h3>
        <p className="text-sm text-yellow-800">
          All operations log detailed information to the browser console. 
          Open DevTools → Console to see the authentication flow, UserOperation details, and transaction hashes.
        </p>
      </div>
    </div>
  )
}
