# Cryptographic Key Hierarchy and Lifecycle

This document defines the cryptographic secrets owned by the Cherito SDK, their generation, storage, usage, and lifecycle.

## Approved Constructions

- **Secret Generation**: CSPRNG-generated opaque secrets with a minimum of 256 bits of entropy.
- **Webhook Authentication**: HMAC-SHA-256 signatures over the payload.
- **Token Hashing**: HMAC-SHA-256 using a server-held pepper (or a reviewed equivalent like Argon2id) for high-entropy token fingerprints.
- **Encryption at Rest**: AES-256-GCM or XChaCha20-Poly1305 provided by standard libraries (e.g. Node.js `crypto`) for authenticated encryption of stored credentials.
- **Comparison**: Constant-time comparison for all secret-derived values.

## Prohibited Behaviors

- No custom encryption algorithms.
- No deterministic or sequential public tokens.
- No password-style human-readable secrets for API authentication.
- No nonce reuse with AEAD.
- No encryption without authentication.
- No storing recoverable API/client secrets in plaintext in the database.
- No sharing of a single secret across unrelated merchants or purposes.

---

## 1. Merchant API Key Secrets

- **Purpose & Scope**: Authenticate merchant backend systems making requests to the Cherito API. Scoped strictly to the individual merchant tenant.
- **Generation Source & Minimum Entropy**: CSPRNG (e.g., `crypto.randomBytes(32)`), yielding 256 bits of entropy.
- **Storage Location**: The plaintext key is **never** stored. A cryptographic hash (fingerprint) is stored in the database (`api_keys` table).
- **Derivation / Fingerprint Method**: HMAC-SHA-256 of the plaintext key using a server-wide secret pepper, or a salted hash using an algorithm like Argon2id.
- **Rotation Process**: Merchants can generate multiple overlapping keys. A new key is generated, and the old one remains active until the merchant manually revokes it or the transition period expires.
- **Revocation Behavior**: Once marked as revoked in the database, any API request using the old key is immediately denied.
- **Backup Requirements**: Fingerprints are backed up along with the database. Plaintext keys are presented once to the user and cannot be recovered.
- **Compromise Impact**: An attacker with a compromised API key can read/write data in the scope of that merchant (create intents, read payments) but cannot access other merchants or node credentials.
- **Destruction and Retention Policy**: Revoked keys are retained indefinitely for audit purposes but disabled. When a merchant account is deleted, the fingerprints are hard-deleted.

## 2. Client Token Secrets

- **Purpose & Scope**: Authenticate public or frontend clients (e.g., checkout widgets) to create payments or listen for status events. Scoped to a specific merchant and limited permissions.
- **Generation Source & Minimum Entropy**: CSPRNG, 256 bits of entropy.
- **Storage Location**: Database (fingerprint only).
- **Derivation / Fingerprint Method**: HMAC-SHA-256 with server pepper.
- **Rotation Process**: Follows the same overlapping generation and manual revocation process as Merchant API keys.
- **Revocation Behavior**: Immediate denial of access upon revocation.
- **Backup Requirements**: Fingerprints backed up with the database.
- **Compromise Impact**: An attacker can initiate payments or view public payment status, but cannot modify merchant configuration or access sensitive billing data.
- **Destruction and Retention Policy**: Hard-deleted upon token deletion or merchant removal.

## 3. Webhook Signing Secrets

- **Purpose & Scope**: Verify to the merchant that incoming webhooks originated from Cherito and have not been tampered with. Scoped per webhook endpoint.
- **Generation Source & Minimum Entropy**: CSPRNG, 256 bits of entropy.
- **Storage Location**: Encrypted at rest in the database (or provided dynamically if stateless).
- **Derivation / Fingerprint Method**: The plaintext is used as the key for an HMAC-SHA-256 signature of the webhook payload.
- **Rotation Process**: Endpoints can have multiple active signing secrets (e.g., `v1` and `v2` signatures sent in headers) to allow seamless rotation on the merchant side.
- **Revocation Behavior**: When a secret is removed, the corresponding signature is no longer attached to outgoing webhooks.
- **Backup Requirements**: Backups include the encrypted secret.
- **Compromise Impact**: An attacker can forge webhook events, potentially tricking a merchant into fulfilling an unpaid order.
- **Destruction and Retention Policy**: Hard-deleted when the webhook endpoint is removed.

## 4. Server-Side Token-Hashing Pepper

- **Purpose & Scope**: A global, server-held secret used to compute HMACs (fingerprints) of API keys and client tokens before database storage. Prevents offline cracking of tokens if only the database is compromised.
- **Generation Source & Minimum Entropy**: CSPRNG, 256 bits of entropy. Provided via environment variable (`CHERITO_SECRET_PEPPER`).
- **Storage Location**: In-memory via environment variables or a secure secret manager (e.g., AWS Secrets Manager, HashiCorp Vault). Never stored in the database.
- **Derivation / Fingerprint Method**: N/A.
- **Rotation Process**: Rotation requires a script to re-hash all existing tokens, meaning the plaintext tokens must be temporarily available or the system must support multiple active peppers (e.g., `pepper_v1`, `pepper_v2`).
- **Revocation Behavior**: N/A.
- **Backup Requirements**: Backed up externally in the infrastructure configuration, distinct from the database backup.
- **Compromise Impact**: If the pepper and the database are both compromised, an attacker can brute-force offline, but since keys have 256 bits of entropy, brute-forcing is practically impossible.
- **Destruction and Retention Policy**: Destroyed upon infrastructure decommissioning.

## 5. Provider Credentials and TLS Trust Material

- **Purpose & Scope**: Secrets required to connect to Lightning nodes (e.g., LND Macaroons, Core Lightning runes, TLS certificates). Scoped per node connection.
- **Generation Source & Minimum Entropy**: Generated by the target Lightning node.
- **Storage Location**: Stored in the database, encrypted at rest using AES-256-GCM.
- **Derivation / Fingerprint Method**: N/A.
- **Rotation Process**: Handled by the node operator. The merchant updates the credential in Cherito.
- **Revocation Behavior**: Immediate failure to connect to the node, causing payments to fail until updated.
- **Backup Requirements**: Backed up with the database (in encrypted form).
- **Compromise Impact**: If decrypted, an attacker could interact with the Lightning node. Cherito recommends strictly least-privilege credentials (invoice creation/read only).
- **Destruction and Retention Policy**: Hard-deleted when the node connection is removed from the merchant's configuration.

## 6. Database Credential-Encryption Key Hierarchy (Optional)

- **Purpose & Scope**: Encrypts sensitive data at rest in the database (such as webhook secrets and provider credentials).
- **Generation Source & Minimum Entropy**: CSPRNG, 256 bits (Data Encryption Key - DEK).
- **Storage Location**: 
  - **DEK**: Stored in the database alongside the data, encrypted by a Master Encryption Key (MEK).
  - **MEK**: Provided via environment variable or KMS.
- **Derivation / Fingerprint Method**: N/A.
- **Rotation Process**: DEKs can be rotated by decrypting and re-encrypting rows. MEKs can be rotated through KMS.
- **Revocation Behavior**: N/A.
- **Backup Requirements**: MEK must be securely backed up separate from the database.
- **Compromise Impact**: Loss of MEK prevents decryption of all stored credentials. Compromise of MEK allows decryption of the database.
- **Destruction and Retention Policy**: MEK destruction cryptographically erases all provider connections and webhooks.
