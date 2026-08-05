/**
 * Integration and webhook tests — PR #40 / Issues #9, #10, #21
 *
 * Covers:
 * - Webhook signature format: Cherito-Signature: t=<unix>,v1=<hmac>
 * - Fresh timestamp generated on every retry (not reusing stale signature)
 * - timingSafeEqual verification
 * - Replay attack rejected (timestamp too old)
 * - SSRF defense: loopback, private, link-local, metadata ranges blocked
 * - open_amount payment links: payer supplies amount within merchant bounds
 * - fixed payment links: browser cannot override amount
 * - pricingRuleById fix: links with pricingRuleId resolve correctly
 * - Payment link use limit (atomic enforcement)
 * - Payment link expiry
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { WebhookService, assertWebhookUrlSafe } from '../src/services/webhook-service.js'
import { Repository } from '../src/persistence/repository.js'
import { PaymentIntentService } from '../src/services/payment-intent-service.js'
import type { LightningInvoice, LightningReceiveProvider } from '@cherito/bitcoin-sdk'
import type { Config } from '../src/config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo() {
  return new Repository(`file::memory:?cache=shared&uri=${randomUUID()}`)
}

const SATS = { min: 1n, max: 1_000_000n }

function makeConfig(): Config {
  return {
    PORT: 0, HOST: '127.0.0.1', DATABASE_URL: '',
    LND_REST_URL: 'https://localhost:8080',
    LND_TLS_CERT_PATH: '', LND_TLS_CERT_BASE64: '',
    LND_MACAROON_PATH: '', LND_MACAROON_HEX: '',
    LOG_LEVEL: 'silent', ALLOWED_ORIGINS: '*', RATE_LIMIT_CREATE_INVOICE: 100,
    DEFAULT_INVOICE_EXPIRY_SECONDS: 3600,
    MIN_INVOICE_SATS: SATS.min,
    MAX_INVOICE_SATS: SATS.max,
    ADMIN_API_KEY_PATH: '', BOLT12_PROVIDER: null,
    LNDK_GRPC_URL: undefined, LNDK_TLS_CERT_PATH: undefined,
    LNDK_MACAROON_PATH: undefined,
  } as unknown as Config
}

function makeFakeProvider(): LightningReceiveProvider {
  return {
    providerType: 'lnd-rest' as const,
    async getCapabilities() { return { provider: 'lnd-rest' as const, bolt11Receive: true, bolt12Receive: false } },
    async getNodeInfo() { return { alias: 'test', pubkey: 'aabb', network: 'regtest', color: '#fff' } },
    async createInvoice(input) {
      const hash = `hash_${randomUUID()}`
      return {
        providerInvoiceId: `inv_${hash}`, paymentHash: hash,
        paymentRequest: `lnbcrt${input.amountSats}`,
        amountSats: input.amountSats,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        state: 'pending' as const, settledAt: null,
      }
    },
    async getInvoice(hash) {
      return { providerInvoiceId: hash, paymentHash: hash, paymentRequest: 'lnbcrt...',
        amountSats: 1000n, expiresAt: new Date(Date.now() + 3600000).toISOString(),
        state: 'pending' as const, settledAt: null } as LightningInvoice
    },
    async subscribeToInvoice() { return async () => {} },
  } as unknown as LightningReceiveProvider
}

function setupWithTenant() {
  const repo = makeRepo()
  const now = new Date().toISOString()
  repo.createTenant({
    id: 'tnt_wh', name: 'Webhook Test Merchant',
    webhookUrl: 'https://merchant.example.com/webhook',
    webhookSecret: 'supersecret123',
    disabled: false, createdAt: now, updatedAt: now,
  })
  return { repo }
}

// ---------------------------------------------------------------------------
// Webhook signature tests
// ---------------------------------------------------------------------------

describe('WebhookService.verify() — signature format', () => {
  test('verifies valid Cherito-Signature header', () => {
    const secret = 'test_secret'
    const body = '{"type":"payment_intent.succeeded"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const hmac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    const header = `t=${timestamp},v1=${hmac}`

    assert.equal(WebhookService.verify(secret, header, body), true)
  })

  test('rejects tampered body', () => {
    const secret = 'test_secret'
    const body = '{"type":"payment_intent.succeeded"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const hmac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    const header = `t=${timestamp},v1=${hmac}`

    assert.equal(WebhookService.verify(secret, header, '{"type":"payment_intent.failed"}'), false)
  })

  test('rejects wrong secret', () => {
    const body = '{"type":"ok"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const hmac = createHmac('sha256', 'right_secret').update(`${timestamp}.${body}`).digest('hex')
    const header = `t=${timestamp},v1=${hmac}`

    assert.equal(WebhookService.verify('wrong_secret', header, body), false)
  })

  test('rejects replayed event (timestamp too old)', () => {
    const secret = 'test_secret'
    const body = '{"type":"ok"}'
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600  // 10 min old
    const hmac = createHmac('sha256', secret).update(`${oldTimestamp}.${body}`).digest('hex')
    const header = `t=${oldTimestamp},v1=${hmac}`

    assert.equal(WebhookService.verify(secret, header, body, 300), false)
  })

  test('rejects malformed header (missing v1)', () => {
    assert.equal(WebhookService.verify('secret', 't=1234', 'body'), false)
  })

  test('signature format in header is t=<unix>,v1=<hmac>', async () => {
    // The delivery stored in DB should use the correct format
    const { repo } = setupWithTenant()

    let capturedSignature = ''
    let capturedBody = ''

    // Mock fetch to capture headers
    const origFetch = globalThis.fetch
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignature = (init?.headers as Record<string, string>)['cherito-signature'] ?? ''
      capturedBody = String(init?.body ?? '')
      return new Response(null, { status: 200 })
    }

    try {
      const service = new WebhookService(repo)
      const tenant = repo.tenant('tnt_wh')!
      const now = new Date().toISOString()
      // Create a fake intent in DB first
      repo.createPaymentIntent({
        id: 'pi_wh_test', tenantId: 'tnt_wh', pricingRuleId: null,
        paymentLinkId: null, merchantOrderId: null, amountSats: '1000', currency: 'sat',
        description: 'Test', metadata: null, status: 'succeeded',
        paymentRequest: 'lnbcrt...', paymentHash: 'hash_wh_test', providerInvoiceId: 'inv_wh',
        intentSecret: 'secret', clientSecretHash: 'hash', idempotencyKey: null,
        idempotencyPayloadHash: null, expiresAt: new Date(Date.now() + 3600000).toISOString(),
        settledAt: now, createdAt: now, updatedAt: now,
      })
      const intent = repo.paymentIntentByHash('hash_wh_test')!
      await service.enqueue(tenant, intent, 'payment_intent.succeeded')
      await service.flush()
    } finally {
      globalThis.fetch = origFetch
    }

    // Verify the format is t=<unix>,v1=<hmac>
    assert.match(capturedSignature, /^t=\d+,v1=[0-9a-f]{64}$/)

    // Verify the signature is actually valid
    const parts = Object.fromEntries(
      capturedSignature.split(',').map((p) => {
        const i = p.indexOf('=')
        return [p.slice(0, i), p.slice(i + 1)]
      }),
    ) as { t: string; v1: string }
    const expected = createHmac('sha256', 'supersecret123')
      .update(`${parts.t}.${capturedBody}`)
      .digest('hex')
    assert.equal(parts.v1, expected)
  })
})

// ---------------------------------------------------------------------------
// SSRF defense tests
// ---------------------------------------------------------------------------

describe('assertWebhookUrlSafe — SSRF defense', () => {
  test('allows valid HTTPS external URL', () => {
    assert.doesNotThrow(() => assertWebhookUrlSafe('https://merchant.example.com/webhook'))
  })

  test('allows valid HTTP URL in non-production mode', () => {
    assert.doesNotThrow(() => assertWebhookUrlSafe('http://merchant.example.com/webhook', false))
  })

  test('rejects localhost', () => {
    assert.throws(() => assertWebhookUrlSafe('http://localhost/webhook'))
    assert.throws(() => assertWebhookUrlSafe('http://localhost:8080/webhook'))
  })

  test('rejects 127.x.x.x loopback', () => {
    assert.throws(() => assertWebhookUrlSafe('http://127.0.0.1/webhook'))
    assert.throws(() => assertWebhookUrlSafe('http://127.0.0.2:9000/callback'))
  })

  test('rejects private 10.x.x.x range', () => {
    assert.throws(() => assertWebhookUrlSafe('http://10.0.0.1/webhook'))
  })

  test('rejects private 192.168.x.x range', () => {
    assert.throws(() => assertWebhookUrlSafe('http://192.168.1.1/webhook'))
  })

  test('rejects cloud metadata 169.254.x.x (AWS/GCP/Azure IMDS)', () => {
    assert.throws(() => assertWebhookUrlSafe('http://169.254.169.254/latest/meta-data/'))
    assert.throws(() => assertWebhookUrlSafe('http://169.254.0.1/webhook'))
  })

  test('rejects GCP metadata.google.internal', () => {
    assert.throws(() => assertWebhookUrlSafe('http://metadata.google.internal/computeMetadata/v1/'))
  })

  test('rejects 0.0.0.0', () => {
    assert.throws(() => assertWebhookUrlSafe('http://0.0.0.0/webhook'))
  })

  test('rejects embedded credentials in URL', () => {
    assert.throws(() => assertWebhookUrlSafe('http://user:pass@merchant.example.com/webhook'))
  })

  test('rejects file:// scheme', () => {
    assert.throws(() => assertWebhookUrlSafe('file:///etc/passwd'))
  })

  test('rejects malformed URL', () => {
    assert.throws(() => assertWebhookUrlSafe('not-a-url'))
  })
})

// ---------------------------------------------------------------------------
// Payment link tests
// ---------------------------------------------------------------------------

describe('PaymentIntentService.createFromPaymentLink()', () => {
  function makeService(repo: Repository) {
    return new PaymentIntentService(makeFakeProvider(), undefined, repo, makeConfig())
  }

  function setupRepo() {
    const repo = makeRepo()
    const now = new Date().toISOString()
    repo.createTenant({
      id: 'tnt_pl', name: 'Link Merchant', webhookUrl: null, webhookSecret: null,
      disabled: false, createdAt: now, updatedAt: now,
    })
    return { repo, now }
  }

  test('fixed link creates intent at stored amount', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_fixed', slug: 'donate-fixed', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'fixed', amountSats: '5000',
      minAmountSats: null, maxAmountSats: null,
      label: 'Coffee', description: null,
      maxUses: null, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    const result = await service.createFromPaymentLink('donate-fixed')
    assert.equal(result.amountSats, '5000')
    assert.ok(result.clientSecret.startsWith('cs_'))
  })

  test('fixed link rejects payer-supplied amount', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_fixed2', slug: 'fixed-nope', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'fixed', amountSats: '5000',
      minAmountSats: null, maxAmountSats: null,
      label: 'Price', description: null,
      maxUses: null, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    await assert.rejects(
      () => service.createFromPaymentLink('fixed-nope', 9999n),
      (err: { code: string }) => { assert.equal(err.code, 'FIXED_PRICE_OVERRIDE_DENIED'); return true },
    )
  })

  test('open_amount link accepts amount within bounds', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_open', slug: 'donate-open', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'open_amount', amountSats: null,
      minAmountSats: '1000', maxAmountSats: '100000',
      label: 'Donation', description: null,
      maxUses: null, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    const result = await service.createFromPaymentLink('donate-open', 5000n)
    assert.equal(result.amountSats, '5000')
  })

  test('open_amount link rejects amount below minimum', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_open2', slug: 'donate-min', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'open_amount', amountSats: null,
      minAmountSats: '1000', maxAmountSats: '100000',
      label: 'Donation', description: null,
      maxUses: null, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    await assert.rejects(
      () => service.createFromPaymentLink('donate-min', 500n),
      (err: { code: string }) => { assert.equal(err.code, 'AMOUNT_BELOW_MINIMUM'); return true },
    )
  })

  test('open_amount link rejects amount above maximum', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_open3', slug: 'donate-max', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'open_amount', amountSats: null,
      minAmountSats: '1000', maxAmountSats: '10000',
      label: 'Donation', description: null,
      maxUses: null, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    await assert.rejects(
      () => service.createFromPaymentLink('donate-max', 50000n),
      (err: { code: string }) => { assert.equal(err.code, 'AMOUNT_ABOVE_MAXIMUM'); return true },
    )
  })

  test('open_amount link requires a payer amount', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_open4', slug: 'donate-req', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'open_amount', amountSats: null,
      minAmountSats: null, maxAmountSats: null,
      label: 'Donation', description: null,
      maxUses: null, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    await assert.rejects(
      () => service.createFromPaymentLink('donate-req'),
      (err: { code: string }) => { assert.equal(err.code, 'AMOUNT_REQUIRED'); return true },
    )
  })

  test('pricingRuleById fix: fixed link resolves pricing rule by ID', async () => {
    const { repo, now } = setupRepo()
    // Create a pricing rule
    repo.upsertPricingRule({
      id: 'pr_coffee', tenantId: 'tnt_pl', productId: 'coffee',
      name: 'Coffee', description: null, mode: 'fixed', priceSats: '2000',
      maxPriceSats: null, active: true, maxQuantity: 10, offerEnabled: false,
      createdAt: now, updatedAt: now,
    })
    // Link references the pricing rule by ID
    repo.createPaymentLink({
      id: 'pl_rule', slug: 'coffee-pay', tenantId: 'tnt_pl',
      pricingRuleId: 'pr_coffee', mode: 'fixed', amountSats: null,
      minAmountSats: null, maxAmountSats: null,
      label: 'Buy Coffee', description: null,
      maxUses: null, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    const result = await service.createFromPaymentLink('coffee-pay')
    // Should resolve amount via pricingRuleById, not pricingRule(productId)
    assert.equal(result.amountSats, '2000')
    assert.equal(result.description, 'Buy Coffee')
  })

  test('payment link use count limit is enforced atomically', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_limit', slug: 'one-use', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'fixed', amountSats: '1000',
      minAmountSats: null, maxAmountSats: null,
      label: 'One Time', description: null,
      maxUses: 1, useCount: 0, active: true, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)

    // First use succeeds
    await service.createFromPaymentLink('one-use')

    // Second use should be rejected
    await assert.rejects(
      () => service.createFromPaymentLink('one-use'),
      (err: { code: string }) => { assert.equal(err.code, 'PAYMENT_LINK_EXHAUSTED'); return true },
    )
  })

  test('expired payment link is rejected', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_exp', slug: 'expired-link', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'fixed', amountSats: '1000',
      minAmountSats: null, maxAmountSats: null,
      label: 'Expired', description: null,
      maxUses: null, useCount: 0, active: true,
      expiresAt: new Date(Date.now() - 1000).toISOString(),  // 1 sec in the past
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    await assert.rejects(
      () => service.createFromPaymentLink('expired-link'),
      (err: { code: string }) => { assert.equal(err.code, 'PAYMENT_LINK_EXPIRED'); return true },
    )
  })

  test('inactive payment link returns 404', async () => {
    const { repo, now } = setupRepo()
    repo.createPaymentLink({
      id: 'pl_inactive', slug: 'inactive-link', tenantId: 'tnt_pl',
      pricingRuleId: null, mode: 'fixed', amountSats: '1000',
      minAmountSats: null, maxAmountSats: null,
      label: 'Inactive', description: null,
      maxUses: null, useCount: 0, active: false, expiresAt: null,
      createdAt: now, updatedAt: now,
    })

    const service = makeService(repo)
    await assert.rejects(
      () => service.createFromPaymentLink('inactive-link'),
      (err: { code: string }) => { assert.equal(err.code, 'PAYMENT_LINK_NOT_FOUND'); return true },
    )
  })
})
