import type { LightningCapabilities, LightningInvoice, PublicNodeInfo, CreateInvoiceInput, CreatedInvoice, CreateOfferInput, CreatedOffer } from '../types.js'

/**
 * Core provider interface for receiving Lightning payments (BOLT11).
 * Implementations must be stateless with respect to payment confirmation —
 * settlement authority comes only from the provider, never from the browser.
 */
export interface LightningReceiveProvider {
  readonly providerType: LightningCapabilities['provider']
  getCapabilities(): Promise<LightningCapabilities>
  getNodeInfo(): Promise<PublicNodeInfo>
  createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice>
  getInvoice(paymentHash: string): Promise<LightningInvoice>
  subscribeToInvoice(
    paymentHash: string,
    callback: (invoice: LightningInvoice) => void
  ): Promise<() => Promise<void>>
}

/**
 * Optional BOLT12 offer provider interface.
 * Separated from BOLT11 because BOLT12 support is experimental and
 * may be provided by a distinct daemon (e.g. LNDK alongside LND).
 */
export interface Bolt12ReceiveProvider {
  getCapabilities(): Promise<LightningCapabilities>
  createOffer(input: CreateOfferInput): Promise<CreatedOffer>
  disableOffer?(offerId: string): Promise<void>
}

/**
 * Custody classification required for external / custodial providers.
 * Must be explicit so merchants cannot accidentally use a custodial adapter
 * without acknowledging the trust boundary.
 */
export type CustodyClassification = 'self-custodial' | 'custodial' | 'non-custodial-lsp'

export interface ProviderMeta {
  providerType: LightningCapabilities['provider']
  custodyClassification: CustodyClassification
  displayName: string
}

/**
 * Factory descriptor for a Lightning provider.
 * Used to register and instantiate providers without tight coupling.
 */
export interface ProviderDescriptor<TConfig> {
  readonly meta: ProviderMeta
  create(config: TConfig): Promise<LightningReceiveProvider>
}
