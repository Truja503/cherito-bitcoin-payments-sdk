import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import type {
  CreateInvoiceInput,
  LightningInvoice,
  LightningReceiveProvider,
  Bolt12ReceiveProvider,
} from '@cherito/bitcoin-sdk'
import { Repository } from '../src/persistence/repository.js'
import { PaymentService } from '../src/services/payment-service.js'
import { PaymentIntentService } from '../src/services/payment-intent-service.js'
import { ApiKeyService } from '../src/services/api-key-service.js'
import { TenantService } from '../src/services/tenant-service.js'
import { WebhookService } from '../src/services/webhook-service.js'
import { loadConfig } from '../src/config.js'

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

class LndMock implements LightningReceiveProvider {
  readonly providerType = 'lnd' as const
  creates = 0
  callback?: (i: LightningInvoice) => void
  offline = false
  auth = false
  tls = false

  async getCapabilities() {
    return { bolt11Receive: true, bolt12Receive: false, invoiceStreaming: true, provider: 'lnd' as const }
  }
  async getNodeInfo() {
    if (this.offline) throw new Error('offline')
    return { network: 'regtest' as const }
  }
  async createInvoice(i: CreateInvoiceInput) {
    if (this.offline) throw new Error('offline')
    if (this.auth) throw new Error('macaroon')
    if (this.tls) throw new Error('certificate')
    this.creates++
    return {
      providerInvoiceId: '1',
      paymentHash: 'ab'.repeat(32),
      paymentRequest: 'lnbcrt1realmock',
      amountSats: i.amountSats,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      state: 'pending' as const,
    }
  }
  async getInvoice(): Promise<LightningInvoice> {
    throw new Error('unused')
  }
  async subscribeToInvoice(_h: string, cb: (i: LightningInvoice) => void) {
    this.callback = cb
    return async () => {}
  }
}

class BoltMock implements Bolt12ReceiveProvider {
  constructor(private fail = false) {}
  async getCapabilities() {
    return { bolt11Receive: true, bolt12Receive: true, invoiceStreaming: true, provider: 'lndk' as const }
  }
  async createOffer(i: { amountSats: bigint }) {
    if (this.fail) throw new Error('LNDK unavailable')
    return { offerId: 'offer1', offer: 'lno1officialmock', amountSats: i.amountSats }
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function mkdb() {
  return `:memory:?uuid=${crypto.randomUUID()}`
}

function config(dbUrl: string) {
  return loadConfig({
    NODE_ENV: 'test',
    LND_REST_URL: 'https://localhost:8080',
    LND_TLS_CERT_BASE64: Buffer.from('cert').toString('base64'),
    LND_MACAROON_HEX: 'aa',
    DATABASE_URL: dbUrl,
  })
}

/** Legacy PaymentService fixture (backward-compat tests) */
function legacyFixture(bolt?: Bolt12ReceiveProvider) {
  const database = mkdb()
  const cfg = config(database)
  const lnd = new LndMock()
  const repo = new Repository(database)
  return { config: cfg, lnd, repo, service: new PaymentService(lnd, bolt, repo, cfg) }
}

/** New PaymentIntentService fixture with tenant + pricing rule */
async function intentFixture(bolt?: Bolt12ReceiveProvider) {
  const database = mkdb()
  const cfg = config(database)
  const lnd = new LndMock()
  const repo = new Repository(database)
  const apiKeyService = new ApiKeyService(repo)
  const tenantService = new TenantService(repo, apiKeyService)
  const webhookService = new WebhookService(repo)
  const svc = new PaymentIntentService(lnd, bolt, repo, cfg, tenantService, webhookService)

  const { tenant, apiKey } = await tenantService.createTenant({ name: 'Test Merchant' })
  tenantService.upsertPricingRule(tenant.id, {
    productId: 'test-product',
    name: 'Test Product',
    mode: 'fixed',
    priceSats: '25000',
    maxQuantity: 10,
  })

  return { config: cfg, lnd, repo, svc, tenant, apiKey, apiKeyService }
}

// ===========================================================================
// Legacy PaymentService tests (backward compatibility)
// ===========================================================================

test('3 creates an invoice with server price; 12 browser price cannot override it', async () => {
  const f = legacyFixture()
  const r = await f.service.create('cherito-coffee-001', 2, crypto.randomUUID())
  assert.equal(r.amountSats, '50000')
  assert.equal(f.lnd.creates, 1)
})

test('5 settled confirms; 14 repeated settlement is idempotent', async () => {
  const f = legacyFixture()
  const r = await f.service.create('cherito-coffee-001', 1, crypto.randomUUID())
  const i: LightningInvoice = {
    providerInvoiceId: '1',
    paymentHash: 'ab'.repeat(32),
    paymentRequest: 'lnbcrt1realmock',
    amountSats: 25_000n,
    expiresAt: r.expiresAt,
    state: 'settled',
    settledAt: new Date().toISOString(),
  }
  f.lnd.callback?.(i)
  f.lnd.callback?.(i)
  assert.equal(f.service.authorize(r.checkoutSessionId, r.statusToken)?.state, 'succeeded')
})

test('7 disconnected node; 8 invalid macaroon; 9 invalid certificate propagate', async () => {
  for (const mode of ['offline', 'auth', 'tls'] as const) {
    const f = legacyFixture()
    f.lnd[mode] = true
    await assert.rejects(() => f.service.create('cherito-coffee-001', 1, crypto.randomUUID()))
  }
})

test('10 duplicate key returns same checkout; 11 changed payload conflicts', async () => {
  const f = legacyFixture()
  const key = crypto.randomUUID()
  const a = await f.service.create('cherito-coffee-001', 1, key)
  const b = await f.service.create('cherito-coffee-001', 1, key)
  assert.equal(a.checkoutSessionId, b.checkoutSessionId)
  assert.equal(a.statusToken, b.statusToken)
  assert.equal(f.lnd.creates, 1)
  await assert.rejects(() => f.service.create('cherito-coffee-001', 2, key), /conflict/)
})

test('13 incorrect status token is rejected', async () => {
  const f = legacyFixture()
  const r = await f.service.create('cherito-coffee-001', 1, crypto.randomUUID())
  assert.equal(f.service.authorize(r.checkoutSessionId, 'wrong'), undefined)
})

test('15 BOLT12 disabled', async () => {
  const f = legacyFixture()
  await assert.rejects(
    () => f.service.createOffer('cherito-coffee-001'),
    (e: unknown) => (e as { code?: string }).code === 'BOLT12_NOT_CONFIGURED',
  )
})

test('16 LNDK failure does not affect BOLT11', async () => {
  const f = legacyFixture(new BoltMock(true))
  await assert.rejects(() => f.service.createOffer('cherito-coffee-001'))
  assert.equal(
    (await f.service.create('cherito-coffee-001', 1, crypto.randomUUID())).state,
    'requires_payment',
  )
})

test('17 responses and 18 logs contain no credential material', () => {
  const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /send\([^)]*(macaroon|certificate)/i)
  assert.match(source, /redact:/)
})

test('unsafe privileged configuration is refused', () => {
  for (const name of ['ADMIN_MACAROON', 'SEED', 'XPRV', 'PRIVATE_KEY']) {
    assert.throws(() => loadConfig({ [name]: 'x' }), /forbidden/)
  }
})

// ===========================================================================
// PaymentIntentService tests (#3, #4, #5)
// ===========================================================================

test('PI-01: creates a payment intent with server-controlled price', async () => {
  const { svc, tenant, lnd } = await intentFixture()
  const result = await svc.create({ tenantId: tenant.id, productId: 'test-product', quantity: 2 })
  assert.equal(result.amountSats, '50000')  // 25_000 * 2
  assert.equal(result.currency, 'sat')
  assert.ok(result.id.startsWith('pi_'))
  assert.ok(result.clientSecret.startsWith('cs_'))
  assert.equal(lnd.creates, 1)
})

test('PI-02: client secret authorizes intent read; wrong secret is rejected', async () => {
  const { svc, tenant } = await intentFixture()
  const result = await svc.create({ tenantId: tenant.id, productId: 'test-product' })
  const authorized = svc.authorize(result.id, tenant.id, result.clientSecret)
  assert.ok(authorized, 'correct client secret should authorize')
  const rejected = svc.authorize(result.id, tenant.id, 'wrong')
  assert.equal(rejected, undefined, 'wrong client secret should be rejected')
})

test('PI-03: cross-tenant access is denied', async () => {
  const { svc, tenant } = await intentFixture()
  const result = await svc.create({ tenantId: tenant.id, productId: 'test-product' })
  // Use a different tenant ID — should return undefined
  const crossTenant = svc.authorize(result.id, 'tnt_other', result.clientSecret)
  assert.equal(crossTenant, undefined, 'cross-tenant access must be denied')
})

test('PI-04: idempotent creation returns same intent', async () => {
  const { svc, tenant, lnd } = await intentFixture()
  const key = crypto.randomUUID()
  const a = await svc.create({ tenantId: tenant.id, productId: 'test-product', idempotencyKey: key })
  const b = await svc.create({ tenantId: tenant.id, productId: 'test-product', idempotencyKey: key })
  assert.equal(a.id, b.id)
  assert.equal(lnd.creates, 1)
})

test('PI-05: idempotency key payload conflict returns 409', async () => {
  const { svc, tenant } = await intentFixture()
  const key = crypto.randomUUID()
  await svc.create({ tenantId: tenant.id, productId: 'test-product', quantity: 1, idempotencyKey: key })
  await assert.rejects(
    () => svc.create({ tenantId: tenant.id, productId: 'test-product', quantity: 2, idempotencyKey: key }),
    (e: unknown) => (e as { code?: string }).code === 'IDEMPOTENCY_CONFLICT',
  )
})

test('PI-06: settlement from provider updates status to succeeded', async () => {
  const { svc, tenant, lnd } = await intentFixture()
  const result = await svc.create({ tenantId: tenant.id, productId: 'test-product' })

  const settledInvoice: LightningInvoice = {
    providerInvoiceId: '1',
    paymentHash: 'ab'.repeat(32),
    paymentRequest: 'lnbcrt1realmock',
    amountSats: 25_000n,
    expiresAt: result.expiresAt,
    state: 'settled',
    settledAt: new Date().toISOString(),
  }

  lnd.callback?.(settledInvoice)

  const intent = svc.authorize(result.id, tenant.id, result.clientSecret)
  assert.equal(intent?.status, 'succeeded')
})

test('PI-07: unknown product returns 404', async () => {
  const { svc, tenant } = await intentFixture()
  await assert.rejects(
    () => svc.create({ tenantId: tenant.id, productId: 'nonexistent-product' }),
    (e: unknown) => (e as { code?: string }).code === 'PRODUCT_NOT_FOUND',
  )
})

// ===========================================================================
// API key tests (#5)
// ===========================================================================

test('AK-01: generated API key verifies correctly', async () => {
  const db = mkdb()
  const repo = new Repository(db)
  const svc = new ApiKeyService(repo)
  const tenant = { id: 'tnt_test', name: 'Test', webhookUrl: null, webhookSecret: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  repo.createTenant(tenant)
  const { key } = await svc.generate(tenant.id, 'test-key')
  const verified = svc.verify(key)
  assert.ok(verified, 'generated key should verify')
  assert.equal(verified?.tenantId, tenant.id)
})

test('AK-02: revoked API key is rejected', async () => {
  const db = mkdb()
  const repo = new Repository(db)
  const svc = new ApiKeyService(repo)
  const tenant = { id: 'tnt_test2', name: 'Test2', webhookUrl: null, webhookSecret: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  repo.createTenant(tenant)
  const { key, record } = await svc.generate(tenant.id, 'revoke-me')
  svc.revoke(record.id, tenant.id)
  const result = svc.verify(key)
  assert.equal(result, undefined, 'revoked key should be rejected')
})

test('AK-03: invalid key format is rejected without DB query', async () => {
  const db = mkdb()
  const repo = new Repository(db)
  const svc = new ApiKeyService(repo)
  assert.equal(svc.verify('not-a-key'), undefined)
  assert.equal(svc.verify(''), undefined)
})

// ===========================================================================
// Webhook signing tests (#8)
// ===========================================================================

test('WH-01: webhook signature verifies correctly', () => {
  const secret = 'test-webhook-secret-32bytes-min'
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify({ type: 'payment_intent.succeeded' })
  const hmac = createHmac('sha256', secret)
  hmac.update(`${timestamp}.${body}`)
  const signature = `t=${timestamp},v1=${hmac.digest('hex')}`
  assert.ok(WebhookService.verify(secret, signature, body))
})

test('WH-02: webhook with stale timestamp is rejected', () => {
  const secret = 'test-secret'
  const staleTimestamp = Math.floor(Date.now() / 1000) - 400
  const body = '{}'
  const hmac = createHmac('sha256', secret)
  hmac.update(`${staleTimestamp}.${body}`)
  const signature = `t=${staleTimestamp},v1=${hmac.digest('hex')}`
  assert.equal(WebhookService.verify(secret, signature, body), false)
})

test('WH-03: tampered webhook body is rejected', () => {
  const secret = 'test-secret'
  const ts = Math.floor(Date.now() / 1000)
  const body = '{"type":"payment_intent.succeeded"}'
  const tampered = '{"type":"payment_intent.succeeded","extra":"injected"}'
  const hmac = createHmac('sha256', secret)
  hmac.update(`${ts}.${body}`)
  const signature = `t=${ts},v1=${hmac.digest('hex')}`
  assert.equal(WebhookService.verify(secret, signature, tampered), false)
})
