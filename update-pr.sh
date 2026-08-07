#!/bin/bash
branch=$1
echo "Updating $branch..."
git checkout $branch
git merge upstream/main -m "Merge upstream/main" || true
git checkout feat/9-10-21-api-integration -- apps/cherito-payments-gateway/src/services/api-key-service.ts apps/cherito-payments-gateway/src/services/tenant-service.ts apps/cherito-payments-gateway/test/tenancy.test.ts apps/cherito-payments-gateway/src/server.ts
git add .
git commit -m "Merge upstream/main and resolve conflicts" || true
git push -f origin $branch
