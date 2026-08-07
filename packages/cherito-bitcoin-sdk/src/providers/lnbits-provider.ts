import { LightningError } from '../errors.js'
import type { LightningReceiveProvider } from './provider.js'
import type {
  LightningCapabilities,
  PublicNodeInfo,
  CreateInvoiceInput,
  CreatedInvoice,
  LightningInvoice,
} from '../types.js'

export interface LnbitsProviderConfig {
  url: string
  apiKey: string
}

export class LnbitsProvider implements LightningReceiveProvider {
  readonly providerType = 'external' as const
  private url: string
  private apiKey: string

  constructor(config: LnbitsProviderConfig) {
    this.url = config.url.replace(/\/$/, '') // strip trailing slash
    this.apiKey = config.apiKey
  }

  async getCapabilities(): Promise<LightningCapabilities> {
    return {
      bolt11Receive: true,
      bolt12Receive: false,
      invoiceStreaming: false, // Emulated via polling
      provider: 'external',
    }
  }

  async getNodeInfo(): Promise<PublicNodeInfo> {
    return {
      alias: 'LNbits Wallet',
      network: 'mainnet', // Assuming mainnet, though it could be anything
      syncedToChain: true,
      syncedToGraph: true,
    }
  }

  private async fetchApi(path: string, options: RequestInit = {}) {
    const url = `${this.url}${path}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    
    if (!response.ok) {
      throw new LightningError('PROVIDER_UNAVAILABLE', `LNbits API error: ${response.statusText}`)
    }
    
    return response.json()
  }

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    try {
      const result = await this.fetchApi('/api/v1/payments', {
        method: 'POST',
        body: JSON.stringify({
          out: false,
          amount: Number(input.amountSats),
          memo: input.memo,
          expiry: input.expirySeconds,
        })
      })

      if (!result.payment_hash || !result.payment_request) {
        throw new LightningError('INVALID_RESPONSE', 'Invalid response from LNbits createInvoice')
      }

      const expiresAt = new Date(Date.now() + input.expirySeconds * 1000).toISOString()

      return {
        providerInvoiceId: result.payment_hash,
        paymentHash: result.payment_hash,
        paymentRequest: result.payment_request,
        amountSats: input.amountSats,
        expiresAt,
        state: 'pending',
      }
    } catch (e) {
      if (e instanceof LightningError) throw e
      throw new LightningError('PROVIDER_UNAVAILABLE', 'Failed to contact LNbits')
    }
  }

  async getInvoice(paymentHash: string): Promise<LightningInvoice> {
    try {
      const result = await this.fetchApi(`/api/v1/payments/${paymentHash}`)
      
      // LNbits API returns { paid: boolean, details: { pending: boolean, ... } }
      // If it's paid, paid is true.
      
      const state = result.paid ? 'settled' : 'pending'
      
      return {
        providerInvoiceId: paymentHash,
        paymentHash: paymentHash,
        paymentRequest: result.details?.bolt11 || '', // Might not be returned in all endpoints, but we only need state usually here
        amountSats: BigInt(Math.floor((result.details?.amount || 0) / 1000)),
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // Mock expiry
        state,
        settledAt: result.paid ? new Date().toISOString() : undefined,
        amountPaidSats: result.paid ? BigInt(Math.floor((result.details?.amount || 0) / 1000)) : undefined,
      }
    } catch (e) {
      if (e instanceof LightningError) throw e
      throw new LightningError('PROVIDER_UNAVAILABLE', 'Failed to fetch invoice from LNbits')
    }
  }

  async subscribeToInvoice(
    paymentHash: string,
    callback: (invoice: LightningInvoice) => void
  ): Promise<() => Promise<void>> {
    // Emulate streaming with polling since LNbits REST doesn't have an easy single-invoice stream
    const interval = setInterval(async () => {
      try {
        const inv = await this.getInvoice(paymentHash)
        if (inv.state === 'settled' || inv.state === 'canceled' || inv.state === 'expired') {
          callback(inv)
          clearInterval(interval)
        }
      } catch (e) {
        // ignore fetch errors during polling
      }
    }, 5000)

    return async () => {
      clearInterval(interval)
    }
  }
}
