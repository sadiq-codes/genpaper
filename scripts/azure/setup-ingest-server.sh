#!/bin/bash
# Setup script for Azure Ingest Server
# Run on the VM after creation

set -e

echo "=== Setting up Ingest Server ==="

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Bun (faster for scripts)
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc

# Install git
sudo apt-get install -y git

# Install tmux for persistent sessions
sudo apt-get install -y tmux

# Create working directory
mkdir -p ~/genpaper-ingest
cd ~/genpaper-ingest

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Clone or copy the genpaper repo"
echo "2. Create .env.local with required variables"
echo "3. Run: bun install"
echo "4. Run: bun run ingest -- --with-pdfs --resume"
echo "   Optional: add --source core or --source disciplines when needed"
echo ""
