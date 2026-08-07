#!/bin/bash
sed -i 's/import { Repository } from "..\/src\/persistence\/repository.js"/import { Repository } from "..\/src\/persistence\/repository.js"\nimport { TenantRepository } from "..\/src\/persistence\/tenant-repository.js"/g' apps/cherito-payments-gateway/test/gateway.test.ts

# In intentFixture
sed -i 's/const repo = new Repository(database)/const repo = new Repository(database)\n  const tenantRepo = new TenantRepository(database)/g' apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/const apiKeyService = new ApiKeyService(repo)/const apiKeyService = new ApiKeyService(tenantRepo)/g' apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/const tenantService = new TenantService(repo, apiKeyService)/const tenantService = new TenantService(tenantRepo, apiKeyService)/g' apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/return { config: cfg, lnd, repo, tenantService, webhookService, service: svc }/return { config: cfg, lnd, repo, tenantRepo, tenantService, webhookService, service: svc }/g' apps/cherito-payments-gateway/test/gateway.test.ts

# In AK-01, AK-02, AK-03
sed -i 's/const repo = new Repository(db)/const tenantRepo = new TenantRepository(db)/g' apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/const svc = new ApiKeyService(repo)/const svc = new ApiKeyService(tenantRepo)/g' apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/repo.createTenant(/tenantRepo.createTenant(/g' apps/cherito-payments-gateway/test/gateway.test.ts
