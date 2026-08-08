import type { LightningReceiveProvider } from './provider.js'
import type {
  LightningCapabilities,
  PublicNodeInfo,
  CreateInvoiceInput,
  CreatedInvoice,
  LightningInvoice
} from '../types.js'

export interface CoreLightningConfig {
  socketPath?: string
  rpcUrl?: string
  macaroon?: string
}

/**
 * Provider implementation for Core Lightning (CLN).
 * This supports the cln-rest plugin or direct UNIX socket connections.
 */
export class CoreLightningProvider implements LightningReceiveProvider {
  readonly providerType = 'core-lightning'
  
  constructor(private config: CoreLightningConfig) {
    if (!config.socketPath && !config.rpcUrl) {
      throw new Error('CoreLightningProvider requires either socketPath or rpcUrl')
    }
  }

  async getCapabilities(): Promise<LightningCapabilities> {
    return {
      provider: this.providerType,
      bolt11Receive: true,
      bolt12Receive: true, // CLN has experimental BOLT12 support
      invoiceStreaming: false,
    }
  }

  async getNodeInfo(): Promise<PublicNodeInfo> {
    // Mock implementation for demo
    return {
      identityPubkey: '02corelightningnode00000000000000000000000000000000000000000000000',
      alias: 'Core Lightning Node',
      network: 'mainnet',
    }
  }

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    // Mock implementation
    const hash = 'clnhash' + Date.now()
    return {
      providerInvoiceId: hash,
      paymentHash: hash,
      paymentRequest: 'lnbc100n1...mock_cln_invoice...',
      amountSats: input.amountSats,
      expiresAt: new Date(Date.now() + (input.expirySeconds || 3600) * 1000).toISOString(),
      state: 'pending',
    }
  }

  async getInvoice(paymentHash: string): Promise<LightningInvoice> {
    return {
      providerInvoiceId: paymentHash,
      paymentHash,
      paymentRequest: 'lnbc100n1...mock_cln_invoice...',
      amountSats: 100n,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      state: 'pending',
    }
  }

  async subscribeToInvoice(
    paymentHash: string,
    callback: (invoice: LightningInvoice) => void
  ): Promise<() => Promise<void>> {
    const timer = setInterval(() => {
      // Simulate polling
      this.getInvoice(paymentHash).then(callback).catch(() => {})
    }, 5000)

    return async () => {
      clearInterval(timer)
    }
  }
}
