# Cherito Threat Model and Trust Boundaries

**Version:** 1.1  
**Status:** Draft, pending independent security review  
**Reviewed against:** the current `main` implementation as of 2026-08-06  
**Scope:** Cherito's receive-only Lightning checkout gateway and SDK

This document describes the security properties that exist in the current default branch. Controls developed in open pull requests are marked **Planned** until they are merged, tested, and enabled by the running gateway.

## 1. Status legend

| Status | Meaning |
|---|---|
| **Implemented** | The control exists in `main` and has a direct code path enforcing it. |
| **Partial** | A useful control exists, but material attack paths or operational gaps remain. |
| **Planned** | The control is proposed or implemented only in an unmerged pull request. It must not be relied upon in production. |
| **Out of scope** | Cherito intentionally does not provide this capability. |

A control is not considered implemented merely because an interface, comment, test double, or pull-request description mentions it.

## 2. Security objective

Cherito coordinates the creation, presentation, verification, and notification of Lightning payments using infrastructure selected by the merchant.

Cherito must not:

- hold merchant funds;
- sign or send outgoing payments;
- manage seed phrases or private keys;
- decide that a payment succeeded based on browser input;
- expose node credentials to browsers or merchant storefronts;
- silently change an invoice amount supplied by the trusted merchant backend.

The authoritative settlement source is the configured Lightning provider. A browser event, redirect, callback parameter, QR scan, or client-side state change is never proof of payment.

## 3. Current architecture

The current `main` branch provides a legacy checkout-session API backed by LND REST, with optional BOLT12 offer support through LNDK.

```text
[Payer wallet]
      |
      | Lightning payment
      v
[Merchant-controlled Lightning node]
      ^
      | HTTPS, pinned CA certificate, macaroon
      | B1
[cherito-payments-gateway]
      ^
      | Public checkout API and scoped status token
      | B2
[Browser or storefront]

[Deployment administrator]
      |
      | Environment, mounted credentials, database and network policy
      | B3
[cherito-payments-gateway host]
```

The following components are planned but are not part of the current trusted runtime until their pull requests are merged:

- merchant API keys;
- multi-tenant resource isolation;
- Payment Intents;
- reusable Payment Links;
- signed merchant webhooks;
- a provider registry or provider factory;
- schema-versioned upgrades from the legacy database;
- the new Payment Intent checkout widget.

## 4. Trust boundaries

| ID | Boundary | Trust assumption | Current control status |
|---|---|---|---|
| B1 | Gateway to Lightning node | The configured node is controlled by the merchant or an explicitly accepted provider. | **Partial:** HTTPS and a configured CA certificate are enforced. Macaroon privileges are not introspected and network destination policy is incomplete. |
| B2 | Browser or storefront to gateway | The browser is fully attacker-controlled. | **Partial:** checkout status requires a random bearer token, request bodies are validated, and settlement is provider-derived. The legacy status token is also persisted in recoverable form for idempotent retries. |
| B3 | Administrator to gateway host | The administrator can read environment variables, mounted files, logs, and the SQLite database. | **Trusted operational boundary:** compromise of this boundary can expose node credentials and alter gateway behavior. |
| B4 | Merchant backend to gateway | Future server-to-server authentication boundary. | **Planned:** merchant API keys and scopes are not present in `main`. |
| B5 | Gateway to merchant webhook endpoint | Future outbound HTTP boundary to a merchant-controlled URL. | **Planned:** signed webhook delivery and SSRF controls are not present in `main`. |
| B6 | Tenant A to Tenant B | Future isolation boundary in a shared gateway. | **Planned:** the current runtime is single-merchant and has no tenant identity. |

## 5. Assets

| Asset | Sensitivity | Current handling | Residual risk |
|---|---|---|---|
| LND macaroon | Critical | Loaded from a mounted file or encoded environment value and sent only to the configured LND endpoint. | The gateway cannot verify that the macaroon is actually invoice-only. A host compromise exposes it. |
| LND TLS certificate | High integrity | Used as the custom CA for HTTPS validation. | Incorrect deployment or replacement of both endpoint and certificate can redirect the gateway. |
| LNDK credentials | Critical | Loaded from separate configured paths when BOLT12 is enabled. | Protected by host and filesystem controls; no automated rotation exists. |
| Checkout status token | High | A random token is hashed for authorization, but the legacy idempotency record stores a recoverable token. | Database disclosure may reveal live status capabilities. |
| Idempotency records | Medium | Stored in SQLite with a configured TTL. | No tenant scope exists in the legacy model. Expired-record cleanup and database lifecycle controls are limited. |
| Payment records and hashes | Medium | Stored in SQLite. | The database is not encrypted by Cherito and may contain merchant metadata in future versions. |
| Merchant API keys | Critical | Not present in current `main`. | Planned control; do not expose planned API routes publicly until key lifecycle and scopes are implemented. |
| Webhook secrets | Critical | Not present in current `main`. | Planned control; future storage and rotation require explicit design. |
| Client secrets for Payment Intents | High | Not present in current `main`. | Planned control must use a server-held master key or authenticated encryption rather than a derivation key stored beside the hash. |

## 6. Adversaries

### 6.1 Internet attacker

Can send arbitrary requests to public endpoints, enumerate identifiers, trigger invoice creation, exploit parsers, and consume resources.

Primary risks:

- invoice flooding;
- status-token guessing;
- endpoint enumeration;
- oversized or malformed payloads;
- information disclosure from health and node-information routes.

### 6.2 Malicious payer

Controls the browser, JavaScript runtime, request body, local storage, redirects, and client-side events.

The payer may attempt to:

- change a price or quantity;
- forge a successful payment state;
- reuse another checkout's status token;
- trigger multiple invoices;
- claim fulfillment before provider-confirmed settlement.

### 6.3 Compromised merchant integration

A compromised storefront or future merchant backend may legitimately create invoices while attempting to access unrelated merchant data or abuse gateway resources.

This risk becomes material when multi-tenancy and merchant API keys are introduced. Tenant isolation, scopes, rotation, and auditability are therefore release requirements for that architecture.

### 6.4 Compromised gateway host or operator

Can read the database, environment, mounted credentials, process memory, and logs. Cherito cannot protect node credentials from a fully compromised host.

The system should still minimize impact by:

- refusing wallet seed and private-key material;
- using the least-privileged macaroon available;
- avoiding plaintext merchant credentials in SQLite;
- supporting credential rotation;
- keeping the gateway receive-only.

### 6.5 Malicious or compromised dependency

Can execute during installation, build, test, or runtime.

Controls include a committed pnpm lockfile, review of dependency changes, restricted CI permissions, and dependency auditing. These controls reduce risk but do not eliminate supply-chain compromise.

### 6.6 Malicious network destination

A configured or attacker-influenced URL may target loopback, private infrastructure, cloud metadata, or a redirect chain.

This applies to both the Lightning provider endpoint and future merchant webhook URLs. URL syntax and HTTPS alone are not complete SSRF defenses.

## 7. Security invariants

The following invariants must remain true across all implementations:

1. **Settlement authority:** only the Lightning provider may move a payment into a successful state.
2. **Server-controlled amount:** the trusted server calculates or approves the invoice amount. A public browser cannot overwrite a fixed amount.
3. **Receive-only credentials:** Cherito must not require seed phrases, private keys, channel-management permissions, or payment-sending permissions.
4. **Credential separation:** browser-facing responses must not contain macaroons, TLS credentials, merchant API keys, webhook secrets, or server master keys.
5. **Monotonic terminal states:** a delayed or duplicate provider event must not reverse a terminal payment state.
6. **Idempotent fulfillment:** duplicate requests, provider callbacks, and webhook deliveries must not cause duplicate merchant fulfillment.
7. **Tenant isolation:** once multi-tenancy is enabled, every merchant-owned read and write must include tenant context at the persistence boundary.
8. **Explicit custody boundary:** adapters for custodial or externally hosted providers must declare their custody model.
9. **No security by UI:** hiding a field, disabling a button, or emitting a browser event is not an authorization or settlement control.

## 8. Threat analysis

### T1. Browser forges payment success

**Attack:** The payer emits a fake SSE event, edits JavaScript state, or submits a forged status value.

**Current controls:**

- the gateway does not accept a browser-supplied settlement state;
- invoice state is read from LND;
- the checkout status endpoint requires a random bearer token.

**Status:** **Implemented**, with the operational requirement that fulfillment must use server-side provider-confirmed state rather than a browser event.

### T2. Browser changes the invoice amount

**Attack:** The payer modifies `productId`, quantity, or a future Payment Link amount.

**Current controls:**

- the current checkout service resolves products from the server-side catalog;
- quantity is validated and bounded;
- minimum and maximum invoice values are enforced.

**Gaps:**

- reusable Payment Links and backend-defined Payment Intents are not in `main`;
- future open-amount links require explicit minimum and maximum bounds;
- merchant order totals must be supplied only by an authenticated backend.

**Status:** **Implemented for the legacy catalog checkout; Planned for Payment Intents and Payment Links.**

### T3. Replay or duplication of invoice creation

**Attack:** The same request is replayed to create multiple invoices or reuse one idempotency key with a different payload.

**Current controls:**

- a UUID idempotency key is required;
- the payload hash is checked before returning the previous session;
- repeated valid requests return the same checkout while the record is active.

**Gaps:**

- the legacy idempotency record is not tenant-scoped;
- expiry and cleanup semantics require explicit tests;
- future Payment Intents need durable behavior for expired keys and payload conflicts.

**Status:** **Partial.**

### T4. Invoice flooding and resource exhaustion

**Attack:** An attacker creates many invoices, opens many SSE connections, or repeatedly polls status endpoints.

**Current controls:**

- an in-process per-IP limit protects checkout creation;
- request bodies are limited to 16 KiB;
- invoice amounts and quantities are bounded;
- provider requests use a timeout.

**Gaps:**

- rate limiting is per process and disappears after restart;
- there is no distributed quota, tenant quota, or connection quota;
- public `/health`, `/v1/node`, and `/v1/capabilities` endpoints can still consume provider resources;
- production deployments need an external reverse proxy, connection limits, and network-level protection.

**Status:** **Partial.**

### T5. Lightning endpoint SSRF or destination substitution

**Attack:** A malicious configuration or future configuration API points the gateway at cloud metadata, loopback, or another internal service.

**Current controls:**

- LND REST requires HTTPS;
- the URL is parsed before use;
- a configured CA certificate is used for TLS validation;
- request paths are constructed internally.

**Gaps:**

- no hostname or IP allowlist is enforced;
- DNS results are not validated;
- private, link-local, metadata, and IPv4-mapped IPv6 destinations are not classified;
- response size and content type are not bounded;
- a private node may be legitimate, so private-network access must require explicit administrator policy rather than a blanket rule.

**Status:** **Partial.** Tracked by the network-hardening work in PR #32.

### T6. Over-privileged macaroon

**Attack:** An administrator configures an admin or wallet-capable macaroon, increasing impact if the gateway is compromised.

**Current controls:**

- variables named `ADMIN_MACAROON`, `SEED`, `XPRV`, and `PRIVATE_KEY` are rejected;
- the gateway is architected to call invoice and node-information endpoints only.

**Gaps:**

- variable names do not prove actual macaroon permissions;
- the macaroon is not decoded or checked against an allowlist of operations;
- deployment documentation must explain how to bake a restricted macaroon.

**Status:** **Partial.**

### T7. TLS interception or hostname mismatch

**Attack:** An attacker intercepts the connection to LND or presents a certificate for another host.

**Current controls:**

- HTTPS is mandatory;
- the configured certificate is used as the trusted CA;
- Node.js hostname verification remains enabled;
- certificate and hostname errors are mapped to explicit provider failures.

**Status:** **Implemented**, assuming the administrator securely provisions the correct endpoint and certificate.

### T8. Status-token disclosure

**Attack:** An attacker reads a database backup, logs, browser history, or an intercepted request and obtains a checkout status token.

**Current controls:**

- the token has high entropy;
- checkout authorization compares a stored hash using a timing-safe operation;
- authorization headers are redacted by the Fastify logger.

**Gaps:**

- the legacy idempotency table stores the status token in recoverable form;
- browser bearer tokens are vulnerable to XSS in the embedding site;
- no token rotation or revocation endpoint exists;
- database encryption is a deployment concern, not an application control.

**Status:** **Partial.**

### T9. Credential leakage through logs

**Attack:** Macaroons, API keys, client secrets, certificates, invoices, or merchant metadata appear in application or container logs.

**Current controls:**

- Fastify redacts authorization, macaroon, and certificate fields from structured request logs;
- internal errors sent to clients replace unexpected messages with a generic response.

**Gaps:**

- the redaction list is incomplete for future secrets;
- direct `console.warn` and `console.error` calls bypass the structured logger;
- no automated canary-secret test proves that logs remain clean;
- invoice strings and payment metadata need an explicit logging policy.

**Status:** **Partial.** Tracked by PR #39.

### T10. Public node-information disclosure

**Attack:** An unauthenticated caller queries `/v1/node`, `/v1/capabilities`, or `/health` to learn infrastructure details or repeatedly trigger provider calls.

**Current controls:** Limited to the public information returned by the node provider.

**Gaps:**

- `/v1/node` is unauthenticated;
- public health checks perform a provider call;
- response fields may reveal node identity, synchronization state, network, and provider type.

**Status:** **Partial.** Production deployments should expose a minimal liveness endpoint and protect detailed readiness or node-information endpoints.

### T11. Restart loses payment observation

**Attack:** The gateway restarts after creating an invoice but before settlement, leaving the merchant unaware of a payment.

**Current controls:** Payment state remains stored in SQLite and may be retrieved when explicitly queried.

**Gaps:**

- active invoice watchers are in memory;
- the current startup path does not reconcile unfinished invoices;
- there is no periodic reconciliation loop independent of subscriptions;
- the provider advertises invoice streaming while the LND adapter currently polls.

**Status:** **Planned.** Recovery and monotonic Payment Intent state transitions are tracked by PR #37.

### T12. Cross-tenant data access

**Attack:** Tenant A reads, modifies, or revokes resources belonging to Tenant B.

**Current controls:** The current `main` runtime is single-merchant and has no tenant boundary.

**Required future controls:**

- tenant identity derived from a verified merchant credential;
- tenant ID required by repository methods;
- composite uniqueness constraints scoped by tenant;
- tenant-scoped API-key revocation;
- cross-tenant integration tests returning a non-enumerating response.

**Status:** **Planned.** Tracked by PR #35.

### T13. Webhook forgery, replay, duplication, or SSRF

**Attack:** An attacker forges a fulfillment event, replays an old event, causes duplicate delivery, or configures an internal network target.

**Current controls:** Signed merchant webhooks are not present in `main`.

**Required future controls:**

- `Cherito-Signature: t=<unix>,v1=<hmac>` over the exact request body;
- a fresh timestamp and signature for every delivery attempt;
- timing-safe verification and replay tolerance;
- stable event and delivery identifiers;
- transactional outbox and uniqueness for logical events;
- atomic delivery claiming;
- redirect restrictions, DNS/IP validation, request timeout, and response-size limit;
- endpoint configuration, rotation, disable, test, and replay operations.

**Status:** **Planned.** Tracked by PR #36 and later integration work.

### T14. Database migration corrupts or strands existing payments

**Attack:** An upgrade changes schemas without preserving legacy orders, invoices, checkout sessions, offers, or idempotency records.

**Current controls:** Tables are created inline with `CREATE TABLE IF NOT EXISTS`.

**Gaps:**

- there is no versioned upgrade path from the current schema;
- changing an existing table definition is not handled by `CREATE TABLE IF NOT EXISTS`;
- no migration fixture proves that existing data survives an upgrade;
- backup, restore, integrity check, and interrupted-migration procedures are not documented.

**Status:** **Planned.** Tracked by PR #38.

### T15. Dependency or build compromise

**Attack:** A compromised package, lifecycle script, CI action, or build artifact introduces malicious behavior.

**Current controls:**

- pnpm lockfile is committed;
- CI installs from the lockfile;
- the receive-only design limits the credentials the application should require.

**Gaps:**

- dependency auditing and license review need an explicit policy;
- CI actions should be pinned and run with minimal permissions;
- production releases need reproducible build and provenance guidance;
- ignored install scripts must be reviewed rather than automatically approved.

**Status:** **Partial.**

## 9. Control inventory and traceability

| Control | Status | Enforcement location | Validation required |
|---|---|---|---|
| Provider-authoritative settlement | **Implemented** | `payment-service.ts`, `lnd-rest-provider.ts` | Integration test against regtest settlement and stale client events. |
| Server-side catalog pricing | **Implemented** | `catalog.ts`, `payment-service.ts` | Test browser cannot override amount or quantity bounds. |
| HTTPS and configured CA for LND | **Implemented** | `lnd-rest-provider.ts` | TLS hostname, wrong certificate, and offline-node tests. |
| Forbidden wallet-material environment names | **Implemented** | `config.ts` | Startup tests for forbidden variables. |
| Exact CORS origin allowlist | **Implemented** | `server.ts` | Allowed and rejected origin tests. |
| Security response headers | **Implemented** | `server.ts` | Route-level header tests. |
| 16 KiB request-body limit | **Implemented** | `server.ts` | Oversized request test. |
| In-process invoice rate limit | **Partial** | `server.ts` | Boundary, reset, proxy-IP, and multi-instance documentation. |
| Legacy idempotent checkout creation | **Partial** | `payment-service.ts`, `repository.ts` | Expiry, collision, replay, and database-restart tests. |
| Status-token secrecy | **Partial** | `payment-service.ts`, `repository.ts`, `server.ts` | Remove recoverable token storage or encrypt it; add leakage tests. |
| Macaroon least privilege | **Partial** | `config.ts`, deployment documentation | Permission verification or documented restricted-macaroon generation. |
| LND destination policy and SSRF defense | **Partial** | PR #32 | DNS/IP classification, explicit private-node allowlist, response limits. |
| Provider factory and custody declaration | **Planned** | PR #33 | Gateway integration and configuration-selection tests. |
| Merchant API-key lifecycle and scopes | **Planned** | PR #34 | Pepper/master key, scopes, expiry, rotation, tenant-scoped revocation. |
| Multi-tenant isolation | **Planned** | PR #35 | Persistence and HTTP cross-tenant integration tests. |
| Signed and retryable webhooks | **Planned** | PR #36 | End-to-end receiver, replay, retry, deduplication, and SSRF tests. |
| Payment Intent state machine and recovery | **Planned** | PR #37 | Restart, expiry, stale event, watcher failure, and idempotency tests. |
| Versioned legacy database upgrade | **Planned** | PR #38 | Upgrade fixture from current `main`, data-preservation and rollback tests. |
| Comprehensive secret redaction | **Planned** | PR #39 | Canary-secret log tests and removal of unstructured secret-bearing logs. |
| Payment Links and new checkout widget | **Planned** | PR #40 or replacement PRs | Fixed/open/donation routes, atomic use semantics, widget integration tests. |

## 10. Non-goals

The following remain out of scope unless the project explicitly changes direction:

- sending Lightning payments;
- holding or converting fiat currency;
- custody of merchant funds;
- seed phrase, private key, or wallet backup management;
- channel opening, closing, rebalancing, or liquidity automation;
- on-chain wallet management;
- automatic verification of the merchant's operating system, reverse proxy, firewall, or backup process;
- protection against a fully compromised gateway host.

## 11. Production release gates

Cherito should not be recommended for real merchant fulfillment until all applicable gates are satisfied:

- [ ] Every control relied upon by deployment documentation is marked **Implemented**, not merely present in an open PR.
- [ ] The complete CI pipeline passes lint, build, typecheck, unit tests, and integration tests.
- [ ] LND regtest verifies creation, settlement, expiration, cancellation, restart recovery, and duplicate provider events.
- [ ] Existing databases upgrade successfully using a fixture created by the current released schema.
- [ ] Merchant authentication includes scopes, expiry, revocation, and rotation.
- [ ] Browser capabilities cannot create arbitrary merchant-defined amounts.
- [ ] Payment terminal states are monotonic and fulfillment is idempotent.
- [ ] Webhook delivery is signed, replay-resistant, retryable, deduplicated, and protected against SSRF.
- [ ] LND and webhook destinations have explicit network policy, DNS/IP validation, timeout, and response-size limits.
- [ ] Secrets are absent from responses, logs, test artifacts, committed files, and database fields not explicitly designed to contain encrypted secret material.
- [ ] Backup, restore, integrity-check, credential-rotation, and incident-response procedures are documented and tested.
- [ ] `pnpm audit` findings are reviewed; relevant high-severity findings are resolved or formally accepted.
- [ ] A vulnerability disclosure policy and private reporting channel are published.
- [ ] An independent security reviewer has reviewed this threat model and the cryptographic key hierarchy.

## 12. Review rules

Update this document whenever a change introduces any of the following:

- a new credential or secret;
- a new public endpoint;
- a new outbound network destination;
- a new Lightning provider;
- a new tenant-owned database entity;
- a change to payment-state transitions;
- a change to idempotency or fulfillment behavior;
- a change to deployment assumptions.

A pull request that changes one of these areas should update the relevant threat, control status, residual risk, and validation requirement in this document.

## 13. Vulnerability disclosure

Do not report suspected vulnerabilities in a public issue.

Use the repository's private GitHub Security Advisory flow. Include:

- affected version or commit;
- threat and impact;
- reproduction steps;
- required privileges and deployment assumptions;
- suggested mitigation when available.

Rotate exposed macaroons, API keys, client secrets, webhook secrets, and server master keys immediately. Preserve relevant logs and database backups without publishing sensitive material.

## 14. References

- BOLT 11 payment encoding specification
- BOLT 12 specification and implementation documentation
- LND REST API documentation
- OWASP API Security Top 10
- OWASP Server-Side Request Forgery Prevention guidance
- NIST SP 800-57, Key Management
