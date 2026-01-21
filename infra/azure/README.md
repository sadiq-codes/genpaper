# GROBID Azure Deployment

Deploy GROBID (GeneRation Of BIbliographic Data) on Azure Container Instances for PDF metadata extraction.

## Overview

GROBID extracts structured data from scholarly PDFs:
- Title, authors, affiliations
- Abstract, keywords
- Full text structure
- References/citations
- Figures, tables

## Quick Start

### Prerequisites

1. **Azure CLI** - [Install Guide](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
2. **Azure Subscription** with sufficient permissions

### Deploy

```bash
# Login to Azure (if not already)
az login

# Run deployment script
./deploy-grobid.sh
```

### Configure GenPaper

After deployment, add to your `.env.local`:

```bash
GROBID_URL=http://genpaper-grobid.eastus.azurecontainer.io:8070
ENABLE_GROBID=1
```

## Configuration

Edit `deploy-grobid.sh` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `RESOURCE_GROUP` | `grobid-prod-rg` | Azure resource group name |
| `LOCATION` | `eastus` | Azure region |
| `DNS_LABEL` | `genpaper-grobid` | DNS prefix (must be unique) |
| `CPU_CORES` | `4` | Number of vCPUs |
| `MEMORY_GB` | `16` | Memory allocation |

## Resource Sizing

| Scale | CPU | Memory | Est. Cost/Month |
|-------|-----|--------|-----------------|
| Light (< 100 PDFs/day) | 2 | 8 GB | ~$75 |
| **Standard (100-500/day)** | **4** | **16 GB** | **~$150** |
| Heavy (500-1000/day) | 4 | 16 GB x2 instances | ~$300 |

## Management Commands

```bash
# View logs
az container logs --resource-group grobid-prod-rg --name grobid-server

# Check status
az container show --resource-group grobid-prod-rg --name grobid-server --query instanceView.state

# Restart
az container restart --resource-group grobid-prod-rg --name grobid-server

# Stop (to save costs when not needed)
az container stop --resource-group grobid-prod-rg --name grobid-server

# Start
az container start --resource-group grobid-prod-rg --name grobid-server

# Delete everything
az group delete --name grobid-prod-rg --yes
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/isalive` | GET | Health check |
| `/api/version` | GET | Version info |
| `/api/processHeaderDocument` | POST | Extract header (title, authors, abstract) |
| `/api/processFulltextDocument` | POST | Extract full text with structure |
| `/api/processReferences` | POST | Extract references only |

### Test the API

```bash
# Health check
curl http://your-grobid.eastus.azurecontainer.io:8070/api/isalive

# Process a PDF
curl -X POST \
  -F "input=@paper.pdf" \
  "http://your-grobid.eastus.azurecontainer.io:8070/api/processHeaderDocument"
```

## Troubleshooting

### Container not starting

```bash
# Check logs
az container logs --resource-group grobid-prod-rg --name grobid-server --follow

# Check events
az container show --resource-group grobid-prod-rg --name grobid-server --query "instanceView.events"
```

### Out of memory

Increase `MEMORY_GB` in the script and redeploy, or adjust JVM settings:

```bash
--environment-variables GROBID_OPTS="-Xmx14g -Xms10g"
```

### DNS name already taken

Change `DNS_LABEL` to something unique in your region.

## Security Considerations

The current setup exposes GROBID publicly. For production, consider:

1. **Azure API Management** - Add API keys, rate limiting
2. **VNet Integration** - Private networking with your app
3. **IP Whitelisting** - Restrict to your app's IP ranges

## Scaling

For higher throughput, deploy multiple instances with Azure Load Balancer. Contact the team for multi-instance deployment scripts.
