# Fix Node.js Installation

## Issue: `node: command not found`

Node.js is not installed or not in your PATH. Here's how to fix it:

## Option 1: Install Node.js (Recommended)

### macOS - Using Homebrew

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node
```

### macOS - Direct Download

1. Visit: https://nodejs.org/
2. Download the LTS version for macOS
3. Run the installer
4. Restart your terminal

### Verify Installation

```bash
node --version
npm --version
```

You should see version numbers if Node.js is installed correctly.

## Option 2: Use nvm (Node Version Manager)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Restart terminal or run:
source ~/.zshrc

# Install Node.js
nvm install --lts
nvm use --lts

# Verify
node --version
```

## After Installing Node.js

Once Node.js is installed, you can run:

```bash
# Navigate to project root
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main

# Then navigate to server
cd server

# Generate invite link
node generate-invite.js
```

## Alternative: Use the Setup Script

Once Node.js is installed, you can also use:

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
npm install
npm run setup
```

This will create everything and generate the invite link.
