'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NetworkProvider } from '@/components/network-provider'
import { WalletProvider } from '@/components/wallet-provider-real'
import { Toaster } from '@/components/ui/toaster'

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NetworkProvider>
        <WalletProvider>
          {children}
          <Toaster />
        </WalletProvider>
      </NetworkProvider>
    </QueryClientProvider>
  )
}
