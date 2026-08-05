export interface LightningCapabilities {
  bolt11Receive: boolean
  bolt12Receive: boolean
  invoiceStreaming: boolean
  provider: 'lnd' | 'lndk' | 'cln' | 'external' | 'unknown'
}

export interface PublicNodeInfo {
  alias?: string
  identityPubkey?: string
  network: 'mainnet' | 'testnet' | 'signet' | 'regtest'
  syncedToChain?: boolean
  syncedToGraph?: boolean
}

export type InvoiceState = 'pending' | 'accepted' | 'settled' | 'expired' | 'canceled' | 'unknown'

/**
 * The canonical lifecycle status for a PaymentIntent.
 * - requires_payment: invoice created, awaiting payer action
 * - processing:       HTLC accepted / in-flight (ACCEPTED in LND terms)
 * - succeeded:        payment settled and confirmed by provider
 * - expired:          invoice passed its expiry without payment
 * - canceled:         explicitly canceled by the merchant
 * - failed:           terminal failure (provider reported canceled/unknown)
 */
export type PaymentIntentStatus =
  | 'requires_payment'
  | 'processing'
  | 'succeeded'
  | 'expired'
  | 'canceled'
  | 'failed'

export interface CreateInvoiceInput {
  orderId: string
  amountSats: bigint
  memo: string
  expirySeconds: number
}

export interface CreatedInvoice {
  providerInvoiceId: string
  paymentHash: string
  paymentRequest: string
  amountSats: bigint
  expiresAt: string
  state: InvoiceState
  providerAddIndex?: string
  providerSettleIndex?: string
}

export interface LightningInvoice extends CreatedInvoice {
  settledAt?: string
  amountPaidSats?: bigint
}

export interface CreateOfferInput {
  productId: string
  amountSats: bigint
  description: string
  issuer?: string
  expirySeconds?: number
}

export interface CreatedOffer {
  offerId: string
  offer: string
  amountSats: bigint
}

/** Maps an LND/CLN invoice state to the canonical PaymentIntentStatus */
export function invoiceStateToIntentStatus(state: InvoiceState): PaymentIntentStatus {
  switch (state) {
    case 'pending':  return 'requires_payment'
    case 'accepted': return 'processing'
    case 'settled':  return 'succeeded'
    case 'expired':  return 'expired'
    case 'canceled': return 'canceled'
    default:         return 'failed'
  }
}
