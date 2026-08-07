#!/bin/bash
set -e

# Close PR 29
gh pr close 29 --repo Truja503/cherito-bitcoin-payments-sdk || true

branches=(
  "feat/17-threat-model"
  "feat/20-ssrf-defense"
  "feat/6-provider-factory"
  "feat/18-5-hardened-secrets"
  "feat/4-tenancy"
  "feat/8-webhooks"
  "feat/3-payment-intents"
  "feat/24-db-migrations"
  "feat/22-safe-logging"
  "feat/9-10-21-api-integration"
)

titles=(
  "docs: Threat model (#17)"
  "feat: SSRF defense in LND provider (#20)"
  "feat: Provider factory (#6)"
  "feat: Hardened API keys and secrets (#18, #5)"
  "feat: Multi-merchant tenancy (#4)"
  "feat: Signed webhooks (#8)"
  "feat: Payment Intent domain model (#3, #7)"
  "feat: Database migrations and schema (#24)"
  "chore: Safe logging for secrets (#22)"
  "feat: Payment Links, Widget, and API validation (#9, #10, #21)"
)

bodies=(
  "Closes #17. Adds formal threat model and trust boundaries."
  "Closes #20. Adds SSRF defenses to LndRestProvider."
  "Closes #6. Introduces ProviderDescriptor and factory pattern."
  "Closes #18. Closes #5. Adds ApiKeyService, hashing, revocation, and bootstrap scripts."
  "Closes #4. Adds Tenant model, TenantService, and pricing rules."
  "Closes #8. Adds WebhookService with HMAC-SHA256 signing and retry logic."
  "Closes #3. Closes #7. Adds PaymentIntentService, recovery mechanisms, and canonical status mapping."
  "Closes #24. Introduces schema_migrations, base schema, and strict FK isolation for intents and tenants."
  "Closes #22. Extends Fastify redact config for secrets."
  "Closes #9. Closes #10. Closes #21. Integrates all new services into server.ts. Adds SSE events, polling, and strict Zod validation. Updates widget to use new API. Note: Includes full suite of gateway tests passing."
)

files=(
  "docs/threat-model.md"
  "packages/cherito-bitcoin-sdk/src/providers/lnd-rest-provider.ts"
  "packages/cherito-bitcoin-sdk/src/providers/provider.ts packages/cherito-bitcoin-sdk/src/types.ts packages/cherito-bitcoin-sdk/src/index.ts"
  "apps/cherito-payments-gateway/src/services/api-key-service.ts .env.example"
  "apps/cherito-payments-gateway/src/services/tenant-service.ts"
  "apps/cherito-payments-gateway/src/services/webhook-service.ts"
  "apps/cherito-payments-gateway/src/services/payment-intent-service.ts"
  "apps/cherito-payments-gateway/src/persistence/repository.ts"
  "apps/cherito-payments-gateway/src/config.ts"
  "apps/cherito-payments-gateway/src/server.ts apps/cherito-payments-gateway/test/gateway.test.ts apps/cherito-payments-gateway/src/services/payment-service.ts"
)

cd /home/chelo/antigravity/cherito/cherito-bitcoin-payments-sdk

git checkout main
prev_branch="main"

for i in "${!branches[@]}"; do
  branch="${branches[$i]}"
  title="${titles[$i]}"
  body="${bodies[$i]}"
  file_list="${files[$i]}"
  
  echo "Processing $branch..."
  
  git checkout -b "$branch"
  # Pull the files from the monolithic branch
  git checkout feat/phase0-phase1-payment-intent-tenancy -- $file_list
  git commit -m "$title"
  git push origin "$branch"
  
  # Create PR with base as previous branch
  gh pr create --repo Truja503/cherito-bitcoin-payments-sdk --base "$prev_branch" --head "marchelo23:$branch" --title "$title" --body "$body"
  
  prev_branch="$branch"
done

echo "Done!"
