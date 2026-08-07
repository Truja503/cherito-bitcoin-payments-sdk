#!/bin/bash

# Conflict 1: Imports
# Keep upstream/main
sed -i '3,7d' apps/cherito-payments-gateway/src/services/tenant-service.ts
sed -i 's/>>>>>>> upstream\/main//g' apps/cherito-payments-gateway/src/services/tenant-service.ts

# Conflict 2: Constructor
# Keep upstream/main
sed -i '114,116d' apps/cherito-payments-gateway/src/services/tenant-service.ts

# Conflict 3: createTenant
# Keep HEAD (webhookUrl)
sed -i '132,135d' apps/cherito-payments-gateway/src/services/tenant-service.ts

# Conflict 4: upsertPricingRule
# Keep upstream/main
sed -i '210,213d' apps/cherito-payments-gateway/src/services/tenant-service.ts

