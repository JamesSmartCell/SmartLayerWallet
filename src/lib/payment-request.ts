/**
 * Payment request signing for CoSignedPaymentRequest (PaymentHandlerDeployCandidate.sol)
 * Uses EIP-712 typed data: domain includes chainId and verifyingContract (PaymentContract)
 * User signs the EIP-712 digest with passkey
 */

import { hashTypedData, type Hex } from 'viem'
import { sign } from 'webauthn-p256'

export interface PaymentRequestStruct {
  paymentAmount: bigint
  tokenAddress: Hex
  salt: Hex
}

export interface SignedPaymentRequestStruct {
  deviceSignature: Hex
  timestamp: bigint
  paymentRequest: PaymentRequestStruct
}

export interface CoSignedPaymentRequestStruct {
  userSignature: Hex
  signedPaymentRequest: SignedPaymentRequestStruct
}

/** EIP-712 domain for SignedPaymentRequest - chainId and verifyingContract bind to chain + contract */
const PAYMENT_DOMAIN_NAME = 'PaymentHandler'
const PAYMENT_DOMAIN_VERSION = '1'

/**
 * Compute the EIP-712 digest that the user must sign for processPayment.
 * Domain: chainId, verifyingContract (PaymentContract address)
 * Primary type: SignedPaymentRequest
 * Note: Contract must verify using the same EIP-712 digest (not raw abi.encode hash)
 */
export function getPaymentRequestSignHash(
  signedPaymentRequest: SignedPaymentRequestStruct,
  chainId: number,
  contractAddress: Hex
): Hex {
  return hashTypedData({
    domain: {
      name: PAYMENT_DOMAIN_NAME,
      version: PAYMENT_DOMAIN_VERSION,
      chainId,
      verifyingContract: contractAddress,
    },
    types: {
      PaymentRequest: [
        { name: 'paymentAmount', type: 'uint256' },
        { name: 'tokenAddress', type: 'address' },
        { name: 'salt', type: 'bytes32' },
      ],
      SignedPaymentRequest: [
        { name: 'deviceSignature', type: 'bytes' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'paymentRequest', type: 'PaymentRequest' },
      ],
    },
    primaryType: 'SignedPaymentRequest',
    message: signedPaymentRequest,
  })
}

/**
 * Sign the payment request hash with passkey (raw sign, no message prefix)
 */
export async function signPaymentRequestHash(
  hash: Hex,
  credentialId: string,
  rpId: string
): Promise<Hex> {
  const { signature } = await sign({
    hash,
    credentialId,
    rpId,
  })
  return signature
}

/**
 * Build CoSignedPaymentRequest as JSON-serializable object for API
 */
export function buildCoSignedPaymentRequestJson(
  userSignature: Hex,
  signedPaymentRequest: SignedPaymentRequestStruct
): CoSignedPaymentRequestStruct {
  return {
    userSignature,
    signedPaymentRequest,
  }
}
