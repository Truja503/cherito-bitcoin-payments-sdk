#!/bin/bash
sed -i '/<<<<<<< HEAD/,/=======/!b;//!d;/=======/d' apps/cherito-payments-gateway/src/services/api-key-service.ts
sed -i '/>>>>>>> upstream\/main/d' apps/cherito-payments-gateway/src/services/api-key-service.ts
