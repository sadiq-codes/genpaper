#!/bin/bash
# Deploy OpenClaw to Azure VM
#
# Usage:
#   ./scripts/deploy-openclaw-azure.sh                    # Default setup
#   ./scripts/deploy-openclaw-azure.sh --size Standard_B2s  # Custom VM size
#
# This script:
#   1. Creates an Azure VM (Ubuntu 24.04)
#   2. Installs Node.js 22 and OpenClaw
#   3. Runs the onboarding wizard interactively
#   4. Installs OpenClaw as a systemd daemon
#   5. Sets up SSH tunnel instructions for access

set -e

# Configuration
RESOURCE_GROUP="openclaw-rg"
LOCATION="eastus"
VM_NAME="openclaw-$(date +%Y%m%d%H%M)"
VM_SIZE="Standard_B2s"  # 2 vCPU, 4GB RAM - ~$30/month
VM_IMAGE="Ubuntu2404"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --size)
            VM_SIZE="$2"
            shift 2
            ;;
        --name)
            VM_NAME="$2"
            shift 2
            ;;
        --location)
            LOCATION="$2"
            shift 2
            ;;
        --resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "=============================================="
echo "  OpenClaw Azure VM Deployment"
echo "=============================================="
echo "VM Name:     $VM_NAME"
echo "VM Size:     $VM_SIZE"
echo "Region:      $LOCATION"
echo "Resource:    $RESOURCE_GROUP"
echo "=============================================="
echo ""

# Check if logged in
if ! az account show &>/dev/null; then
    echo "Not logged in to Azure. Run: az login"
    exit 1
fi

# Create resource group if needed
echo "Ensuring resource group exists..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none 2>/dev/null || true

# Create VM
echo "Creating VM (this takes ~2 minutes)..."
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
echo "VM created with IP: $VM_IP"

# Open port 18789 for OpenClaw (optional - only if you want direct access)
echo "Opening port 18789 (OpenClaw Gateway)..."
az vm open-port --resource-group $RESOURCE_GROUP --name $VM_NAME --port 18789 --priority 1010 --output none 2>/dev/null || true

# Wait for VM to be ready
echo "Waiting for VM to be ready..."
sleep 30

# Install Node.js and OpenClaw
echo "Installing Node.js 22 and OpenClaw..."
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=60 azureuser@$VM_IP << 'INSTALL_EOF'
set -e

echo ">>> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo ">>> Node version:"
node --version

echo ">>> Installing OpenClaw globally..."
sudo npm install -g openclaw@latest

echo ">>> OpenClaw version:"
openclaw --version || echo "openclaw installed"

echo ">>> Creating OpenClaw config directory..."
mkdir -p ~/.openclaw

echo ">>> Installation complete!"
INSTALL_EOF

echo ""
echo "=============================================="
echo "  Installation Complete!"
echo "=============================================="
echo ""
echo "VM IP: $VM_IP"
echo "VM Name: $VM_NAME"
echo ""
echo "=============================================="
echo "  NEXT STEPS"
echo "=============================================="
echo ""
echo "1. SSH into your VM and run the onboarding wizard:"
echo ""
echo "   ssh azureuser@$VM_IP"
echo "   openclaw onboard --install-daemon"
echo ""
echo "   The wizard will guide you through:"
echo "   - Selecting your AI provider (Anthropic/OpenAI)"
echo "   - OAuth authentication"
echo "   - Channel setup (WhatsApp/Telegram/Discord/etc)"
echo ""
echo "2. After onboarding, access the dashboard via SSH tunnel:"
echo ""
echo "   ssh -N -L 18789:127.0.0.1:18789 azureuser@$VM_IP"
echo ""
echo "   Then open: http://127.0.0.1:18789/"
echo ""
echo "3. Or access directly (less secure):"
echo ""
echo "   http://$VM_IP:18789/"
echo ""
echo "=============================================="
echo "  USEFUL COMMANDS"
echo "=============================================="
echo ""
echo "Check OpenClaw status:"
echo "   ssh azureuser@$VM_IP 'systemctl --user status openclaw-gateway'"
echo ""
echo "View logs:"
echo "   ssh azureuser@$VM_IP 'journalctl --user -u openclaw-gateway -f'"
echo ""
echo "Restart OpenClaw:"
echo "   ssh azureuser@$VM_IP 'systemctl --user restart openclaw-gateway'"
echo ""
echo "Run OpenClaw doctor:"
echo "   ssh azureuser@$VM_IP 'openclaw doctor'"
echo ""
echo "=============================================="
echo "  CLEANUP"
echo "=============================================="
echo ""
echo "Delete VM when done:"
echo "   az vm delete -g $RESOURCE_GROUP -n $VM_NAME --yes --no-wait"
echo ""
echo "Delete entire resource group:"
echo "   az group delete -n $RESOURCE_GROUP --yes --no-wait"
echo ""
echo "=============================================="

# Save VM info
echo "$VM_NAME $VM_IP $(date)" >> .openclaw-azure-vms.txt
echo ""
echo "VM info saved to .openclaw-azure-vms.txt"
