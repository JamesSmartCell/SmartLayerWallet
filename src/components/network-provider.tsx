'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { 
  NETWORK_KEYS, 
  getEnabledNetworkKeys, 
  getDefaultNetworkKey,
  NETWORKS,
  type NetworkKey 
} from '@/lib/env'

const STORAGE_KEY = 'openpasskey_selected_network'

interface NetworkContextValue {
  /** Currently selected network key */
  selectedNetwork: NetworkKey
  /** Set selected network (persisted to localStorage) */
  setNetwork: (network: NetworkKey) => void
  /** List of enabled networks for current environment */
  enabledNetworks: NetworkKey[]
  /** Current network config object */
  networkConfig: typeof NETWORKS[NetworkKey]
  /** Whether this is a testnet */
  isTestnet: boolean
}

const NetworkContext = createContext<NetworkContextValue | null>(null)

export function useNetwork() {
  const context = useContext(NetworkContext)
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider')
  }
  return context
}

/**
 * Get stored network from localStorage, validating it's still enabled
 */
function getStoredNetwork(enabledNetworks: NetworkKey[]): NetworkKey | null {
  if (typeof window === 'undefined') return null
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && enabledNetworks.includes(stored as NetworkKey)) {
      return stored as NetworkKey
    }
  } catch {
    // localStorage not available
  }
  return null
}

/**
 * Store selected network to localStorage
 */
function storeNetwork(network: NetworkKey): void {
  if (typeof window === 'undefined') return
  
  try {
    localStorage.setItem(STORAGE_KEY, network)
  } catch {
    // localStorage not available
  }
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const enabledNetworks = useMemo(() => getEnabledNetworkKeys(), [])
  
  // Initialize with default, will be updated in useEffect for SSR compatibility
  const [selectedNetwork, setSelectedNetworkState] = useState<NetworkKey>(() => {
    // Server-side: use default
    if (typeof window === 'undefined') {
      return getDefaultNetworkKey()
    }
    // Client-side: check localStorage first
    const stored = getStoredNetwork(enabledNetworks)
    return stored || getDefaultNetworkKey()
  })

  // Hydration effect to sync with localStorage after mount
  useEffect(() => {
    const stored = getStoredNetwork(enabledNetworks)
    if (stored && stored !== selectedNetwork) {
      setSelectedNetworkState(stored)
    }
  }, [enabledNetworks]) // eslint-disable-line react-hooks/exhaustive-deps

  const setNetwork = useCallback((network: NetworkKey) => {
    if (!enabledNetworks.includes(network)) {
      console.warn(`Network ${network} is not enabled. Enabled networks:`, enabledNetworks)
      return
    }
    
    storeNetwork(network)
    setSelectedNetworkState(network)
    
    console.log(`🌐 Network switched to: ${NETWORKS[network].name}`)
  }, [enabledNetworks])

  const networkConfig = useMemo(() => NETWORKS[selectedNetwork], [selectedNetwork])
  
  const isTestnet = useMemo(() => {
    return selectedNetwork === NETWORK_KEYS.BASE_SEPOLIA
  }, [selectedNetwork])

  const contextValue: NetworkContextValue = useMemo(() => ({
    selectedNetwork,
    setNetwork,
    enabledNetworks,
    networkConfig,
    isTestnet,
  }), [selectedNetwork, setNetwork, enabledNetworks, networkConfig, isTestnet])

  return (
    <NetworkContext.Provider value={contextValue}>
      {children}
    </NetworkContext.Provider>
  )
}
