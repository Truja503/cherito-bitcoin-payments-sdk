import { z } from 'zod'

const FORBIDDEN_ENV_VARS = ['ADMIN_MACAROON', 'SEED', 'XPRV', 'PRIVATE_KEY']

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().default('0.0.0.0'),

  // Lightning provider
  LIGHTNING_PROVIDER: z.literal('lnd').default('lnd'),
  LND_REST_URL: z.string().url(),
  LND_TLS_CERT_PATH: z.string().optional(),
  LND_MACAROON_PATH: z.string().optional(),
  LND_TLS_CERT_BASE64: z.string().optional(),
  LND_MACAROON_HEX: z.string().optional(),

  // BOLT12 (experimental)
  BOLT12_PROVIDER: z.enum(['none', 'lndk']).default('none'),
  LNDK_GRPC_URL: z.string().optional(),
  LNDK_TLS_CERT_PATH: z.string().optional(),
  LNDK_MACAROON_PATH: z.string().optional(),

  // CORS
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Invoice limits
  MIN_INVOICE_SATS: z.coerce.bigint().default(1000n),
  MAX_INVOICE_SATS: z.coerce.bigint().default(10000000n),
  DEFAULT_INVOICE_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),

  // Rate limiting
  RATE_LIMIT_CREATE_INVOICE: z.coerce.number().int().positive().default(10),

  // Database
  DATABASE_URL: z.string().default('file:./data/cherito-payments.db'),

  // Logging
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Idempotency
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

  /**
   * Bootstrap API key output path.
   * On first startup when no tenant exists, the generated API key is written
   * to this path. If empty, the key is printed to stdout.
   * Never log or expose this key after initial creation.
   */
  BOOTSTRAP_KEY_PATH: z.string().optional(),

  /**
   * Bootstrap tenant name (used on first-run provisioning).
   */
  BOOTSTRAP_TENANT_NAME: z.string().default('Default Merchant'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Reject any well-known high-privilege or wallet-material variables
  for (const name of FORBIDDEN_ENV_VARS) {
    if (env[name]) {
      throw new Error(`Unsafe configuration is forbidden: ${name}`)
    }
  }

  const c = schema.parse(env)

  if (!c.LND_TLS_CERT_PATH && !c.LND_TLS_CERT_BASE64) {
    throw new Error('LND TLS credential is required')
  }
  if (!c.LND_MACAROON_PATH && !c.LND_MACAROON_HEX) {
    throw new Error('Limited invoice macaroon is required')
  }
  if (c.MIN_INVOICE_SATS > c.MAX_INVOICE_SATS) {
    throw new Error('Invoice limits are inverted')
  }
  if (
    c.BOLT12_PROVIDER === 'lndk' &&
    (!c.LNDK_GRPC_URL || !c.LNDK_TLS_CERT_PATH || !c.LNDK_MACAROON_PATH)
  ) {
    throw new Error('LNDK requires URL and separate mounted credentials')
  }

  return c
}
