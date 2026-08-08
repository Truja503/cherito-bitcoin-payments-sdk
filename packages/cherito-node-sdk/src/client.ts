import crypto from 'node:crypto'
import type { 
  CheritoClientConfig, 
  CreatePaymentIntentParams, 
  PaymentIntentResponse 
} from './types.js'

export class CheritoClient {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(config: CheritoClientConfig) {
    if (!config.apiKey) {
      throw new Error('API Key is required to initialize CheritoClient.')
    }
    this.apiKey = config.apiKey
    
    if (config.customBaseUrl) {
      this.baseUrl = config.customBaseUrl
    } else {
      this.baseUrl = config.environment === 'sandbox' 
        ? 'https://sandbox.api.cherito.com' 
        : 'https://api.cherito.com'
    }
  }

  /**
   * Helper for internal fetch requests
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${this.apiKey}`)
    headers.set('Content-Type', 'application/json')
    headers.set('Accept', 'application/json')
    headers.set('User-Agent', 'cherito-node-sdk/1.0')

    const response = await fetch(url, { ...options, headers })
    
    if (!response.ok) {
      let errorMessage = response.statusText
      try {
        const errorBody = await response.json()
        errorMessage = errorBody.message || JSON.stringify(errorBody)
      } catch {
        // Fallback to statusText if body is not JSON
      }
      throw new Error(`Cherito API Error (${response.status}): ${errorMessage}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Creates a new Payment Intent
   */
  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResponse> {
    return this.request<PaymentIntentResponse>('/v1/payment-intents', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  /**
   * Retrieves an existing Payment Intent by ID
   */
  async getPaymentIntent(id: string): Promise<PaymentIntentResponse> {
    return this.request<PaymentIntentResponse>(`/v1/payment-intents/${encodeURIComponent(id)}`, {
      method: 'GET',
    })
  }

  /**
   * Verify the authenticity of a webhook payload.
   * Throws an error if the signature is invalid.
   */
  verifyWebhookSignature(payload: string, signature: string, webhookSecret: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex')
      
    if (signature.length !== expectedSignature.length) {
      return false
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )
  }
}
