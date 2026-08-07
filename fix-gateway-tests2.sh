#!/bin/bash
sed -i 's/const repo = new Repository(database)/const tenantRepo = new TenantRepository(database)/g' apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/const tenantRepo = new TenantRepository(database)/const repo = new Repository(database)/g' apps/cherito-payments-gateway/test/gateway.test.ts
# Wait, this swapping sed logic is flawed because it replaces all instances of A with B, then B with A.
# Let's do it right.
