#!/bin/bash
sed -i "s/tenantService.createTenant('Test Merchant')/tenantService.createTenant({ name: 'Test Merchant' })/g" apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/webhookUrl: null, webhookSecret: null, //g' apps/cherito-payments-gateway/test/gateway.test.ts
sed -i 's/svc.revoke(record.id)/svc.revoke(record.id, tenant.id)/g' apps/cherito-payments-gateway/test/gateway.test.ts
