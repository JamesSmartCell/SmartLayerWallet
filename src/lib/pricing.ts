// Pricing service using Coinbase's public API (no auth required)
// Alternative: CoinGecko, CoinMarketCap, or other pricing APIs

export interface TokenPrice {
  symbol: string
  price: number
  change24h?: number
  lastUpdated: number
}

export class PricingService {
  private cache: Map<string, TokenPrice> = new Map()
  private cacheExpiry = 5 * 60 * 1000 // 5 minutes

  async getPrices(symbols: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {}
    const symbolsToFetch: string[] = []

    // Check cache first
    for (const symbol of symbols) {
      const cached = this.cache.get(symbol)
      if (cached && Date.now() - cached.lastUpdated < this.cacheExpiry) {
        prices[symbol] = cached.price
      } else {
        symbolsToFetch.push(symbol)
      }
    }

    // Fetch missing prices
    if (symbolsToFetch.length > 0) {
      try {
        const newPrices = await this.fetchPrices(symbolsToFetch)
        Object.assign(prices, newPrices)
      } catch (error) {
        console.warn('Failed to fetch some prices, using cached/fallback values:', error)
        
        // Use fallback prices for critical tokens
        const fallbacks = {
          'ETH': 2500, // Approximate fallback
          'USDC': 1,   // Stablecoin
          'USDT': 1,   // Stablecoin
        }

        for (const symbol of symbolsToFetch) {
          if (!prices[symbol]) {
            prices[symbol] = fallbacks[symbol as keyof typeof fallbacks] || 0
          }
        }
      }
    }

    return prices
  }

  private async fetchPrices(symbols: string[]): Promise<Record<string, number>> {
    try {
      // Use Coinbase's public exchange rates API
      // This doesn't require authentication and provides good coverage for major tokens
      const prices: Record<string, number> = {}
      
      for (const symbol of symbols) {
        try {
          const response = await fetch(
            `https://api.coinbase.com/v2/exchange-rates?currency=${symbol}`,
            {
              headers: {
                'Accept': 'application/json',
              },
            }
          )

          if (response.ok) {
            const data = await response.json()
            const usdRate = parseFloat(data.data.rates.USD)
            
            if (!isNaN(usdRate)) {
              prices[symbol] = usdRate
              
              // Cache the result
              this.cache.set(symbol, {
                symbol,
                price: usdRate,
                lastUpdated: Date.now(),
              })
            }
          }
        } catch (error) {
          console.warn(`Failed to fetch price for ${symbol}:`, error)
        }

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Fallback to CoinGecko if Coinbase fails for any symbol
      const missingSymbols = symbols.filter(s => !prices[s])
      if (missingSymbols.length > 0) {
        await this.fetchFromCoinGecko(missingSymbols, prices)
      }

      return prices
    } catch (error) {
      console.error('Failed to fetch prices:', error)
      throw error
    }
  }

  private async fetchFromCoinGecko(symbols: string[], prices: Record<string, number>): Promise<void> {
    try {
      // Map symbols to CoinGecko IDs
      const geckoIds: Record<string, string> = {
        'ETH': 'ethereum',
        'USDC': 'usd-coin',
        'USDT': 'tether',
        'BTC': 'bitcoin',
      }

      const ids = symbols.map(s => geckoIds[s]).filter(Boolean)
      if (ids.length === 0) return

      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      )

      if (response.ok) {
        const data = await response.json()
        
        // Map back to symbols
        for (const symbol of symbols) {
          const geckoId = geckoIds[symbol]
          if (geckoId && data[geckoId] && data[geckoId].usd) {
            const price = data[geckoId].usd
            prices[symbol] = price
            
            // Cache the result
            this.cache.set(symbol, {
              symbol,
              price,
              lastUpdated: Date.now(),
            })
          }
        }
      }
    } catch (error) {
      console.warn('CoinGecko fallback failed:', error)
    }
  }

  async getPrice(symbol: string): Promise<number> {
    const prices = await this.getPrices([symbol])
    return prices[symbol] || 0
  }

  clearCache(): void {
    this.cache.clear()
  }
}
