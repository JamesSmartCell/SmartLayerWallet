'use client'

import { useEffect, useState, useCallback } from 'react'
import { Address } from 'viem'
import { useWallet } from '@/components/wallet-provider-real'
import { NETWORKS, type NetworkKey } from '@/lib/env'
import { useNetwork } from '@/components/network-provider'
import { getWaterfallClient } from '@/lib/rpc'

export type TokenOption = {
    key: string
    label: string
    type: 'ETH' | 'ERC20'
    address?: Address
    rawBalance: bigint
    networkKey: NetworkKey
    networkName: string
    tokenName: string
    decimals: number
}

interface UseTokenBalancesProps {
    isOpen: boolean
    includeEth?: boolean
}

export function useTokenBalances({ isOpen, includeEth = false }: UseTokenBalancesProps) {
    const { balance, address: userAddress, getErc20Balances } = useWallet()
    const [tokens, setTokens] = useState<TokenOption[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const { selectedNetwork } = useNetwork()

    // Build tokens list on open
    useEffect(() => {
        if (!isOpen || !userAddress) return
        let cancelled = false

        // Environment-based network selection
        console.log('Selected network:', selectedNetwork)

        const load = async () => {
            setIsLoading(true)
            try {
                const optionsMap = new Map<string, TokenOption>()

                // 0. Include ETH if requested (for the current network)
                if (includeEth) {
                    const network = NETWORKS[selectedNetwork]
                    optionsMap.set('ETH', {
                        key: 'ETH',
                        label: 'ETH',
                        type: 'ETH',
                        rawBalance: balance,
                        networkKey: selectedNetwork,
                        networkName: network.name,
                        tokenName: 'Ethereum',
                        decimals: 18,
                    })
                }

                // 1. Fetch registry tokens for the CURRENT network
                try {
                    const registryTokens = await getErc20Balances()
                    for (const reg of registryTokens) {
                        const network = NETWORKS[selectedNetwork]
                        const hardcodedToken = Object.entries(network.tokens).find(
                            ([_, config]) => config.address.toLowerCase() === reg.token.toLowerCase()
                        )
                        const key = `${selectedNetwork}_REGISTRY_${reg.token}`
                        optionsMap.set(key, {
                            key,
                            label: hardcodedToken ? `${hardcodedToken[0]}` : `Token ${reg.token.slice(0, 6)}`,
                            type: 'ERC20',
                            address: reg.token as Address,
                            rawBalance: reg.balance,
                            networkKey: selectedNetwork,
                            networkName: network.name,
                            tokenName: hardcodedToken ? hardcodedToken[1].name : 'Token',
                            decimals: hardcodedToken ? hardcodedToken[1].decimals : 18,
                        })
                    }
                } catch (err) {
                    console.error('Failed to load registry tokens:', err)
                }

                const network = NETWORKS[selectedNetwork]
                const tokenEntries = Object.entries(network.tokens)
                for (const [symbol, config] of tokenEntries) {
                    const key = `${selectedNetwork}_${symbol}_${config.address}`
                    if (!optionsMap.has(key)) {
                        optionsMap.set(key, {
                            key,
                            label: `${symbol}`,
                            type: 'ERC20',
                            address: config.address,
                            rawBalance: 0n,
                            networkKey: selectedNetwork,
                            networkName: network.name,
                            tokenName: config.name,
                            decimals: config.decimals,
                        })
                    }
                }

                if (cancelled) return
                setTokens(Array.from(optionsMap.values()))
            } catch (e) {
                console.error('Failed to load tokens:', e)
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [isOpen, userAddress, getErc20Balances, balance, includeEth, selectedNetwork])

    const fetchBalance = useCallback(async (tokenKey: string) => {
        if (!userAddress) return

        setTokens(prev => {
            const target = prev.find(t => t.key === tokenKey)
            if (!target || target.type === 'ETH' || !target.address) return prev

            ; (async () => {
                try {
                    const publicClient = await getWaterfallClient(target.networkKey)
                    const rawBalance = await publicClient.readContract({
                        address: target.address!,
                        abi: [{
                            name: 'balanceOf',
                            type: 'function',
                            stateMutability: 'view',
                            inputs: [{ name: 'account', type: 'address' }],
                            outputs: [{ name: '', type: 'uint256' }],
                        }],
                        functionName: 'balanceOf',
                        args: [userAddress],
                    }) as bigint

                    setTokens(current => current.map(t =>
                        t.key === tokenKey ? { ...t, rawBalance } : t
                    ))
                } catch (err) {
                    console.error('Failed to fetch balance for token:', tokenKey, err)
                }
            })()

            return prev
        })
    }, [userAddress])

    return {
        tokens,
        isLoading,
        fetchBalance,
        userAddress
    }
}
