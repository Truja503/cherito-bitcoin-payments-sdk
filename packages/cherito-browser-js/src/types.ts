export interface CheritoBrowserConfig {
  publishableKey: string
  environment?: 'sandbox' | 'production'
  customBaseUrl?: string
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
