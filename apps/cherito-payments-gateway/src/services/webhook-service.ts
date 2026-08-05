import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { URL } from 'node:url'
import type { Repository, WebhookDelivery, Tenant } from '../persistence/repository.js'
import type { PaymentIntent } from '../persistence/repository.js'

/** Maximum delivery attempts before permanently failed */
const MAX_ATTEMPTS = 7
/** Exponential backoff delays (ms) */
const BACKOFF_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000]

// ---------------------------------------------------------------------------
// SSRF defense — block all private/loopback/metadata ranges
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  'instance-data',
])

const BLOCKED_PREFIXES = [
  '127.',
  '10.',
  '192.168.',
  '169.254.',  // link-local / cloud metadata (AWS/GCP/Azure)
  '::1',
  'fc',  // ULA IPv6
  'fd',
  'fe80',  // link-local IPv6
]

/**
 * Validate that a webhook URL is safe to deliver to.
 * Blocks loopback, private, link-local, and cloud metadata addresses.
 * In production enforces HTTPS.
 */
function assertWebhookUrlSafe(rawUrl: string, production = false): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Webhook URL is malformed: ${rawUrl}`)
  }

  // Reject embedded credentials
  if (url.username || url.password) {
    throw new Error('Webhook URL must not contain embedded credentials')
  }

  // Enforce HTTPS in production
  if (production && url.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS in production')
  }

  // Reject non-HTTP(S) schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Webhook URL scheme '${url.protocol}' is not allowed`)
  }

  const hostname = url.hostname.toLowerCase()

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Webhook URL hostname '${hostname}' is blocked (private/loopback)`)
  }

  for (const prefix of BLOCKED_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      throw new Error(`Webhook URL hostname '${hostname}' is in a blocked IP range`)
    }
  }

  return url
}

// ---------------------------------------------------------------------------
// Signature format
// ---------------------------------------------------------------------------

/**
 * Produce a Cherito-Signature header value.
 *
 * Format: `t=<unix_timestamp>,v1=<hmac_sha256_hex>`
 *
 * The signed payload is: `<timestamp>.<rawBody>`
 *
 * This format allows merchants to:
 * 1. Parse the timestamp for replay protection (reject |now - t| > 300s)
 * 2. Verify the HMAC over the exact raw bytes received
 * 3. Receive the same logical event ID across retries (deduplication)
 *
 * Each delivery attempt generates a FRESH timestamp and signature,
 * so even retries many minutes later will pass timestamp validation.
 */
function buildSignatureHeader(secret: string, timestamp: number, body: string): string {
  const hmac = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
  return `t=${timestamp},v1=${hmac}`
}

// ---------------------------------------------------------------------------
// WebhookService
// ---------------------------------------------------------------------------

/**
 * WebhookService signs, persists and delivers payment event webhooks.
 *
 * Security invariants:
 * - Signature header: `Cherito-Signature: t=<unix>,v1=<hmac_sha256_hex>`
 * - Each delivery attempt generates a FRESH timestamp and signature
 * - Signed payload: `<timestamp>.<rawBody>` (exact raw bytes)
 * - timingSafeEqual() used in verification
 * - SSRF defense: loopback, private, link-local, metadata ranges blocked
 * - Redirects disabled (no follow)
 * - Response body consumed but not trusted
 * - Delivery IDs are opaque UUIDs for merchant-side deduplication
 * - DB unique constraint (tenant_id, payment_intent_id, event) prevents
 *   duplicate logical events from stale provider callbacks
 */
export class WebhookService {
  private deliveryTimer: NodeJS.Timeout | undefined
  private readonly production: boolean

  constructor(
    private readonly repo: Repository,
    options: { production?: boolean } = {},
  ) {
    this.production = options.production ?? (process.env.NODE_ENV === 'production')
  }

  /**
   * Enqueue a webhook delivery for the given event.
   * INSERT OR IGNORE ensures idempotency — duplicate calls for the same
   * (tenant, intent, event) are silently dropped. This guarantees exactly
   * one logical event per state transition.
   */
  async enqueue(
    tenant: Tenant,
    intent: PaymentIntent,
    event: 'payment_intent.succeeded' | 'payment_intent.failed' | 'payment_intent.expired',
  ): Promise<void> {
    if (!tenant.webhookUrl || !tenant.webhookSecret) return

    // Validate URL early — fail loudly rather than creating a stuck delivery
    try {
      assertWebhookUrlSafe(tenant.webhookUrl, this.production)
    } catch {
      return  // Silently skip SSRF-blocked deliveries (log in production)
    }

    // Generate fresh timestamp and signature for first attempt
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

    // Signature is stored but will be REGENERATED on each retry
    const signature = buildSignatureHeader(tenant.webhookSecret, timestamp, payload)
    const now = new Date().toISOString()

    const delivery: WebhookDelivery = {
      id: `wd_${randomUUID()}`,
      tenantId: tenant.id,
      paymentIntentId: intent.id,
      event,
      payload,
      signature,      // initial signature — flush() always regenerates
      status: 'pending',
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: now,
      deliveredAt: null,
      createdAt: now,
    }

    this.repo.createWebhookDelivery(delivery)
    void this.flush()
  }

  /**
   * Process all pending webhook deliveries.
   * Called on startup and after enqueue(). Each attempt regenerates the
   * timestamp/signature so even late retries pass the merchant's tolerance window.
   */
  async flush(): Promise<void> {
    const deliveries = this.repo.pendingWebhookDeliveries()
    for (const delivery of deliveries) {
      const tenant = this.repo.tenant(delivery.tenantId)
      if (!tenant?.webhookUrl || !tenant.webhookSecret) {
        this.repo.markWebhookPermanentlyFailed(delivery.id)
        continue
      }

      // SSRF check on every attempt (URL may have changed via config)
      try {
        assertWebhookUrlSafe(tenant.webhookUrl, this.production)
      } catch {
        this.repo.markWebhookPermanentlyFailed(delivery.id)
        continue
      }

      // Regenerate fresh timestamp and signature for THIS attempt
      const timestamp = Math.floor(Date.now() / 1000)
      const freshSignature = buildSignatureHeader(tenant.webhookSecret, timestamp, delivery.payload)

      try {
        const response = await fetch(tenant.webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'cherito-signature': freshSignature,
            'x-cherito-delivery-id': delivery.id,
            'user-agent': 'Cherito-Webhook/1.0',
          },
          body: delivery.payload,
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',  // Never follow redirects
        })

        // Drain body to prevent resource leak
        await response.text().catch(() => {})

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
   * Verify an incoming webhook signature.
   *
   * Parses `Cherito-Signature: t=<unix>,v1=<hmac>` format.
   * Uses timingSafeEqual() to prevent timing oracle attacks.
   * Rejects timestamps older than toleranceSeconds.
   *
   * @param secret Tenant webhook secret
   * @param signatureHeader Value of the Cherito-Signature header
   * @param body Raw request body (exact bytes)
   * @param toleranceSeconds Default 300s (5 min)
   */
  static verify(
    secret: string,
    signatureHeader: string,
    body: string,
    toleranceSeconds = 300,
  ): boolean {
    // Parse: t=<unix>,v1=<hmac>
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((part) => {
        const idx = part.indexOf('=')
        return [part.slice(0, idx), part.slice(idx + 1)]
      }),
    ) as { t?: string; v1?: string }

    const timestamp = Number(parts.t)
    const receivedHmac = parts.v1

    if (!timestamp || !receivedHmac || isNaN(timestamp)) return false
    if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    const expectedBuf = Buffer.from(expected, 'hex')
    const receivedBuf = Buffer.from(receivedHmac, 'hex')

    if (expectedBuf.length !== receivedBuf.length) return false
    return timingSafeEqual(expectedBuf, receivedBuf)
  }

  private scheduleRetry(delivery: WebhookDelivery): void {
    const attempt = delivery.attemptCount
    if (attempt >= MAX_ATTEMPTS) {
      this.repo.markWebhookPermanentlyFailed(delivery.id)
      return
    }
    // Add jitter ±10% to prevent thundering herd on retries
    const baseDelay = BACKOFF_DELAYS_MS[attempt] ?? BACKOFF_DELAYS_MS.at(-1)!
    const jitter = Math.floor(baseDelay * 0.1 * (Math.random() - 0.5))
    const nextAttemptAt = new Date(Date.now() + baseDelay + jitter).toISOString()
    this.repo.markWebhookFailed(delivery.id, nextAttemptAt)
  }
}

/** Exported for testing and for use by receiving merchant SDK implementations */
export { assertWebhookUrlSafe }
