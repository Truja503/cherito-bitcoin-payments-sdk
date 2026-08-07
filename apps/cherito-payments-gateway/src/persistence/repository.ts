import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { invoiceStateToIntentStatus } from '@cherito/bitcoin-sdk'
import type { LightningInvoice, PaymentIntentStatus, CreatedOffer } from '@cherito/bitcoin-sdk'

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string
  name: string
  webhookUrl: string | null
  webhookSecret: string | null
  createdAt: string
  updatedAt: string
}

export interface MerchantApiKey {
  id: string
  tenantId: string
  keyHash: string      // SHA-256 hex of the plaintext key — never store plaintext
  keyPrefix: string    // first 12 chars of key for display/revocation (safe)
  label: string
  createdAt: string
  revokedAt: string | null
}

/**
 * PaymentIntent is the canonical payment record. It supersedes the old
 * CheckoutSession. The browser client always works with a scoped client_secret
 * derived from this intent; the full intent record is server-only.
 *
 * Status lifecycle:
 *   requires_payment → processing → succeeded
 *                    ↓            ↓
 *                  expired     failed/canceled
 */
export interface PaymentIntent {
  id: string              // pi_<uuid>
  tenantId: string
  pricingRuleId: string | null  // null for ad-hoc intents (programmatic creation)
  paymentLinkId: string | null  // set when created via a Payment Link
  amountSats: string      // bigint serialized as decimal string
  currency: 'sat'
  description: string
  metadata: string | null // JSON string of merchant-supplied metadata (max 4KB)
  status: PaymentIntentStatus
  paymentRequest: string
  paymentHash: string
  providerInvoiceId: string
  clientSecretHash: string  // SHA-256 hex — browser sends plaintext, server compares hash
  idempotencyKey: string | null
  idempotencyPayloadHash: string | null
  expiresAt: string
  settledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PaymentLink {
  id: string            // pl_<uuid> or custom slug
  slug: string          // URL-safe slug, unique, for /v1/pay/:slug
  tenantId: string
  pricingRuleId: string | null
  amountSats: string | null  // null = open amount (payer chooses); non-null = fixed
  label: string
  description: string | null
  maxUses: number | null    // null = unlimited
  useCount: number
  active: boolean
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PricingRule {
  id: string
  tenantId: string
  productId: string     // slug, unique per tenant
  name: string
  description: string | null
  priceSats: string     // bigint serialized
  active: boolean
  maxQuantity: number
  offerEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface WebhookDelivery {
  id: string            // wd_<uuid>
  tenantId: string
  paymentIntentId: string
  event: string         // e.g. 'payment_intent.succeeded'
  payload: string       // JSON
  signature: string     // HMAC-SHA256 hex
  status: 'pending' | 'delivered' | 'failed'
  attemptCount: number
  lastAttemptAt: string | null
  nextAttemptAt: string | null
  deliveredAt: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Legacy Session type — kept only for backward compatibility with existing tests
// ---------------------------------------------------------------------------

/** @deprecated Use PaymentIntent instead */
export interface Session {
  id: string
  orderId: string
  productId: string
  quantity: number
  amountSats: string
  paymentRequest: string
  paymentHash: string
  expiresAt: string
  status: PaymentIntentStatus
  /** @deprecated Legacy alias for status */
  state: PaymentIntentStatus
  tokenHash: string
}

// ---------------------------------------------------------------------------
// Migration system
// ---------------------------------------------------------------------------

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        webhook_url TEXT,
        webhook_secret TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS merchant_api_keys (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pricing_rules (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        product_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price_sats TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        max_quantity INTEGER NOT NULL DEFAULT 10,
        offer_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS payment_links (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        pricing_rule_id TEXT REFERENCES pricing_rules(id),
        amount_sats TEXT,
        label TEXT NOT NULL,
        description TEXT,
        max_uses INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_intents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        pricing_rule_id TEXT REFERENCES pricing_rules(id),
        payment_link_id TEXT REFERENCES payment_links(id),
        amount_sats TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'sat',
        description TEXT NOT NULL DEFAULT '',
        metadata TEXT,
        status TEXT NOT NULL DEFAULT 'requires_payment',
        payment_request TEXT NOT NULL,
        payment_hash TEXT UNIQUE NOT NULL,
        provider_invoice_id TEXT NOT NULL,
        client_secret_hash TEXT NOT NULL,
        idempotency_key TEXT,
        idempotency_payload_hash TEXT,
        expires_at TEXT NOT NULL,
        settled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant ON payment_intents(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_payment_intents_hash ON payment_intents(payment_hash);
      CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_idem ON payment_intents(tenant_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id),
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        signature TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        next_attempt_at TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next ON webhook_deliveries(next_attempt_at)
        WHERE status = 'pending';

      -- Legacy tables preserved for backward compatibility during migration
      CREATE TABLE IF NOT EXISTS bolt12_offers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        offer TEXT NOT NULL,
        amount_sats TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- System/legacy tenant for backward-compatible checkout-sessions API
      INSERT OR IGNORE INTO tenants (id, name, webhook_url, webhook_secret, created_at, updated_at)
      VALUES ('legacy', 'Legacy Checkout', NULL, NULL, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
    `,
  },
]

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class Repository {
  private db: DatabaseSync

  constructor(url: string) {
    const file = url.replace(/^file:/, '')
    if (file.startsWith(':memory:')) {
      const cache = (globalThis as typeof globalThis & { __sqlite_dbs?: Map<string, DatabaseSync> }).__sqlite_dbs ??= new Map<string, DatabaseSync>()
      if (!cache.has(file)) {
        cache.set(file, new DatabaseSync(':memory:'))
      }
      this.db = cache.get(file)!
    } else {
      mkdirSync(dirname(file), { recursive: true })
      this.db = new DatabaseSync(file)
    }
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
    this.applyMigrations()
  }

  // ---- Migration -----------------------------------------------------------

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `)
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
        .map((r) => r.version),
    )
    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
          this.db.exec(migration.sql)
          this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(
            migration.version,
            new Date().toISOString(),
          )
          this.db.exec('COMMIT')
        } catch (e) {
          this.db.exec('ROLLBACK')
          throw e
        }
      }
    }
  }

  // ---- Tenants -------------------------------------------------------------

  createTenant(tenant: Tenant): void {
    this.db
      .prepare(
        'INSERT INTO tenants VALUES (?,?,?,?,?,?)',
      )
      .run(
        tenant.id,
        tenant.name,
        tenant.webhookUrl,
        tenant.webhookSecret,
        tenant.createdAt,
        tenant.updatedAt,
      )
  }

  tenant(id: string): Tenant | undefined {
    return this.db
      .prepare(
        'SELECT id, name, webhook_url webhookUrl, webhook_secret webhookSecret, created_at createdAt, updated_at updatedAt FROM tenants WHERE id=?',
      )
      .get(id) as Tenant | undefined
  }

  // ---- API Keys ------------------------------------------------------------

  createApiKey(key: MerchantApiKey): void {
    this.db
      .prepare(
        'INSERT INTO merchant_api_keys VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        key.id,
        key.tenantId,
        key.keyHash,
        key.keyPrefix,
        key.label,
        key.createdAt,
        key.revokedAt,
      )
  }

  apiKeyByHash(keyHash: string): MerchantApiKey | undefined {
    return this.db
      .prepare(
        `SELECT id, tenant_id tenantId, key_hash keyHash, key_prefix keyPrefix,
          label, created_at createdAt, revoked_at revokedAt
         FROM merchant_api_keys WHERE key_hash=? AND revoked_at IS NULL`,
      )
      .get(keyHash) as MerchantApiKey | undefined
  }

  revokeApiKey(id: string): void {
    this.db
      .prepare('UPDATE merchant_api_keys SET revoked_at=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }

  // ---- Pricing Rules -------------------------------------------------------

  createPricingRule(rule: PricingRule): void {
    this.db
      .prepare(
        `INSERT INTO pricing_rules VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        rule.id,
        rule.tenantId,
        rule.productId,
        rule.name,
        rule.description,
        rule.priceSats,
        rule.active ? 1 : 0,
        rule.maxQuantity,
        rule.offerEnabled ? 1 : 0,
        rule.createdAt,
        rule.updatedAt,
      )
  }

  pricingRule(tenantId: string, productId: string): PricingRule | undefined {
    const row = this.db
      .prepare(
        `SELECT id, tenant_id tenantId, product_id productId, name, description,
          price_sats priceSats, active, max_quantity maxQuantity,
          offer_enabled offerEnabled, created_at createdAt, updated_at updatedAt
         FROM pricing_rules WHERE tenant_id=? AND product_id=? AND active=1`,
      )
      .get(tenantId, productId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      ...row,
      active: row.active === 1,
      offerEnabled: row.offerEnabled === 1,
    } as PricingRule
  }

  // ---- Payment Links -------------------------------------------------------

  createPaymentLink(link: PaymentLink): void {
    this.db
      .prepare(
        `INSERT INTO payment_links VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        link.id,
        link.slug,
        link.tenantId,
        link.pricingRuleId,
        link.amountSats,
        link.label,
        link.description,
        link.maxUses,
        link.useCount,
        link.active ? 1 : 0,
        link.expiresAt,
        link.createdAt,
        link.updatedAt,
      )
  }

  paymentLinkBySlug(slug: string): PaymentLink | undefined {
    const row = this.db
      .prepare(
        `SELECT id, slug, tenant_id tenantId, pricing_rule_id pricingRuleId,
          amount_sats amountSats, label, description, max_uses maxUses,
          use_count useCount, active, expires_at expiresAt,
          created_at createdAt, updated_at updatedAt
         FROM payment_links WHERE slug=? AND active=1`,
      )
      .get(slug) as Record<string, unknown> | undefined
    if (!row) return undefined
    return { ...row, active: row.active === 1 } as PaymentLink
  }

  incrementPaymentLinkUseCount(id: string): void {
    this.db.prepare('UPDATE payment_links SET use_count=use_count+1, updated_at=? WHERE id=?').run(
      new Date().toISOString(),
      id,
    )
  }

  // ---- Payment Intents -----------------------------------------------------

  createPaymentIntent(intent: PaymentIntent): void {
    this.db
      .prepare(
        `INSERT INTO payment_intents VALUES
          (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        intent.id,
        intent.tenantId,
        intent.pricingRuleId,
        intent.paymentLinkId,
        intent.amountSats,
        intent.currency,
        intent.description,
        intent.metadata,
        intent.status,
        intent.paymentRequest,
        intent.paymentHash,
        intent.providerInvoiceId,
        intent.clientSecretHash,
        intent.idempotencyKey,
        intent.idempotencyPayloadHash,
        intent.expiresAt,
        intent.settledAt,
        intent.createdAt,
        intent.updatedAt,
      )
  }

  paymentIntent(id: string, tenantId: string): PaymentIntent | undefined {
    return this.db
      .prepare(
        `SELECT id, tenant_id tenantId, pricing_rule_id pricingRuleId,
          payment_link_id paymentLinkId, amount_sats amountSats, currency,
          description, metadata, status, payment_request paymentRequest,
          payment_hash paymentHash, provider_invoice_id providerInvoiceId,
          client_secret_hash clientSecretHash, idempotency_key idempotencyKey,
          idempotency_payload_hash idempotencyPayloadHash,
          expires_at expiresAt, settled_at settledAt,
          created_at createdAt, updated_at updatedAt
         FROM payment_intents WHERE id=? AND tenant_id=?`,
      )
      .get(id, tenantId) as PaymentIntent | undefined
  }

  paymentIntentByHash(paymentHash: string): PaymentIntent | undefined {
    return this.db
      .prepare(
        `SELECT id, tenant_id tenantId, pricing_rule_id pricingRuleId,
          payment_link_id paymentLinkId, amount_sats amountSats, currency,
          description, metadata, status, payment_request paymentRequest,
          payment_hash paymentHash, provider_invoice_id providerInvoiceId,
          client_secret_hash clientSecretHash, idempotency_key idempotencyKey,
          idempotency_payload_hash idempotencyPayloadHash,
          expires_at expiresAt, settled_at settledAt,
          created_at createdAt, updated_at updatedAt
         FROM payment_intents WHERE payment_hash=?`,
      )
      .get(paymentHash) as PaymentIntent | undefined
  }

  /** Find an existing non-expired intent by idempotency key within a tenant */
  paymentIntentByIdempotencyKey(
    tenantId: string,
    key: string,
  ): PaymentIntent | undefined {
    return this.db
      .prepare(
        `SELECT id, tenant_id tenantId, pricing_rule_id pricingRuleId,
          payment_link_id paymentLinkId, amount_sats amountSats, currency,
          description, metadata, status, payment_request paymentRequest,
          payment_hash paymentHash, provider_invoice_id providerInvoiceId,
          client_secret_hash clientSecretHash, idempotency_key idempotencyKey,
          idempotency_payload_hash idempotencyPayloadHash,
          expires_at expiresAt, settled_at settledAt,
          created_at createdAt, updated_at updatedAt
         FROM payment_intents
         WHERE tenant_id=? AND idempotency_key=?
           AND expires_at > ?`,
      )
      .get(tenantId, key, new Date().toISOString()) as PaymentIntent | undefined
  }

  /** All intents in terminal-pending states that need re-subscription after restart */
  pendingPaymentIntents(): PaymentIntent[] {
    return this.db
      .prepare(
        `SELECT id, tenant_id tenantId, pricing_rule_id pricingRuleId,
          payment_link_id paymentLinkId, amount_sats amountSats, currency,
          description, metadata, status, payment_request paymentRequest,
          payment_hash paymentHash, provider_invoice_id providerInvoiceId,
          client_secret_hash clientSecretHash, idempotency_key idempotencyKey,
          idempotency_payload_hash idempotencyPayloadHash,
          expires_at expiresAt, settled_at settledAt,
          created_at createdAt, updated_at updatedAt
         FROM payment_intents
         WHERE status IN ('requires_payment','processing')
           AND expires_at > ?`,
      )
      .all(new Date().toISOString()) as unknown as PaymentIntent[]
  }

  updatePaymentIntentStatus(
    paymentHash: string,
    invoice: LightningInvoice,
    newStatus: PaymentIntentStatus,
  ): void {
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(
          `UPDATE payment_intents
           SET status=?, settled_at=?, updated_at=?
           WHERE payment_hash=? AND status NOT IN ('succeeded','canceled','failed')`,
        )
        .run(
          newStatus,
          newStatus === 'succeeded' ? (invoice.settledAt ?? now) : null,
          now,
          paymentHash,
        )
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  // ---- Webhooks ------------------------------------------------------------

  createWebhookDelivery(delivery: WebhookDelivery): void {
    this.db
      .prepare(
        `INSERT INTO webhook_deliveries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        delivery.id,
        delivery.tenantId,
        delivery.paymentIntentId,
        delivery.event,
        delivery.payload,
        delivery.signature,
        delivery.status,
        delivery.attemptCount,
        delivery.lastAttemptAt,
        delivery.nextAttemptAt,
        delivery.deliveredAt,
        delivery.createdAt,
      )
  }

  pendingWebhookDeliveries(): WebhookDelivery[] {
    return this.db
      .prepare(
        `SELECT id, tenant_id tenantId, payment_intent_id paymentIntentId,
          event, payload, signature, status, attempt_count attemptCount,
          last_attempt_at lastAttemptAt, next_attempt_at nextAttemptAt,
          delivered_at deliveredAt, created_at createdAt
         FROM webhook_deliveries
         WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT 50`,
      )
      .all(new Date().toISOString()) as unknown as WebhookDelivery[]
  }

  markWebhookDelivered(id: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE webhook_deliveries SET status='delivered', delivered_at=?, last_attempt_at=?, attempt_count=attempt_count+1 WHERE id=?`,
      )
      .run(now, now, id)
  }

  markWebhookFailed(id: string, nextAttemptAt: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE webhook_deliveries SET attempt_count=attempt_count+1, last_attempt_at=?, next_attempt_at=? WHERE id=?`,
      )
      .run(now, nextAttemptAt, id)
  }

  markWebhookPermanentlyFailed(id: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE webhook_deliveries SET status='failed', last_attempt_at=?, attempt_count=attempt_count+1 WHERE id=?`,
      )
      .run(now, id)
  }

  // ---- BOLT12 Offers -------------------------------------------------------

  saveOffer(tenantId: string, productId: string, o: CreatedOffer): void {
    this.db
      .prepare('INSERT INTO bolt12_offers VALUES (?,?,?,?,?,?)')
      .run(o.offerId, tenantId, productId, o.offer, o.amountSats.toString(), new Date().toISOString())
  }

  // ---- Legacy compatibility (for existing tests) ---------------------------

  /**
   * @deprecated Use createPaymentIntent instead.
   * Returns a legacy Session view of a newly created PaymentIntent.
   */
  createCheckout(
    s: Session,
    _i: LightningInvoice,
    x: { key: string; payloadHash: string; token: string; expiresAt: string },
  ): void {
    // Map the legacy session to a PaymentIntent row
    const now = new Date().toISOString()
    const intent: PaymentIntent = {
      id: s.id,
      tenantId: 'legacy',
      pricingRuleId: null,
      paymentLinkId: null,
      amountSats: s.amountSats,
      currency: 'sat',
      description: `Order ${s.orderId}`,
      metadata: JSON.stringify({ orderId: s.orderId, productId: s.productId, quantity: s.quantity, _legacyToken: x.token }),
      status: 'requires_payment',
      paymentRequest: s.paymentRequest,
      paymentHash: s.paymentHash,
      providerInvoiceId: _i.providerInvoiceId,
      clientSecretHash: s.tokenHash,
      idempotencyKey: x.key,
      idempotencyPayloadHash: x.payloadHash,
      expiresAt: s.expiresAt,
      settledAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.createPaymentIntent(intent)
  }

  /** @deprecated Use paymentIntent() instead. */
  session(id: string): Session | undefined {
    const row = this.db
      .prepare(
        `SELECT id, tenant_id tenantId, pricing_rule_id pricingRuleId,
          metadata, amount_sats amountSats, payment_request paymentRequest,
          payment_hash paymentHash, expires_at expiresAt, status,
          client_secret_hash clientSecretHash
         FROM payment_intents WHERE id=?`,
      )
      .get(id) as (PaymentIntent & { clientSecretHash: string }) | undefined
    if (!row) return undefined
    const meta = row.metadata ? (JSON.parse(row.metadata) as { orderId?: string; productId?: string; quantity?: number }) : {}
    return {
      id: row.id,
      orderId: meta.orderId ?? row.id,
      productId: meta.productId ?? row.pricingRuleId ?? '',
      quantity: meta.quantity ?? 1,
      amountSats: row.amountSats,
      paymentRequest: row.paymentRequest,
      paymentHash: row.paymentHash,
      expiresAt: row.expiresAt,
      status: row.status as PaymentIntentStatus,
      state: row.status as PaymentIntentStatus,
      tokenHash: row.clientSecretHash,
    }
  }

  /** @deprecated Use paymentIntentByIdempotencyKey() instead. */
  idempotency(key: string): { payloadHash: string; sessionId: string; token: string; expiresAt: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT id, idempotency_payload_hash payloadHash, client_secret_hash token, expires_at expiresAt, metadata meta
         FROM payment_intents WHERE idempotency_key=? AND expires_at > ?`,
      )
      .get(key, new Date().toISOString()) as
      | { id: string; payloadHash: string; token: string; expiresAt: string; meta: string | null }
      | undefined
    if (!row) return undefined
    // Extract the legacy plaintext token from metadata for status token re-use
    let token = row.token
    try {
      const metaParsed = row.meta ? (JSON.parse(row.meta) as { _legacyToken?: string }) : null
      if (metaParsed?._legacyToken) token = metaParsed._legacyToken
    } catch { /* ignore JSON parse errors */ }
    return { payloadHash: row.payloadHash, sessionId: row.id, token, expiresAt: row.expiresAt }
  }

  /** @deprecated Use updatePaymentIntentStatus() instead. */
  settle(hash: string, invoice: LightningInvoice): void {
    const newStatus = invoiceStateToIntentStatus(invoice.state)
    this.updatePaymentIntentStatus(hash, invoice, newStatus)
  }
}
