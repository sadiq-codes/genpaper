#!/bin/bash
# =============================================================================
# GROBID Azure Container Instance Deployment Script
# =============================================================================
#
# This script deploys a single GROBID instance on Azure Container Instances.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Sufficient Azure subscription permissions
#
# Usage:
#   chmod +x deploy-grobid.sh
#   ./deploy-grobid.sh
#
# After deployment, add to your .env:
#   GROBID_URL=http://<your-dns-label>.<region>.azurecontainer.io:8070
#   ENABLE_GROBID=1
# =============================================================================

set -e  # Exit on error

# =============================================================================
# Configuration - EDIT THESE VALUES
# =============================================================================

RESOURCE_GROUP="grobid-prod-rg"
LOCATION="eastus"                          # Change to your preferred region
CONTAINER_NAME="grobid-server"
DNS_LABEL="genpaper-grobid"                # Must be unique across Azure region
GROBID_IMAGE="grobid/grobid:0.8.1"         # Latest stable version

# Resource allocation
CPU_CORES=4
MEMORY_GB=16

# =============================================================================
# Colors for output
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# =============================================================================
# Pre-flight checks
# =============================================================================

log_info "Checking Azure CLI installation..."
if ! command -v az &> /dev/null; then
    log_error "Azure CLI is not installed. Please install it first:"
    echo "  https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

log_info "Checking Azure login status..."
if ! az account show &> /dev/null; then
    log_warn "Not logged in to Azure. Running 'az login'..."
    az login
fi

SUBSCRIPTION=$(az account show --query name -o tsv)
log_info "Using subscription: $SUBSCRIPTION"

# =============================================================================
# Create Resource Group
# =============================================================================

log_info "Creating resource group '$RESOURCE_GROUP' in '$LOCATION'..."
az group create \
    --name $RESOURCE_GROUP \
    --location $LOCATION \
    --output none

log_success "Resource group created"

# =============================================================================
# Deploy GROBID Container
# =============================================================================

log_info "Deploying GROBID container (this may take 2-3 minutes)..."
log_info "  Image: $GROBID_IMAGE"
log_info "  CPU: $CPU_CORES cores"
log_info "  Memory: $MEMORY_GB GB"
log_info "  DNS: $DNS_LABEL.$LOCATION.azurecontainer.io"

az container create \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINER_NAME \
    --image $GROBID_IMAGE \
    --os-type Linux \
    --cpu $CPU_CORES \
    --memory $MEMORY_GB \
    --ports 8070 \
    --dns-name-label $DNS_LABEL \
    --ip-address Public \
    --restart-policy Always \
    --environment-variables \
        GROBID_OPTS="-Xmx12g -Xms8g" \
    --output none

log_success "Container deployed successfully"

# =============================================================================
# Get Deployment Info
# =============================================================================

log_info "Retrieving deployment information..."

FQDN=$(az container show \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINER_NAME \
    --query ipAddress.fqdn \
    --output tsv)

IP=$(az container show \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINER_NAME \
    --query ipAddress.ip \
    --output tsv)

STATE=$(az container show \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINER_NAME \
    --query instanceView.state \
    --output tsv)

# =============================================================================
# Wait for GROBID to be ready
# =============================================================================

GROBID_URL="http://$FQDN:8070"

log_info "Waiting for GROBID to start (may take 30-60 seconds)..."

MAX_RETRIES=20
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s --max-time 5 "$GROBID_URL/api/isalive" | grep -q "true"; then
        log_success "GROBID is alive and responding!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -n "."
    sleep 5
done
echo ""

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    log_warn "GROBID health check timed out. Container may still be starting."
    log_warn "Check status with: az container logs --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
fi

# =============================================================================
# Get Version Info
# =============================================================================

VERSION=$(curl -s --max-time 10 "$GROBID_URL/api/version" 2>/dev/null || echo "Unable to fetch")

# =============================================================================
# Output Summary
# =============================================================================

echo ""
echo "============================================================================="
echo -e "${GREEN}GROBID Deployment Complete!${NC}"
echo "============================================================================="
echo ""
echo "Container Status: $STATE"
echo "GROBID Version:   $VERSION"
echo ""
echo "Endpoint Information:"
echo "  FQDN:     $FQDN"
echo "  IP:       $IP"
echo "  Port:     8070"
echo "  Full URL: $GROBID_URL"
echo ""
echo "Health Check:"
echo "  curl $GROBID_URL/api/isalive"
echo ""
echo "============================================================================="
echo -e "${YELLOW}Add to your .env file:${NC}"
echo "============================================================================="
echo ""
echo "  GROBID_URL=$GROBID_URL"
echo "  ENABLE_GROBID=1"
echo ""
echo "============================================================================="
echo -e "${BLUE}Useful Commands:${NC}"
echo "============================================================================="
echo ""
echo "  # View logs"
echo "  az container logs --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
echo ""
echo "  # Check status"
echo "  az container show --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME --query instanceView.state"
echo ""
echo "  # Restart container"
echo "  az container restart --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
echo ""
echo "  # Stop container (to save costs)"
echo "  az container stop --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
echo ""
echo "  # Start container"
echo "  az container start --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
echo ""
echo "  # Delete everything"
echo "  az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo ""
echo "============================================================================="
echo -e "${GREEN}Estimated Monthly Cost: ~\$150 (4 vCPU, 16GB RAM, 24/7)${NC}"
echo "============================================================================="
