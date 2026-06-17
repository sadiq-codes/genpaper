# Self-Hosted Supabase Configuration

This directory contains the configuration for running a self-hosted Supabase instance.

## Directory Structure

```
supabase-docker/
├── .env.example                    # Environment variables template
├── docker-compose.yml              # Docker Compose configuration
├── volumes/
│   └── auth/
│       └── templates/              # Custom email templates
│           ├── confirmation.html
│           ├── magic_link.html
│           ├── recovery.html
│           ├── email_change.html
│           └── invite.html
├── caddy/
│   └── Caddyfile.example           # Reverse proxy configuration
└── README.md
```

## Prerequisites

- Linux VM (Ubuntu 22.04+ recommended)
- Docker and Docker Compose installed
- Domain with DNS configured (e.g., Cloudflare)
- SMTP provider (e.g., Resend, SendGrid)
- Google OAuth credentials (optional)

## Quick Start

### 1. Clone Supabase Docker

```bash
# On your VM
cd ~
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
```

### 2. Copy Configuration

```bash
# Copy this repo's configuration files
cp /path/to/repo/supabase-docker/.env.example .env
cp /path/to/repo/supabase-docker/docker-compose.yml .
mkdir -p volumes/auth/templates
cp /path/to/repo/supabase-docker/volumes/auth/templates/* volumes/auth/templates/
```

### 3. Generate Secrets

```bash
# Generate JWT secret (must be at least 32 characters)
openssl rand -base64 64

# Generate Postgres password
openssl rand -base64 32

# Generate ANON_KEY and SERVICE_ROLE_KEY
# Use https://supabase.com/docs/guides/self-hosting#api-keys
# Or generate manually with your JWT_SECRET
```

### 4. Configure Environment

Edit `.env` with your values:

```bash
# Required changes:
POSTGRES_PASSWORD=<generated-password>
JWT_SECRET=<generated-jwt-secret>
ANON_KEY=<generated-anon-key>
SERVICE_ROLE_KEY=<generated-service-role-key>

# Domain configuration
SITE_URL=https://your-domain.com
API_EXTERNAL_URL=https://api.your-domain.com
ADDITIONAL_REDIRECT_URLS=https://your-domain.com/**

# SMTP (using Resend)
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_your_api_key
SMTP_ADMIN_EMAIL=noreply@your-domain.com

# Google OAuth (optional)
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=your-client-id
GOTRUE_EXTERNAL_GOOGLE_SECRET=your-client-secret
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://api.your-domain.com/auth/v1/callback
```

### 5. Set Up Reverse Proxy (Caddy)

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Generate self-signed certificates (for Cloudflare Full SSL mode)
sudo mkdir -p /etc/caddy/certs
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/caddy/certs/key.pem \
  -out /etc/caddy/certs/cert.pem \
  -subj "/CN=*.your-domain.com"

# Copy and edit Caddyfile
sudo cp caddy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile  # Replace your-domain.com

# Start Caddy
sudo systemctl enable caddy
sudo systemctl start caddy
```

### 6. Configure DNS (Cloudflare)

1. Create A records:
   - `api.your-domain.com` → VM IP (Proxied)
   - `studio.your-domain.com` → VM IP (Proxied)

2. Set SSL/TLS mode to **Full** (not "Full (strict)")

### 7. Start Supabase

```bash
docker compose up -d
```

### 8. Verify

- API: `https://api.your-domain.com/rest/v1/` (should return `{}`)
- Studio: `https://studio.your-domain.com` (login with DASHBOARD_USERNAME/PASSWORD)

## Email Templates

Custom email templates are in `volumes/auth/templates/`. They use Go template syntax:

- `{{ .ConfirmationURL }}` - The confirmation/action URL
- `{{ .SiteURL }}` - Your SITE_URL

To customize templates, edit the HTML files and restart the auth container:

```bash
docker compose restart auth
```

## Generating JWT Keys

The ANON_KEY and SERVICE_ROLE_KEY are JWTs signed with your JWT_SECRET. Generate them using:

```javascript
// Node.js example
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-jwt-secret';

// ANON_KEY
const anonKey = jwt.sign(
  {
    role: 'anon',
    iss: 'supabase',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60) // 10 years
  },
  JWT_SECRET
);

// SERVICE_ROLE_KEY
const serviceKey = jwt.sign(
  {
    role: 'service_role',
    iss: 'supabase',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60) // 10 years
  },
  JWT_SECRET
);

console.log('ANON_KEY:', anonKey);
console.log('SERVICE_ROLE_KEY:', serviceKey);
```

## Storage Setup

Storage files are stored in `volumes/storage/`. The default configuration uses:

```
GLOBAL_S3_BUCKET=stub
```

This creates the path structure: `volumes/storage/stub/storage-single-tenant/<bucket-name>/`

For existing files, ensure they have the correct xattr metadata:

```bash
# Set required xattrs for storage files
setfattr -n user.supabase.cache-control -v "max-age=3600" file.pdf
setfattr -n user.supabase.content-type -v "application/pdf" file.pdf
setfattr -n user.supabase.etag -v "\"$(md5sum file.pdf | cut -d' ' -f1)\"" file.pdf
```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials
3. Add authorized redirect URI: `https://api.your-domain.com/auth/v1/callback`
4. Set the credentials in `.env`:
   ```
   GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
   GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=your-client-id
   GOTRUE_EXTERNAL_GOOGLE_SECRET=your-client-secret
   GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://api.your-domain.com/auth/v1/callback
   ```

## Troubleshooting

### Check container logs
```bash
docker compose logs -f auth    # Auth issues
docker compose logs -f kong    # API gateway issues
docker compose logs -f storage # Storage issues
docker compose logs -f db      # Database issues
```

### Restart services
```bash
docker compose restart         # Restart all
docker compose restart auth    # Restart specific service
```

### Reset everything
```bash
docker compose down -v         # Stop and remove volumes
docker compose up -d           # Start fresh
```

### Common Issues

1. **JWT signature mismatch**: Ensure ANON_KEY and SERVICE_ROLE_KEY are signed with the same JWT_SECRET
2. **Storage 404 errors**: Check file paths and xattr metadata
3. **Google OAuth not working**: Verify redirect URI matches exactly
4. **Email not sending**: Check SMTP credentials and sender domain verification

## Migrating from Supabase Cloud

To migrate data from Supabase Cloud:

1. Export database using `pg_dump`
2. Import to self-hosted using `psql`
3. Download storage files from cloud dashboard
4. Copy to `volumes/storage/stub/storage-single-tenant/<bucket>/`
5. Set xattr metadata on all files

## Security Notes

- Never commit `.env` to version control
- Use strong passwords for POSTGRES_PASSWORD and DASHBOARD_PASSWORD
- Regularly update Docker images
- Consider IP whitelisting for Studio access
- Enable Cloudflare security features (WAF, rate limiting)

## References

- [Supabase Self-Hosting Docs](https://supabase.com/docs/guides/self-hosting)
- [Supabase Docker GitHub](https://github.com/supabase/supabase/tree/master/docker)
- [GoTrue Configuration](https://github.com/supabase/gotrue)
