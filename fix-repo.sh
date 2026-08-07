#!/bin/bash
# Remove CREATE TABLE tenants from repository.ts
sed -i '/CREATE TABLE IF NOT EXISTS tenants/,/;/d' apps/cherito-payments-gateway/src/persistence/repository.ts
sed -i '/CREATE TABLE IF NOT EXISTS merchant_api_keys/,/;/d' apps/cherito-payments-gateway/src/persistence/repository.ts
sed -i '/CREATE TABLE IF NOT EXISTS pricing_rules/,/;/d' apps/cherito-payments-gateway/src/persistence/repository.ts

