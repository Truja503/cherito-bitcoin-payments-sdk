import { randomUUID, randomBytes } from 'node:crypto'
import type { Repository, Tenant, PricingRule } from '../persistence/repository.js'
import type { ApiKeyService } from './api-key-service.js'

/**
 * TenantService handles merchant account creation and pricing rule management.
 *
 * Bootstrap behavior:
 * On first startup, if no tenants exist, the gateway creates a default tenant
 * and prints its API key to stdout (or writes to ADMIN_KEY_PATH if configured).
 * This is the ONLY time the key is visible.
 */
export class TenantService {
  constructor(
    private readonly repo: Repository,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  /**
   * Create a new tenant and return its first API key (plaintext, shown once).
   */
  async createTenant(name: string, label = 'default'): Promise<{ tenant: Tenant; apiKey: string }> {
    const now = new Date().toISOString()
    const tenant: Tenant = {
      id: `tnt_${randomUUID()}`,
      name,
      webhookUrl: null,
      webhookSecret: randomBytes(32).toString('hex'),  // auto-generate per-tenant secret
      createdAt: now,
      updatedAt: now,
    }

    this.repo.createTenant(tenant)
    const { key } = await this.apiKeyService.generate(tenant.id, label)
    return { tenant, apiKey: key }
  }

  /**
   * Add or update a pricing rule (product) for a tenant.
   */
  upsertPricingRule(
    tenantId: string,
    input: {
      productId: string
      name: string
      description?: string
      priceSats: bigint
      maxQuantity?: number
      offerEnabled?: boolean
    },
  ): PricingRule {
    const now = new Date().toISOString()
    const rule: PricingRule = {
      id: `pr_${randomUUID()}`,
      tenantId,
      productId: input.productId,
      name: input.name,
      description: input.description ?? null,
      priceSats: input.priceSats.toString(),
      active: true,
      maxQuantity: input.maxQuantity ?? 10,
      offerEnabled: input.offerEnabled ?? false,
      createdAt: now,
      updatedAt: now,
    }

    this.repo.createPricingRule(rule)
    return rule
  }
}
