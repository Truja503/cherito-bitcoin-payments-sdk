import type { CheritoBrowserConfig, PaymentIntentResponse } from './types.js'

export class CheritoBrowserClient {
  private readonly baseUrl: string
  private readonly publishableKey: string

  constructor(config: CheritoBrowserConfig) {
    if (!config.publishableKey) {
      throw new Error('Publishable Key is required to initialize CheritoBrowserClient.')
    }
    this.publishableKey = config.publishableKey
    
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
    headers.set('Authorization', `Bearer ${this.publishableKey}`)
    headers.set('Content-Type', 'application/json')
    headers.set('Accept', 'application/json')

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
   * Retrieves an existing Payment Intent by ID. 
   * Useful for client-side polling.
   */
  async getPaymentIntent(id: string): Promise<PaymentIntentResponse> {
    return this.request<PaymentIntentResponse>(`/v1/payment-intents/${encodeURIComponent(id)}`, {
      method: 'GET',
    })
  }
}
