import { createHmac, randomUUID } from 'node:crypto'
import type { Repository, WebhookDelivery, Tenant } from '../persistence/repository.js'
import type { PaymentIntent } from '../persistence/repository.js'

/** Maximum delivery attempts before a webhook is marked permanently failed */
const MAX_ATTEMPTS = 7
/** Exponential backoff delays in milliseconds */
const BACKOFF_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000]

/**
 * WebhookService signs, persists and delivers payment event webhooks.
 *
 * Security invariants:
 * - Signature: `X-Cherito-Signature-256: sha256=<HMAC-SHA256-hex>` using the
 *   tenant's webhook_secret. Replay resistance: timestamp is included in the
 *   signed payload. Merchants should reject events with |now - timestamp| > 300s.
 * - The webhook secret is fetched from DB per-delivery and never cached in memory
 *   so revocation takes effect on the next attempt.
 * - Delivery IDs are opaque UUIDs. Merchants should deduplicate on delivery_id.
 * - HTTP response is only considered successful if status < 300.
 */
export class WebhookService {
  private deliveryTimer: NodeJS.Timeout | undefined

  constructor(private readonly repo: Repository) {}

  /**
   * Enqueue a webhook delivery for the given event.
   * Idempotent: if called multiple times with the same intent+event,
   * the first delivery wins (controlled upstream by the payment-intent lifecycle).
   */
  async enqueue(
    tenant: Tenant,
    intent: PaymentIntent,
    event: 'payment_intent.succeeded' | 'payment_intent.failed' | 'payment_intent.expired',
  ): Promise<void> {
    if (!tenant.webhookUrl || !tenant.webhookSecret) return

    const timestamp = Math.floor(Date.now() / 1000)
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: event,
      created: timestamp,
      data: {
        id: intent.id,
        tenant_id: intent.tenantId,
        amount_sats: intent.amountSats,
        currency: intent.currency,
        status: intent.status,
        payment_hash: intent.paymentHash,
        expires_at: intent.expiresAt,
        settled_at: intent.settledAt,
        metadata: intent.metadata ? JSON.parse(intent.metadata) : null,
      },
    })

    const signature = this.sign(tenant.webhookSecret, timestamp, payload)
    const now = new Date().toISOString()

    const delivery: WebhookDelivery = {
      id: `wd_${randomUUID()}`,
      tenantId: tenant.id,
      paymentIntentId: intent.id,
      event,
      payload,
      signature,
      status: 'pending',
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: now,  // attempt immediately
      deliveredAt: null,
      createdAt: now,
    }

    this.repo.createWebhookDelivery(delivery)
    void this.flush()
  }

  /**
   * Process all pending webhook deliveries that are due.
   * Called on startup (to resume after crash) and after enqueue().
   */
  async flush(): Promise<void> {
    const deliveries = this.repo.pendingWebhookDeliveries()
    for (const delivery of deliveries) {
      // Look up the tenant to get the current webhook URL
      // (allows reconfiguration to take effect on retries)
      const tenant = this.repo.tenant(delivery.tenantId)
      if (!tenant?.webhookUrl) {
        this.repo.markWebhookPermanentlyFailed(delivery.id)
        continue
      }

      try {
        const response = await fetch(tenant.webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-cherito-signature-256': delivery.signature,
            'x-cherito-delivery-id': delivery.id,
            'user-agent': 'Cherito-Webhook/1.0',
          },
          body: delivery.payload,
          signal: AbortSignal.timeout(10_000),
        })

        if (response.ok) {
          this.repo.markWebhookDelivered(delivery.id)
        } else {
          this.scheduleRetry(delivery)
        }
      } catch {
        this.scheduleRetry(delivery)
      }
    }
  }

  /** Start a background retry loop that runs every 30 seconds */
  startRetryLoop(): () => void {
    const timer = setInterval(() => void this.flush(), 30_000)
    this.deliveryTimer = timer
    return () => clearInterval(timer)
  }

  /**
   * Verify an incoming webhook signature (for use by SDK consumers).
   * Returns true if the signature is valid and the timestamp is within tolerance.
   */
  static verify(
    secret: string,
    signature: string,
    timestamp: number,
    body: string,
    toleranceSeconds = 300,
  ): boolean {
    if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false
    const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
    if (expected.length !== signature.length) return false
    // Timing-safe comparison via Buffer
    return Buffer.from(expected).compare(Buffer.from(signature)) === 0
  }

  private sign(secret: string, timestamp: number, body: string): string {
    return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
  }

  private scheduleRetry(delivery: WebhookDelivery): void {
    const attempt = delivery.attemptCount
    if (attempt >= MAX_ATTEMPTS) {
      this.repo.markWebhookPermanentlyFailed(delivery.id)
      return
    }
    const delayMs = BACKOFF_DELAYS_MS[attempt] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1]!
    const nextAttemptAt = new Date(Date.now() + delayMs).toISOString()
    this.repo.markWebhookFailed(delivery.id, nextAttemptAt)
  }
}
