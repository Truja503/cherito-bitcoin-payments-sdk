# Secure Deployment Guides

Deploying Cherito safely involves securing the environment variables, ensuring TLS is enabled, and restricting network access.

## General Best Practices

1. **Always Use HTTPS**: Never expose Cherito endpoints over plain HTTP in production. Use a reverse proxy like Nginx or Caddy to handle TLS termination.
2. **Restrict Database Access**: Ensure that your PostgreSQL and SQLite databases are not accessible from the public internet. Use internal networks (VPCs) or firewall rules.
3. **Environment Variables**: Store sensitive values such as `JWT_SECRET`, `DATABASE_URL`, and LNBits/Core-Lightning API keys in secure secret managers or `.env` files that are properly permissioned.
4. **Use Non-Root Users**: If using Docker, run the container as a non-root user for added security.

## Docker Deployment (Recommended)

An official `docker-compose.yml` is provided for running the gateway and its dependencies securely.

### Prerequisites

- Docker and Docker Compose installed.
- A reverse proxy configured for TLS (e.g., Caddy, Traefik).

### Example `docker-compose.yml`

```yaml
version: '3.8'

services:
  gateway:
    image: cherito/payments-gateway:latest
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:password@db:5432/cherito
      - JWT_SECRET=${JWT_SECRET}
      - PROVIDER_LNBITS_URL=https://your-lnbits.domain.com
      - PROVIDER_LNBITS_API_KEY=${LNBITS_API_KEY}
    ports:
      - "127.0.0.1:3000:3000" # Expose only to localhost, let reverse proxy handle external traffic
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=cherito
    volumes:
      - pgdata:/var/lib/postgresql/data
    # No ports exposed to host, only accessible within Docker network

volumes:
  pgdata:
```

## Security Checklist Before Go-Live

- [ ] Changed default database passwords.
- [ ] Generated a strong, random `JWT_SECRET`.
- [ ] Enabled TLS on the reverse proxy.
- [ ] Confirmed the gateway port (`3000`) is NOT publicly accessible.
- [ ] Tested webhook delivery and signature verification.
- [ ] Set up regular automated backups for the PostgreSQL database.
