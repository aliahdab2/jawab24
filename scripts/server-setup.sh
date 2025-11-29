#!/bin/bash

# =====================================================
# Jawab24 Server Setup Script
# Run this on your Hetzner server (91.99.95.196)
# =====================================================

set -e

echo "🚀 Starting Jawab24 Server Setup..."

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Docker
echo "🐳 Installing Docker..."
apt install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io

# Install Docker Compose
echo "🐳 Installing Docker Compose..."
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Nginx and Certbot
echo "🌐 Installing Nginx and Certbot..."
apt install -y nginx certbot python3-certbot-nginx

# Install Git
echo "📂 Installing Git..."
apt install -y git

# Create app directory
echo "📁 Creating app directory..."
mkdir -p /var/www/jawab24
cd /var/www/jawab24

echo "✅ Base setup complete!"
echo ""
echo "Next steps:"
echo "1. Upload your code to /var/www/jawab24"
echo "2. Run: docker-compose up -d"
echo "3. Run: certbot --nginx -d jawab24.com -d www.jawab24.com"

