/**
 * Payment error decoding for processPaymentDirect and related flows.
 * Maps contract revert selectors to user-friendly messages.
 */

import { keccak256, toBytes, slice, toHex } from 'viem'

// PaymentHandlerDeployCandidate custom errors (selector = first 4 bytes of keccak256("ErrorName()"))
const PAYMENT_ERROR_SELECTORS: Record<string, string> = {}
const PAYMENT_ERROR_SIGS = [
  'InvalidValidatorSignature()',
  'DeviceAddressRequestAlreadyUsed()',
  'InvalidServerSignature()',
  'ZeroFeeRecipient()',
  'FeeBpsTooHigh()',
  'FeeRecipientNotSet()',
  'PaymentRequestAlreadyUsed()',
  'InvalidPaymentAmount()',
  'InvalidSalt()',
  'InvalidPaymentAddress()',
  'DevicePaymentAddressNotRegistered()',
  'UnauthorizedScriptSetter()',
  'TokenNotWhiteListed()',
  'PaymentRequestExpired()',
] as const

for (const sig of PAYMENT_ERROR_SIGS) {
  const sel = toHex(slice(keccak256(toBytes(sig)), 0, 4))
  PAYMENT_ERROR_SELECTORS[sel] = sig.replace(/\(\)$/, '')
}

// User-friendly messages
const ERROR_MESSAGES: Record<string, string> = {
  InvalidValidatorSignature: 'Invalid device validator signature.',
  DeviceAddressRequestAlreadyUsed: 'Device address request already used.',
  InvalidServerSignature: 'Invalid server signature.',
  ZeroFeeRecipient: 'Fee recipient not configured.',
  FeeBpsTooHigh: 'Fee configuration error.',
  FeeRecipientNotSet: 'Fee recipient not configured. Please try again later.',
  PaymentRequestAlreadyUsed: 'This payment request was already used. Scan the NFC tag again for a fresh request.',
  InvalidPaymentAmount: 'Invalid payment amount.',
  InvalidSalt: 'Invalid payment request.',
  InvalidPaymentAddress: 'Invalid payment address.',
  DevicePaymentAddressNotRegistered: 'Device not registered for payments. The merchant needs to set up the payment terminal.',
  UnauthorizedScriptSetter: 'Unauthorized.',
  TokenNotWhiteListed: 'This token is not accepted. Please use a supported token.',
  PaymentRequestExpired: 'Payment request expired. Scan the NFC tag again for a fresh request.',
}

// Common ERC20 / SafeERC20 revert patterns (substring match in message)
const ERC20_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /insufficient allowance|allowance.*exceeded/i, message: 'Insufficient token allowance. Please approve the token first.' },
  { pattern: /transfer amount exceeds balance|insufficient balance|ERC20: transfer amount exceeds balance/i, message: 'Insufficient token balance.' },
  { pattern: /ERC20: transfer amount exceeds allowance/i, message: 'Insufficient token allowance.' },
]

function getSelectorFromError(err: unknown): string | null {
  const data = (err as { data?: string; error?: { data?: string }; cause?: { data?: string } })?.data
    ?? (err as { error?: { data?: string } })?.error?.data
    ?? (err as { cause?: { data?: string } })?.cause?.data
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    return data.slice(0, 10)
  }
  // Some errors embed revert data in message, e.g. "execution reverted: 0x6dd72d47"
  const msg = (err as Error)?.message ?? String(err)
  const match = msg.match(/0x[a-fA-F0-9]{8}/)
  if (match) return match[0].length === 10 ? match[0] : match[0].slice(0, 10)
  return null
}

/**
 * Decode a payment-related revert into a user-friendly message.
 */
export function decodePaymentError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err)

  // Check ERC20 patterns first (often in message)
  for (const { pattern, message } of ERC20_PATTERNS) {
    if (pattern.test(msg)) return message
  }

  const sel = getSelectorFromError(err)
  if (sel) {
    const name = PAYMENT_ERROR_SELECTORS[sel]
    if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name]
  }

  // Fallback: try to extract any useful part
  if (msg.includes('reverted') || msg.includes('revert')) {
    return 'Transaction failed. Please try again or scan the NFC tag for a fresh request.'
  }
  return msg || 'Payment failed.'
}
