/**
 * Block Explorer Utilities
 */

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerTxUrl(chainId: number, txHash: string): string {
  switch (chainId) {
    case 1:
      return `https://etherscan.io/tx/${txHash}`
    case 8453:
      return `https://basescan.org/tx/${txHash}`
    case 84532:
      return `https://sepolia.basescan.org/tx/${txHash}`
    case 11155111:
      return `https://sepolia.etherscan.io/tx/${txHash}`
    default:
      return `https://etherscan.io/tx/${txHash}`
  }
}

/**
 * Get block explorer URL for an address
 */
export function getExplorerAddressUrl(chainId: number, address: string): string {
  switch (chainId) {
    case 1:
      return `https://etherscan.io/address/${address}`
    case 8453:
      return `https://basescan.org/address/${address}`
    case 84532:
      return `https://sepolia.basescan.org/address/${address}`
    case 11155111:
      return `https://sepolia.etherscan.io/address/${address}`
    default:
      return `https://etherscan.io/address/${address}`
  }
}
