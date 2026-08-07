import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { LndRestProvider, LightningError } from '../src/index.js'

describe('@cherito/bitcoin-sdk — LndRestProvider', () => {
  const dummyCert = Buffer.from('dummy-cert-data')
  const dummyMacaroon = Buffer.from('1234567890abcdef', 'hex')

  test('validates URL protocol and hostname in constructor', () => {
    assert.throws(
      () => new LndRestProvider({ url: 'http://localhost:8080', tlsCertificate: dummyCert, macaroon: dummyMacaroon }),
      (err: LightningError) => {
        assert.equal(err.code, 'CONFIGURATION_ERROR')
        assert.ok(err.message.includes('HTTPS'))
        return true
      },
    )

    assert.throws(
      () => new LndRestProvider({ url: 'not-a-url', tlsCertificate: dummyCert, macaroon: dummyMacaroon }),
      TypeError,
    )
  })

  test('returns default capabilities', async () => {
    const p = new LndRestProvider({ url: 'https://localhost:8080', tlsCertificate: dummyCert, macaroon: dummyMacaroon })
    const caps = await p.getCapabilities()
    assert.equal(caps.bolt11Receive, true)
    assert.equal(caps.bolt12Receive, false)
    assert.equal(caps.provider, 'lnd')
  })

  test('createInvoice rejects zero or negative amounts', async () => {
    const p = new LndRestProvider({ url: 'https://localhost:8080', tlsCertificate: dummyCert, macaroon: dummyMacaroon })
    await assert.rejects(
      () => p.createInvoice({ orderId: 'ord1', amountSats: 0n, memo: 'test' }),
      TypeError,
    )
    await assert.rejects(
      () => p.createInvoice({ orderId: 'ord1', amountSats: -10n, memo: 'test' }),
      TypeError,
    )
  })

  test('getInvoice rejects non-hex or invalid length payment hashes', async () => {
    const p = new LndRestProvider({ url: 'https://localhost:8080', tlsCertificate: dummyCert, macaroon: dummyMacaroon })
    await assert.rejects(
      () => p.getInvoice('short-hash'),
      TypeError,
    )
    await assert.rejects(
      () => p.getInvoice('zz'.repeat(32)),
      TypeError,
    )
  })
})
