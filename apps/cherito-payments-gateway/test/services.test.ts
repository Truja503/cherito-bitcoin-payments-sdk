import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { TenantRepository } from '../src/persistence/tenant-repository.js'
import { Repository } from '../src/persistence/repository.js'
import { ApiKeyService } from '../src/services/api-key-service.js'
import { WebhookService } from '../src/services/webhook-service.js'
import { loadConfig } from '../src/config.js'
import type { Tenant, PaymentIntent } from '../src/persistence/repository.js'

function makeTenant(repo: TenantRepository, id = 'tnt_123') {
  const now = new Date().toISOString()
  repo.createTenant({ id, name: 'Test Merchant', disabled: false, createdAt: now, updatedAt: now })
}

describe('ApiKeyService — Unit Tests', () => {
  test('generate creates a valid sk_live_ key and stores hash in DB', async () => {
    const repo = new TenantRepository(`file::memory:?cache=shared&uri=${randomUUID()}`)
    makeTenant(repo, 'tnt_123')
    const service = new ApiKeyService(repo as never)

    const { key, record } = await service.generate('tnt_123', 'Default Key')

    assert.ok(key.startsWith('sk_live_'))
    assert.equal(record.tenantId, 'tnt_123')
    assert.equal(record.label, 'Default Key')
    assert.equal(record.revokedAt, null)

    const verified = service.verify(key)
    assert.equal(verified?.tenantId, 'tnt_123')
  })

  test('verify rejects invalid, malformed, or wrong prefix keys', () => {
    const repo = new TenantRepository(`file::memory:?cache=shared&uri=${randomUUID()}`)
    const service = new ApiKeyService(repo as never)

    assert.equal(service.verify('invalid_key'), undefined)
    assert.equal(service.verify('sk_live_123456'), undefined)
  })

  test('verify rejects revoked keys', async () => {
    const repo = new TenantRepository(`file::memory:?cache=shared&uri=${randomUUID()}`)
    makeTenant(repo, 'tnt_123')
    const service = new ApiKeyService(repo as never)

    const { key, record } = await service.generate('tnt_123', 'Temporary')
    repo.revokeApiKey(record.id, 'tnt_123')

    assert.equal(service.verify(key), undefined)
  })
})

describe('WebhookService — Unit Tests', () => {
  test('WebhookService.verify validates HMAC signatures and timestamp tolerance', () => {
    const secret = 'whsec_testsecret123'
    const now = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ event: 'payment_intent.succeeded' })

    const validSig = `sha256=${createHmac('sha256', secret).update(`${now}.${body}`).digest('hex')}`

    assert.equal(WebhookService.verify(secret, validSig, now, body), true)
    assert.equal(WebhookService.verify('wrong_secret', validSig, now, body), false)
    assert.equal(WebhookService.verify(secret, 'sha256=invalid', now, body), false)

    // Expired timestamp (> 300s)
    const expiredTimestamp = now - 400
    const expiredSig = `sha256=${createHmac('sha256', secret).update(`${expiredTimestamp}.${body}`).digest('hex')}`
    assert.equal(WebhookService.verify(secret, expiredSig, expiredTimestamp, body, 300), false)
  })

  test('enqueue skips when tenant has no webhookUrl or secret', async () => {
    const repo = new Repository(`file::memory:?cache=shared&uri=${randomUUID()}`)
    const service = new WebhookService(repo)

    const tenant: Tenant = {
      id: 'tnt_1', name: 'No Webhook Shop', webhookUrl: null, webhookSecret: null,
      disabled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const intent: PaymentIntent = {
      id: 'pi_1', tenantId: 'tnt_1', pricingRuleId: null, paymentLinkId: null, merchantOrderId: null,
      amountSats: '1000', currency: 'sat', description: 'Test', metadata: null, status: 'succeeded',
      paymentRequest: 'lnbcrt...', paymentHash: 'hash1', providerInvoiceId: 'inv1', intentSecret: 'sec',
      clientSecretHash: 'cshash', idempotencyKey: null, idempotencyPayloadHash: null,
      expiresAt: new Date().toISOString(), settledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }

    await service.enqueue(tenant, intent, 'payment_intent.succeeded')
    const pending = repo.pendingWebhookDeliveries()
    assert.equal(pending.length, 0)
  })
})

describe('Config — Unit Tests', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    LND_REST_URL: 'https://localhost:8080',
    LND_TLS_CERT_BASE64: Buffer.from('cert').toString('base64'),
    LND_MACAROON_HEX: 'aa',
  }

  test('loadConfig accepts valid environment variables', () => {
    const cfg = loadConfig(baseEnv as unknown as NodeJS.ProcessEnv)
    assert.equal(cfg.NODE_ENV, 'test')
    assert.equal(cfg.PORT, 3100)
    assert.equal(cfg.MIN_INVOICE_SATS, 1000n)
  })

  test('loadConfig rejects forbidden admin credentials', () => {
    for (const name of ['ADMIN_MACAROON', 'SEED', 'XPRV', 'PRIVATE_KEY']) {
      assert.throws(
        () => loadConfig({ ...baseEnv, [name]: 'unsafe' } as unknown as NodeJS.ProcessEnv),
        /Unsafe configuration is forbidden/,
      )
    }
  })

  test('loadConfig rejects inverted invoice satoshi limits', () => {
    assert.throws(
      () => loadConfig({ ...baseEnv, MIN_INVOICE_SATS: '10000', MAX_INVOICE_SATS: '100' } as unknown as NodeJS.ProcessEnv),
      /Invoice limits are inverted/,
    )
  })
})
