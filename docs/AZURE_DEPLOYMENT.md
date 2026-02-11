# Azure Container Apps Deployment Guide

This guide covers deploying GenPaper to Azure Container Apps, providing feature parity with Vercel.

## Prerequisites

1. **Azure Account** with an active subscription
2. **Azure CLI** installed (`az --version`)
3. **GitHub repository** with Actions enabled
4. **Docker** installed locally (for testing)

## Azure Resources to Create

### 1. Resource Group

```bash
az group create --name genpaper-rg --location eastus
```

### 2. Azure Container Registry (ACR)

```bash
# Create ACR
az acr create \
  --resource-group genpaper-rg \
  --name genpaperregistry \
  --sku Basic \
  --admin-enabled true

# Get credentials (needed for GitHub secrets)
az acr credential show --name genpaperregistry
```

### 3. Container Apps Environment

```bash
# Create Log Analytics workspace
az monitor log-analytics workspace create \
  --resource-group genpaper-rg \
  --workspace-name genpaper-logs

# Get workspace credentials
LOG_ANALYTICS_WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group genpaper-rg \
  --workspace-name genpaper-logs \
  --query customerId -o tsv)

LOG_ANALYTICS_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --resource-group genpaper-rg \
  --workspace-name genpaper-logs \
  --query primarySharedKey -o tsv)

# Create Container Apps environment
az containerapp env create \
  --name genpaper-env \
  --resource-group genpaper-rg \
  --location eastus \
  --logs-workspace-id $LOG_ANALYTICS_WORKSPACE_ID \
  --logs-workspace-key $LOG_ANALYTICS_KEY
```

### 4. Container App (Initial Creation)

```bash
az containerapp create \
  --name genpaper \
  --resource-group genpaper-rg \
  --environment genpaper-env \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 10 \
  --cpu 1.0 \
  --memory 2.0Gi
```

## GitHub Secrets Configuration

Add these secrets to your GitHub repository (`Settings > Secrets > Actions`):

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `AZURE_CREDENTIALS` | Service principal JSON | See below |
| `AZURE_CONTAINER_REGISTRY` | ACR login server | `genpaperregistry.azurecr.io` |
| `ACR_USERNAME` | ACR admin username | `az acr credential show` |
| `ACR_PASSWORD` | ACR admin password | `az acr credential show` |
| `AZURE_CONTAINER_APPS_ENV` | Environment name | `genpaper-env` |
| `AZURE_CONTAINER_APPS_DOMAIN` | App domain suffix | Check Azure Portal |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL | Your Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Your Supabase dashboard |

### Creating Azure Service Principal

```bash
# Create service principal with Contributor role
az ad sp create-for-rbac \
  --name "genpaper-github-actions" \
  --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/genpaper-rg \
  --sdk-auth

# Copy the entire JSON output to AZURE_CREDENTIALS secret
```

## Environment Variables

Set these in Azure Container Apps:

```bash
az containerapp update \
  --name genpaper \
  --resource-group genpaper-rg \
  --set-env-vars \
    NODE_ENV=production \
    NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
    SUPABASE_SERVICE_ROLE_KEY=eyJ... \
    OPENAI_API_KEY=sk-... \
    AZURE_OPENAI_API_KEY=... \
    AZURE_OPENAI_RESOURCE_NAME=... \
    QDRANT_URL=https://... \
    QDRANT_API_KEY=...
```

## Custom Domain & SSL

### 1. Add Custom Domain

```bash
az containerapp hostname add \
  --name genpaper \
  --resource-group genpaper-rg \
  --hostname app.genpaper.io
```

### 2. Configure DNS

Add a CNAME record pointing to your Container App FQDN:
- Type: CNAME
- Name: app (or @ for root)
- Value: `genpaper.{region}.azurecontainerapps.io`

### 3. Bind Managed Certificate

```bash
az containerapp hostname bind \
  --name genpaper \
  --resource-group genpaper-rg \
  --hostname app.genpaper.io \
  --environment genpaper-env \
  --validation-method CNAME
```

## Scaling Configuration

```bash
# Configure auto-scaling based on HTTP traffic
az containerapp update \
  --name genpaper \
  --resource-group genpaper-rg \
  --min-replicas 1 \
  --max-replicas 10 \
  --scale-rule-name http-scale \
  --scale-rule-type http \
  --scale-rule-http-concurrency 100
```

## CDN Setup (Optional, for Vercel-like edge caching)

### Using Azure Front Door

```bash
# Create Front Door profile
az afd profile create \
  --profile-name genpaper-cdn \
  --resource-group genpaper-rg \
  --sku Standard_AzureFrontDoor

# Add endpoint
az afd endpoint create \
  --profile-name genpaper-cdn \
  --resource-group genpaper-rg \
  --endpoint-name genpaper \
  --enabled-state Enabled

# Add origin (your Container App)
az afd origin-group create \
  --profile-name genpaper-cdn \
  --resource-group genpaper-rg \
  --origin-group-name genpaper-origin

az afd origin create \
  --profile-name genpaper-cdn \
  --resource-group genpaper-rg \
  --origin-group-name genpaper-origin \
  --origin-name containerapp \
  --host-name genpaper.{region}.azurecontainerapps.io \
  --http-port 80 \
  --https-port 443 \
  --priority 1
```

## Monitoring & Logging

### View Logs

```bash
# Stream logs
az containerapp logs show \
  --name genpaper \
  --resource-group genpaper-rg \
  --follow

# Query Log Analytics
az monitor log-analytics query \
  --workspace genpaper-logs \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'genpaper' | order by TimeGenerated desc | take 100"
```

### Application Insights (Optional)

```bash
# Create Application Insights
az monitor app-insights component create \
  --app genpaper-insights \
  --location eastus \
  --resource-group genpaper-rg \
  --kind web

# Get instrumentation key
az monitor app-insights component show \
  --app genpaper-insights \
  --resource-group genpaper-rg \
  --query instrumentationKey -o tsv
```

Add to environment variables:
```
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=xxx;IngestionEndpoint=...
```

## Local Testing

### Build Docker Image Locally

```bash
docker build -t genpaper:local .
```

### Run Locally

```bash
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
  genpaper:local
```

## Troubleshooting

### Container won't start

1. Check logs: `az containerapp logs show --name genpaper --resource-group genpaper-rg`
2. Verify environment variables are set
3. Test Docker image locally

### Health check failing

1. Check `/api/health/live` returns 200
2. Increase health check timeout if needed
3. Check if port 3000 is exposed correctly

### Image pull errors

1. Verify ACR credentials in GitHub secrets
2. Check ACR admin is enabled
3. Verify image was pushed successfully

## Cost Optimization

| Configuration | Monthly Cost (Est.) |
|--------------|---------------------|
| 1 vCPU, 2GB RAM, 1 replica | ~$35 |
| Scale to 0 when idle | ~$15-25 |
| With Azure Front Door | +$35 |

### Enable Scale to Zero (Dev/Staging)

```bash
az containerapp update \
  --name genpaper-staging \
  --resource-group genpaper-rg \
  --min-replicas 0
```

## Comparison: Vercel vs Azure Container Apps

| Feature | Vercel | Azure Container Apps |
|---------|--------|---------------------|
| Auto Deploy | Yes | Via GitHub Actions |
| Preview Deployments | Yes | Via workflow |
| Custom Domain + SSL | Included | Manual setup |
| CDN | Included | Azure Front Door (+$) |
| Scale to Zero | No | Yes |
| Logging | Basic | Log Analytics |
| Cost (small app) | ~$20/mo | ~$35-70/mo |
