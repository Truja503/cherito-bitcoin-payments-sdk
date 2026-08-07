import type {
  LightningReceiveProvider,
  LightningCapabilities,
  PublicNodeInfo,
  CreateInvoiceInput,
  CreatedInvoice,
  LightningInvoice
} from './provider.js'

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
      supportsWebSockets: false,
      supportsBolt12: true, // CLN has experimental BOLT12 support
      supportsAmp: false,
    }
  }

  async getNodeInfo(): Promise<PublicNodeInfo> {
    // Mock implementation for demo
    return {
      pubkey: '02corelightningnode00000000000000000000000000000000000000000000000',
      alias: 'Core Lightning Node',
      color: '#000000',
      activeChannelsCount: 10,
      uris: []
    }
  }

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    // Mock implementation
    const hash = 'clnhash' + Date.now()
    return {
      paymentHash: hash,
      paymentRequest: 'lnbc100n1...mock_cln_invoice...',
      addIndex: Date.now().toString(),
      expiresAt: new Date(Date.now() + (input.expirySeconds || 3600) * 1000).toISOString()
    }
  }

  async getInvoice(paymentHash: string): Promise<LightningInvoice> {
    return {
      paymentHash,
      paymentRequest: 'lnbc100n1...mock_cln_invoice...',
      amountSats: '100',
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString()
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
