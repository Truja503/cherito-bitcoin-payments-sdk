export interface CheritoClientConfig {
  apiKey: string
  environment?: 'sandbox' | 'production'
  customBaseUrl?: string
}

export interface CreatePaymentIntentParams {
  amount: number | string // in fiat or sats depending on currency
  currency: string // e.g. 'USD', 'EUR', 'SAT'
  metadata?: Record<string, string>
  successUrl?: string
  cancelUrl?: string
}

export interface PaymentIntentResponse {
  id: string
  status: 'pending' | 'succeeded' | 'expired' | 'canceled'
  amount: string
  currency: string
  paymentHash: string
  paymentRequest: string
  expiresAt: string
  metadata: Record<string, string>
  createdAt: string
  settledAt?: string
}
