import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FastifyInstance } from 'fastify'

process.env.NODE_ENV = 'test'

import { buildServer } from '../src/server.ts'
import { loadConfig } from '../src/config.js'

describe('Fastify Server HTTP API — Integration Tests', () => {
  let app: FastifyInstance
  let apiKey: string
  let keyPath: string
  let dbPath: string

  before(async () => {
    try {
      keyPath = join(tmpdir(), `bootstrap-key-${randomUUID()}.txt`)
      dbPath = join(tmpdir(), `test-gw-${randomUUID()}.db`)

      const config = loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: dbPath,
        LND_REST_URL: 'https://localhost:8080',
        LND_TLS_CERT_BASE64: Buffer.from('cert').toString('base64'),
        LND_MACAROON_HEX: 'aa',
        LOG_LEVEL: 'silent',
        BOOTSTRAP_KEY_PATH: keyPath,
      })

      app = await buildServer(config)
      apiKey = (await readFile(keyPath, 'utf8')).trim()
    } catch (err) {
      console.error('BEFORE HOOK FAILED:', err)
      throw err
    }
  })

  after(async () => {
    if (app) await app.close()
    if (keyPath) await unlink(keyPath).catch(() => {})
    if (dbPath) await unlink(dbPath).catch(() => {})
  })

  test('GET /health returns 503 degraded when LND node is offline', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    assert.equal(res.statusCode, 503)
    const body = res.json()
    assert.equal(body.status, 'degraded')
    assert.equal(body.lightning, 'disconnected')
  })

  test('GET /v1/capabilities returns provider capabilities and security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/capabilities' })
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['x-frame-options'], 'DENY')
    const body = res.json()
    assert.equal(body.bolt11Receive, true)
    assert.equal(body.provider, 'lnd')
  })

  test('POST /v1/payment-intents rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      payload: { productId: 'cherito-coffee-001' },
    })
    assert.equal(res.statusCode, 401)
    const body = res.json()
    assert.equal(body.code, 'UNAUTHORIZED')
  })

  test('POST /v1/payment-intents validates body schema with valid merchant API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { productId: 'INVALID PRODUCT ID!' },
    })
    assert.equal(res.statusCode, 400)
  })

  test('POST /v1/payment-intents attempts creation and handles offline node (502)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { productId: 'cherito-coffee-001', quantity: 1 },
    })
    assert.equal(res.statusCode, 502)
    const body = res.json()
    assert.equal(body.code, 'NODE_OFFLINE')
  })

  test('POST /v1/checkout-sessions validates UUID idempotency key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout-sessions',
      headers: { 'idempotency-key': 'not-a-uuid' },
      payload: { productId: 'cherito-coffee-001', quantity: 1 },
    })
    assert.equal(res.statusCode, 400)
    const body = res.json()
    assert.equal(body.code, 'INVALID_IDEMPOTENCY_KEY')
  })
})
