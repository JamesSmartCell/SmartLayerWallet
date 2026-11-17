'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useNetwork } from './network-provider'
import { NETWORKS, NETWORK_KEYS, type NetworkKey } from '@/lib/env'

// Chain icons as simple components
function EthereumIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <path d="M16 4L15.8125 4.6375V20.6125L16 20.8L23.5 16.3L16 4Z" fill="white" fillOpacity="0.6" />
      <path d="M16 4L8.5 16.3L16 20.8V13.0125V4Z" fill="white" />
      <path d="M16 22.2375L15.9 22.3625V28.075L16 28.375L23.5 17.7375L16 22.2375Z" fill="white" fillOpacity="0.6" />
      <path d="M16 28.375V22.2375L8.5 17.7375L16 28.375Z" fill="white" />
      <path d="M16 20.8L23.5 16.3L16 13.0125V20.8Z" fill="white" fillOpacity="0.2" />
      <path d="M8.5 16.3L16 20.8V13.0125L8.5 16.3Z" fill="white" fillOpacity="0.6" />
    </svg>
  )
}

function BaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#0052FF" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 28C22.6274 28 28 22.6274 28 16C28 9.37258 22.6274 4 16 4C9.37258 4 4 9.37258 4 16C4 22.6274 9.37258 28 16 28ZM15.9963 24.0068C20.4219 24.0068 24.0068 20.4219 24.0068 15.9963C24.0068 11.5707 20.4219 7.98582 15.9963 7.98582C11.7912 7.98582 8.34588 11.2306 8.00586 15.3486H19.3088V16.6441H8.00586C8.34588 20.7621 11.7912 24.0068 15.9963 24.0068Z"
        fill="white"
      />
    </svg>
  )
}

function TestnetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#6B7280" />
      <circle cx="16" cy="16" r="14" stroke="white" strokeOpacity="0.3" strokeWidth="2" strokeDasharray="4 4" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.9963 22C19.3124 22 22.0068 19.3056 22.0068 15.9895C22.0068 12.6734 19.3124 9.979 15.9963 9.979C12.8612 9.979 10.2624 12.4027 10.0059 15.4792H17.3088V16.5H10.0059C10.2624 19.5764 12.8612 22 15.9963 22Z"
        fill="white"
      />
    </svg>
  )
}

function getNetworkIcon(networkKey: NetworkKey, className?: string) {
  switch (networkKey) {
    case NETWORK_KEYS.MAINNET:
      return <EthereumIcon className={className} />
    case NETWORK_KEYS.BASE:
      return <BaseIcon className={className} />
    case NETWORK_KEYS.SEPOLIA:
    case NETWORK_KEYS.BASE_SEPOLIA:
      return <TestnetIcon className={className} />
    default:
      return <BaseIcon className={className} />
  }
}

export function NetworkSwitcher() {
  const { selectedNetwork, setNetwork, enabledNetworks, isTestnet } = useNetwork()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close dropdown on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  const currentNetwork = NETWORKS[selectedNetwork]

  // Don't render if only one network is available
  if (enabledNetworks.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
        {getNetworkIcon(selectedNetwork, 'w-4 h-4')}
        <span className="text-sm font-medium text-gray-700">{currentNetwork.name}</span>
        {isTestnet && (
          <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded">Testnet</span>
        )}
      </div>
    )
  }

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {getNetworkIcon(selectedNetwork, 'w-4 h-4')}
        <span className="text-sm font-medium text-gray-700">{currentNetwork.name}</span>
        {isTestnet && (
          <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded">Testnet</span>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div 
          className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          role="listbox"
        >
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Select Network</p>
          </div>
          
          {enabledNetworks.map((networkKey) => {
            const network = NETWORKS[networkKey]
            const isSelected = networkKey === selectedNetwork
            const isTestnetNetwork = networkKey === NETWORK_KEYS.BASE_SEPOLIA

            return (
              <button
                key={networkKey}
                onClick={() => {
                  setNetwork(networkKey)
                  setIsOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                  isSelected ? 'bg-blue-50' : ''
                }`}
                role="option"
                aria-selected={isSelected}
              >
                {getNetworkIcon(networkKey, 'w-5 h-5')}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                      {network.name}
                    </span>
                    {isTestnetNetwork && (
                      <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                        Testnet
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">Chain ID: {network.id}</span>
                </div>
                {isSelected && <Check className="w-4 h-4 text-blue-600" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Compact network badge for display in header subtitle
 */
export function NetworkBadge() {
  const { selectedNetwork, isTestnet } = useNetwork()
  const network = NETWORKS[selectedNetwork]

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      isTestnet 
        ? 'bg-yellow-100 text-yellow-800' 
        : 'bg-blue-100 text-blue-800'
    }`}>
      {getNetworkIcon(selectedNetwork, 'w-3 h-3')}
      {network.name}
    </span>
  )
}
