/**
 * ERC-681 Inspired URL Parser for Transaction Requests
 * 
 * Adapts the ERC-681 standard (ethereum: URIs) to HTTPS URLs for web-based
 * transaction confirmation flows.
 * 
 * Standard ERC-681 format:
 *   ethereum:0xTokenContract@chainId/transfer?address=0xRecipient&uint256=Amount
 * 
 * Our HTTPS adaptation:
 *   https://wallet.opkproto.com/r/pay?token=0x...&chain=84532&fn=transfer&to=0x...&amount=1
 */

import { isAddress, type Address } from 'viem'

/**
 * Supported function types for ERC-681 requests
 */
export type ERC681Function = 'transfer' | 'approve'

/**
 * Parsed ERC-681 transaction request
 */
export interface ERC681Request {
  /** ERC20 token contract address */
  token: Address
  /** Target chain ID */
  chainId: number
  /** Function to call */
  fn: ERC681Function
  /** Recipient address (for transfer) or spender (for approve) */
  to: Address
  /** Human-readable amount (will be converted using token decimals) */
  amount: string
  /** Optional: source identifier (e.g., 'clip' for App Clip, 'nfc' for NFC) */
  src?: string
}

/**
 * Validation result for ERC-681 parsing
 */
export interface ERC681ParseResult {
  success: boolean
  request?: ERC681Request
  error?: string
}

/**
 * Supported chain IDs and their names
 */
export const SUPPORTED_CHAINS: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  84532: 'Base Sepolia',
  11155111: 'Sepolia',
}

/**
 * Parsed EIP-681 transfer request (from raw ethereum: URI)
 */
export interface EIP681TransferRequest {
  token: Address
  chainId: number
  to: Address
  amount: bigint
  /** Optional PID for payment matching (stripped from query, not part of EIP-681) */
  pid?: string
}

/**
 * Parse raw EIP-681 URI: ethereum:0xToken@chainId/transfer?address=0xRecipient&uint256=Amount
 * Used for /staticpayment?p=... where p is URL-encoded EIP-681 string.
 * Strips &pid=xxx from the query (not part of EIP-681, used for backend matching).
 */
export function parseEIP681Uri(uri: string): { success: boolean; request?: EIP681TransferRequest; error?: string } {
  if (!uri || !uri.startsWith('ethereum:')) {
    return { success: false, error: 'Invalid EIP-681 URI' }
  }
  try {
    const rest = uri.slice(9) // after "ethereum:"
    const atIdx = rest.indexOf('@')
    const slashIdx = rest.indexOf('/')
    if (atIdx < 0 || slashIdx < 0 || slashIdx <= atIdx) {
      return { success: false, error: 'Invalid EIP-681 format' }
    }
    const token = rest.slice(0, atIdx).trim()
    const chainIdStr = rest.slice(atIdx + 1, slashIdx).trim()
    const pathAndQuery = rest.slice(slashIdx + 1)
    if (!pathAndQuery.startsWith('transfer?')) {
      return { success: false, error: 'Only transfer function supported' }
    }
    const query = pathAndQuery.slice(9)
    const params = new URLSearchParams(query)
    const pid = params.get('pid') ?? undefined
    params.delete('pid')
    const address = params.get('address')
    const uint256 = params.get('uint256')
    if (!address || !uint256) {
      return { success: false, error: 'Missing address or uint256' }
    }
    if (!isAddress(token)) return { success: false, error: 'Invalid token address' }
    if (!isAddress(address)) return { success: false, error: 'Invalid recipient address' }
    const chainId = parseInt(chainIdStr, 10)
    if (isNaN(chainId) || chainId <= 0) return { success: false, error: 'Invalid chain ID' }
    const amount = BigInt(uint256)
    if (amount <= 0n) return { success: false, error: 'Invalid amount' }
    return {
      success: true,
      request: { token: token as Address, chainId, to: address as Address, amount, pid },
    }
  } catch {
    return { success: false, error: 'Failed to parse EIP-681 URI' }
  }
}

/**
 * Parse ERC-681 inspired URL parameters into a transaction request
 * 
 * @param searchParams - URLSearchParams from the page URL
 * @returns Parsed request or error
 * 
 * @example
 * const params = new URLSearchParams(window.location.search)
 * const result = parseERC681Params(params)
 * if (result.success) {
 *   console.log(result.request.token, result.request.to, result.request.amount)
 * }
 */
export function parseERC681Params(searchParams: URLSearchParams): ERC681ParseResult {
  // Extract parameters
  const token = searchParams.get('token')
  const chain = searchParams.get('chain')
  const fn = searchParams.get('fn')
  const to = searchParams.get('to')
  const amount = searchParams.get('amount')
  const src = searchParams.get('src') || undefined

  // Validate required parameters
  if (!token) {
    return { success: false, error: 'Missing required parameter: token' }
  }
  if (!chain) {
    return { success: false, error: 'Missing required parameter: chain' }
  }
  if (!fn) {
    return { success: false, error: 'Missing required parameter: fn' }
  }
  if (!to) {
    return { success: false, error: 'Missing required parameter: to' }
  }
  if (!amount) {
    return { success: false, error: 'Missing required parameter: amount' }
  }

  // Validate token address
  if (!isAddress(token)) {
    return { success: false, error: 'Invalid token address' }
  }

  // Validate chain ID
  const chainId = parseInt(chain, 10)
  if (isNaN(chainId) || chainId <= 0) {
    return { success: false, error: 'Invalid chain ID' }
  }
  if (!SUPPORTED_CHAINS[chainId]) {
    return { 
      success: false, 
      error: `Unsupported chain ID: ${chainId}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(', ')}` 
    }
  }

  // Validate function
  if (fn !== 'transfer' && fn !== 'approve') {
    return { success: false, error: `Unsupported function: ${fn}. Supported: transfer, approve` }
  }

  // Validate recipient/spender address
  if (!isAddress(to)) {
    return { success: false, error: 'Invalid recipient address' }
  }

  // Validate amount (must be a valid number - strict check)
  // parseFloat is too lenient ("1abc" -> 1), so we use a regex
  const amountPattern = /^[0-9]+(\.[0-9]+)?$/
  if (!amountPattern.test(amount)) {
    return { 
      success: false, 
      error: `Invalid amount format: "${amount.slice(0, 20)}${amount.length > 20 ? '...' : ''}". Expected a number like "1" or "0.5". Check URL has & between parameters.`
    }
  }
  const amountNum = parseFloat(amount)
  if (isNaN(amountNum) || amountNum <= 0) {
    return { success: false, error: 'Invalid amount: must be a positive number' }
  }

  return {
    success: true,
    request: {
      token: token as Address,
      chainId,
      fn: fn as ERC681Function,
      to: to as Address,
      amount,
      src,
    },
  }
}

/**
 * Build an ERC-681 inspired URL from a transaction request
 * 
 * @param baseUrl - Base URL (e.g., 'https://wallet.opkproto.com/r/pay')
 * @param request - Transaction request to encode
 * @returns Full URL with query parameters
 */
export function buildERC681Url(baseUrl: string, request: ERC681Request): string {
  const params = new URLSearchParams()
  params.set('token', request.token)
  params.set('chain', request.chainId.toString())
  params.set('fn', request.fn)
  params.set('to', request.to)
  params.set('amount', request.amount)
  if (request.src) {
    params.set('src', request.src)
  }
  return `${baseUrl}?${params.toString()}`
}

/**
 * Get chain name from chain ID
 */
export function getChainName(chainId: number): string {
  return SUPPORTED_CHAINS[chainId] || `Unknown (${chainId})`
}

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

/**
 * Shorten an Ethereum address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

