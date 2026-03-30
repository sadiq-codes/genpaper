#!/bin/bash
# Deploy bulk ingestion to Azure VM (no Docker required)
#
# Usage:
#   ./scripts/deploy-azure-vm.sh                                              # Default: 500K papers
#   ./scripts/deploy-azure-vm.sh --limit 10000 --query "microbiology"         # Custom
#
# This script:
#   1. Creates an Azure VM (Ubuntu 22.04)
#   2. Copies necessary files directly (no git clone needed)
#   3. Installs Node.js and dependencies
#   4. Runs the ingestion script in background

set -e

# Configuration
RESOURCE_GROUP="genpaper-rg"
LOCATION="eastus"
VM_NAME="genpaper-ingest-$(date +%Y%m%d%H%M)"
VM_SIZE="Standard_B2s"  # 2 vCPU, 4GB RAM - ~$30/month
VM_IMAGE="Ubuntu2204"

# Parse arguments - everything after script name is passed to ingestion
INGEST_ARGS="${@:---limit 500000}"

echo "=============================================="
echo "🚀 Azure VM Deployment for Paper Ingestion"
echo "=============================================="
echo "VM Name:     $VM_NAME"
echo "VM Size:     $VM_SIZE"
echo "Region:      $LOCATION"
echo "Ingest Args: $INGEST_ARGS"
echo "=============================================="

# Check if logged in
if ! az account show &>/dev/null; then
    echo "❌ Not logged in to Azure. Run: az login"
    exit 1
fi

# Check for .env.local
if [ ! -f .env.local ]; then
    echo "❌ .env.local not found"
    exit 1
fi

# Create resource group if needed
echo "📦 Ensuring resource group exists..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none 2>/dev/null || true

# Create VM
echo "🖥️  Creating VM (this takes ~2 minutes)..."
az vm create \
    --resource-group $RESOURCE_GROUP \
    --name $VM_NAME \
    --image $VM_IMAGE \
    --size $VM_SIZE \
    --admin-username azureuser \
    --generate-ssh-keys \
    --public-ip-sku Standard \
    --output none

# Get VM IP
VM_IP=$(az vm show --resource-group $RESOURCE_GROUP --name $VM_NAME --show-details --query publicIps -o tsv)
echo "✅ VM created with IP: $VM_IP"

# Wait for VM to be ready
echo "⏳ Waiting for VM to be ready..."
sleep 30

# Install runtime on VM
echo "📦 Installing runtime on VM..."
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=60 azureuser@$VM_IP << 'INSTALL_EOF'
set -e
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs unzip
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
mkdir -p ~/genpaper
INSTALL_EOF

# Copy necessary files
echo "📤 Copying files to VM..."
scp package.json azureuser@$VM_IP:~/genpaper/
scp bun.lock azureuser@$VM_IP:~/genpaper/
scp tsconfig.json azureuser@$VM_IP:~/genpaper/
scp .env.local azureuser@$VM_IP:~/genpaper/.env.local
scp -r scripts azureuser@$VM_IP:~/genpaper/
scp -r lib azureuser@$VM_IP:~/genpaper/
scp -r types azureuser@$VM_IP:~/genpaper/ 2>/dev/null || true

# Install dependencies and run
echo "📦 Installing dependencies and starting ingestion..."
ssh azureuser@$VM_IP << RUNEOF
export BUN_INSTALL="\$HOME/.bun"
export PATH="\$BUN_INSTALL/bin:\$PATH"
cd ~/genpaper
bun install --frozen-lockfile
echo "🚀 Starting ingestion with args: $INGEST_ARGS"
nohup bun run ingest -- $INGEST_ARGS > ~/ingestion.log 2>&1 &
echo "Process started with PID: \$!"
RUNEOF

echo ""
echo "=============================================="
echo "✅ Deployment Complete!"
echo "=============================================="
echo ""
echo "VM IP:       $VM_IP"
echo "VM Name:     $VM_NAME"
echo ""
echo "📊 Monitor progress:"
echo "   ssh azureuser@$VM_IP 'tail -f ~/ingestion.log'"
echo ""
echo "📊 Check database locally:"
echo "   npx tsx scripts/check-progress.ts"
echo ""
echo "🔍 SSH into VM:"
echo "   ssh azureuser@$VM_IP"
echo ""
echo "🛑 Stop and delete VM when done:"
echo "   az vm delete -g $RESOURCE_GROUP -n $VM_NAME --yes --no-wait"
echo "=============================================="

# Save VM info
echo "$VM_NAME $VM_IP $(date)" >> .azure-vms.txt
echo "VM info saved to .azure-vms.txt"
