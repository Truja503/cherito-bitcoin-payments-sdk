import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { invoiceStateToIntentStatus } from '@cherito/bitcoin-sdk'
import type { LightningReceiveProvider, Bolt12ReceiveProvider } from '@cherito/bitcoin-sdk'
import type { Config } from '../config.js'
import type {
  Repository,
  PaymentIntent,
  PricingRule,
} from '../persistence/repository.js'
import type { WebhookService } from './webhook-service.js'

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/**
 * Public projection of a PaymentIntent returned to the merchant backend.
 * Never contains client_secret or full internal state.
 */
export interface PaymentIntentResponse {
  id: string
  tenantId: string
  amountSats: string
  currency: 'sat'
  description: string
  status: string
  paymentRequest: string
  paymentHash: string
  expiresAt: string
  settledAt: string | null
  createdAt: string
  /** Scoped token for the browser to track payment status (short-lived, read-only) */
  clientSecret: string
}

/**
 * Public (browser-safe) projection of a PaymentIntent.
 * No credentials are included.
 */
export interface PaymentIntentPublic {
  id: string
  amountSats: string
  currency: 'sat'
  description: string
  status: string
  paymentRequest: string
  expiresAt: string
}

/**
 * PaymentIntentService manages the full lifecycle of a Payment Intent:
 * create → watch (subscribe to provider) → settle → webhook
 *
 * Security invariants:
 * - Amount is always server-controlled (from PricingRule or explicit merchant input)
 * - Browser clients receive only a scoped clientSecret, never the merchant API key
 * - Settlement is derived exclusively from provider callbacks; browser cannot
 *   claim payment success
 * - Cross-tenant access is refused: all queries are scoped to the verified tenantId
 */
export class PaymentIntentService {
  private listeners = new Map<string, Set<(s: PaymentIntent) => void>>()

  constructor(
    private readonly lnd: LightningReceiveProvider,
    private readonly bolt12: Bolt12ReceiveProvider | undefined,
    private readonly repo: Repository,
    private readonly config: Config,
    private readonly webhookService?: WebhookService,
  ) {}

  // ---- Creation ------------------------------------------------------------

  async create(input: {
    tenantId: string
    /** productId from the tenant's PricingRule catalog */
    productId: string
    quantity?: number
    description?: string
    metadata?: Record<string, unknown>
    idempotencyKey?: string
    paymentLinkId?: string
    pricingRuleId?: string
    /** Explicit amount override (for non-catalog intents); must be positive */
    amountSats?: bigint
  }): Promise<PaymentIntentResponse> {
    const {
      tenantId,
      productId,
      quantity = 1,
      idempotencyKey,
      paymentLinkId = null,
    } = input

    // --- Idempotency check --------------------------------------------------
    if (idempotencyKey) {
      const payloadHash = sha256(JSON.stringify({ productId, quantity }))
      const existing = this.repo.paymentIntentByIdempotencyKey(tenantId, idempotencyKey)
      if (existing) {
        if (existing.idempotencyPayloadHash !== payloadHash) {
          throw Object.assign(
            new Error('Idempotency key payload conflict'),
            { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' },
          )
        }
        return this.toResponse(existing)
      }
    }

    // --- Pricing (server-controlled) ----------------------------------------
    let amountSats: bigint
    let pricingRuleId: string | null = null

    if (input.amountSats !== undefined) {
      // Programmatic intent with explicit amount
      amountSats = input.amountSats
    } else {
      const rule = this.repo.pricingRule(tenantId, productId)
      if (!rule?.active) {
        throw Object.assign(new Error('Product unavailable'), { statusCode: 404, code: 'PRODUCT_NOT_FOUND' })
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > rule.maxQuantity) {
        throw Object.assign(new Error('Quantity is invalid'), { statusCode: 400, code: 'INVALID_QUANTITY' })
      }
      amountSats = BigInt(rule.priceSats) * BigInt(quantity)
      pricingRuleId = rule.id
    }

    if (amountSats < this.config.MIN_INVOICE_SATS || amountSats > this.config.MAX_INVOICE_SATS) {
      throw Object.assign(
        new Error('Amount is outside merchant limits'),
        { statusCode: 400, code: 'AMOUNT_OUT_OF_RANGE' },
      )
    }

    // --- Create invoice with Lightning provider ----------------------------
    const intentId = `pi_${randomUUID()}`
    const description = input.description ?? `Payment ${intentId}`
    const invoice = await this.lnd.createInvoice({
      orderId: intentId,
      amountSats,
      memo: description.slice(0, 120),
      expirySeconds: this.config.DEFAULT_INVOICE_EXPIRY_SECONDS,
    })

    // --- Scoped client secret (short-lived token for browser polling) -------
    const clientSecret = `cs_${randomBytes(32).toString('base64url')}`
    const now = new Date().toISOString()

    const intent: PaymentIntent = {
      id: intentId,
      tenantId,
      pricingRuleId,
      paymentLinkId,
      amountSats: amountSats.toString(),
      currency: 'sat',
      description,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      status: 'requires_payment',
      paymentRequest: invoice.paymentRequest,
      paymentHash: invoice.paymentHash,
      providerInvoiceId: invoice.providerInvoiceId,
      clientSecretHash: sha256(clientSecret),
      idempotencyKey: idempotencyKey ?? null,
      idempotencyPayloadHash: idempotencyKey
        ? sha256(JSON.stringify({ productId, quantity }))
        : null,
      expiresAt: invoice.expiresAt,
      settledAt: null,
      createdAt: now,
      updatedAt: now,
    }

    this.repo.createPaymentIntent(intent)

    // Start watching for settlement (non-blocking)
    void this.watch(intent)

    return { ...this.toResponse(intent), clientSecret }
  }

  // ---- Payment Links -------------------------------------------------------

  async createFromPaymentLink(slug: string): Promise<PaymentIntentResponse> {
    const link = this.repo.paymentLinkBySlug(slug)
    if (!link || !link.active) {
      throw Object.assign(
        new Error('Payment link not found or inactive'),
        { statusCode: 404, code: 'PAYMENT_LINK_NOT_FOUND' },
      )
    }

    // Enforce max uses
    if (link.maxUses !== null && link.useCount >= link.maxUses) {
      throw Object.assign(
        new Error('Payment link has reached its maximum number of uses'),
        { statusCode: 410, code: 'PAYMENT_LINK_EXHAUSTED' },
      )
    }

    // Enforce expiry
    if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) {
      throw Object.assign(
        new Error('Payment link has expired'),
        { statusCode: 410, code: 'PAYMENT_LINK_EXPIRED' },
      )
    }

    // Amount is always server-controlled; link.amountSats cannot be overridden
    let amountSats: bigint
    let productId = 'payment-link'

    if (link.amountSats !== null) {
      amountSats = BigInt(link.amountSats)
    } else if (link.pricingRuleId) {
      // Resolve via pricing rule
      const tenant = this.repo.tenant(link.tenantId)
      if (!tenant) {
        throw Object.assign(new Error('Tenant not found'), { statusCode: 500, code: 'INTERNAL_ERROR' })
      }
      const rule = this.repo.pricingRule(link.tenantId, link.pricingRuleId) as PricingRule | undefined
      if (!rule?.active) {
        throw Object.assign(new Error('Product unavailable'), { statusCode: 404, code: 'PRODUCT_NOT_FOUND' })
      }
      amountSats = BigInt(rule.priceSats)
      productId = rule.productId
    } else {
      // Open amount — not supported yet; require explicit amount on the link
      throw Object.assign(
        new Error('Open-amount payment links are not yet supported'),
        { statusCode: 501, code: 'OPEN_AMOUNT_NOT_SUPPORTED' },
      )
    }

    this.repo.incrementPaymentLinkUseCount(link.id)

    return this.create({
      tenantId: link.tenantId,
      productId,
      description: link.label,
      amountSats,
      paymentLinkId: link.id,
    })
  }

  // ---- Authorization (browser) --------------------------------------------

  /**
   * Verify a client_secret and return the intent if valid.
   * Scopes the lookup to the intent ID to prevent cross-intent enumeration.
   * Uses timing-safe comparison.
   */
  authorize(
    intentId: string,
    tenantId: string,
    clientSecret: string,
  ): PaymentIntent | undefined {
    const intent = this.repo.paymentIntent(intentId, tenantId)
    if (!intent) return undefined

    const a = Buffer.from(intent.clientSecretHash)
    const b = Buffer.from(sha256(clientSecret))
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined

    return intent
  }

  // ---- SSE listeners -------------------------------------------------------

  listen(id: string, callback: (s: PaymentIntent) => void): () => void {
    const set = this.listeners.get(id) ?? new Set()
    set.add(callback)
    this.listeners.set(id, set)
    return () => set.delete(callback)
  }

  // ---- Recovery (restart) -------------------------------------------------

  /**
   * Re-subscribe to all pending/processing intents that were active at the
   * time of the last shutdown. Must be called at server startup before
   * accepting new requests.
   */
  async recoverPendingIntents(): Promise<void> {
    const pending = this.repo.pendingPaymentIntents()
    await Promise.all(
      pending.map((intent) =>
        this.watch(intent).catch((err: unknown) => {
          // Non-fatal: log and continue; the intent remains in DB
          console.warn(
            JSON.stringify({
              level: 'warn',
              code: 'RECOVERY_WATCH_FAILED',
              intentId: intent.id,
              message: err instanceof Error ? err.message : 'Unknown',
            }),
          )
        }),
      ),
    )
  }

  // ---- Public projections --------------------------------------------------

  toPublic(intent: PaymentIntent): PaymentIntentPublic {
    return {
      id: intent.id,
      amountSats: intent.amountSats,
      currency: intent.currency,
      description: intent.description,
      status: intent.status,
      paymentRequest: intent.paymentRequest,
      expiresAt: intent.expiresAt,
    }
  }

  private toResponse(intent: PaymentIntent): PaymentIntentResponse {
    // clientSecret is NOT included in toResponse when called from idempotency cache
    // because we no longer have the plaintext. Callers that need it must include it
    // separately at creation time.
    return {
      id: intent.id,
      tenantId: intent.tenantId,
      amountSats: intent.amountSats,
      currency: intent.currency,
      description: intent.description,
      status: intent.status,
      paymentRequest: intent.paymentRequest,
      paymentHash: intent.paymentHash,
      expiresAt: intent.expiresAt,
      settledAt: intent.settledAt,
      createdAt: intent.createdAt,
      clientSecret: '',  // populated only at creation time
    }
  }

  // ---- Provider subscription ----------------------------------------------

  private async watch(intent: PaymentIntent): Promise<void> {
    await this.lnd.subscribeToInvoice(intent.paymentHash, (lndInvoice) => {
      const newStatus = invoiceStateToIntentStatus(lndInvoice.state)
      this.repo.updatePaymentIntentStatus(intent.paymentHash, lndInvoice, newStatus)

      const updated = this.repo.paymentIntentByHash(intent.paymentHash)
      if (!updated) return

      // Notify SSE listeners
      for (const listener of this.listeners.get(intent.id) ?? []) {
        listener(updated)
      }

      // Trigger webhook for terminal states
      if (
        newStatus === 'succeeded' ||
        newStatus === 'failed' ||
        newStatus === 'expired'
      ) {
        const tenant = this.repo.tenant(intent.tenantId)
        if (tenant && this.webhookService) {
          void this.webhookService.enqueue(
            tenant,
            updated,
            newStatus === 'succeeded'
              ? 'payment_intent.succeeded'
              : newStatus === 'expired'
                ? 'payment_intent.expired'
                : 'payment_intent.failed',
          )
        }
      }
    })
  }
}
