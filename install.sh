#!/bin/bash
set -e

# Function to check for jq and install if necessary
check_and_install_jq() {
    if ! command -v jq &> /dev/null; then
        # Try to install jq based on the system package manager
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            sudo apt-get update && sudo apt-get install -y jq > /dev/null
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            brew install jq > /dev/null
        else
            echo "Please install jq manually: https://stedolan.github.io/jq/download/"
            exit 1
        fi
    fi
}

echo " "
echo "=========================================="
echo "Welcome to the StarbaseDB installation script!"
echo " "
echo "This script will deploy a Cloudflare Worker and create an Outerbase Starlink session."
echo "If you don't have a paid Cloudflare account, your deployment will fail."
echo " "
echo "IMPORTANT: You _MUST_ have a paid Cloudflare account to use SQLite in Durable Objects."
echo "=========================================="
echo " "

# Step 1: Check if jq is installed
check_and_install_jq

# Step 2: Clone the repository
if ! command -v git &> /dev/null; then
    echo "Git is not installed. Please install Git and try again."
    exit 1
fi

echo "Cloning the repository..."
git clone https://github.com/outerbase/starbasedb.git > /dev/null 2>&1 || { echo "Error: Failed to clone the repository. Please check your internet connection and try again."; exit 1; }
cd starbasedb || { echo "Error: Failed to change to the starbasedb directory. The clone might have failed."; exit 1; }

# Step 3: Generate a secure AUTHORIZATION_TOKEN and update wrangler.toml
os=$(uname -s)
PLATFORM_SED="sed -i ''"

# choose correct version of sed utility for platform
case "$os" in
    Linux*)
        # GNU utilities
        PLATFORM_SED="sed -i"
        ;;
    Darwin*)
        # BSD utilities (macOS)
        PLATFORM_SED="sed -i ''"
        ;;
    *BSD*)
        # Other BSD variants (FreeBSD, OpenBSD, etc)
        PLATFORM_SED="sed -i ''"
        ;;
    *)
        echo "Unknown operating system: $os"
        exit 1
        ;;
esac

AUTHORIZATION_TOKEN=$(openssl rand -hex 16)
$PLATFORM_SED "s/AUTHORIZATION_TOKEN = \"[^\"]*\"/AUTHORIZATION_TOKEN = \"$AUTHORIZATION_TOKEN\"/" wrangler.toml

# Step 4: Prompt the user for Cloudflare account_id (force interaction)
echo " "
echo "Please enter your Cloudflare account_id (from 'wrangler whoami' or the Cloudflare dashboard):"
read -r ACCOUNT_ID </dev/tty
$PLATFORM_SED "s/^account_id = .*/account_id = \"$ACCOUNT_ID\"/" wrangler.toml || echo "account_id = \"$ACCOUNT_ID\"" >> wrangler.toml

# Step 5: Create an Outerbase Studio account
ADMIN_USER="admin"
ADMIN_PASS=$(openssl rand -hex 16)

# Step 6: Update the wrangler.toml with generated STUDIO_USER and STUDIO_PASS
$PLATFORM_SED 's/# STUDIO_USER = "admin"/STUDIO_USER = "'"$ADMIN_USER"'"/' wrangler.toml
$PLATFORM_SED 's/# STUDIO_PASS = "123456"/STUDIO_PASS = "'"$ADMIN_PASS"'"/' wrangler.toml

# Step 7: Run typegen command
npm install > /dev/null 2>&1
npm run cf-typegen > /dev/null 2>&1

# Step 8: Deploy the worker
echo " "
echo "Deploying your worker..."
# DEPLOY_OUTPUT=$(npm run deploy 2>&1) # This will hide the output
DEPLOY_OUTPUT=$(npm run deploy)

# Step 9: Extract the URL from the deploy output
HOST_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev')
if [ -n "$HOST_URL" ]; then
    echo "Worker deployed successfully at $HOST_URL."
else
    echo "Error: Failed to extract the worker URL."
    echo "Verify that you are using a paid Cloudflare account and try again."
    exit 1
fi

STARLINK_URL="$HOST_URL/studio"

# Step 10: Enjoy :)
if [ -n "$STARLINK_URL" ]; then
    echo " "
    echo "=========================================="
    echo " "
    echo "Outerbase Studio user account created!"
    echo "Use the following URL to view your database:"
    echo
    echo "$STARLINK_URL"
    echo
    echo "Username: $ADMIN_USER"
    echo "Password: $ADMIN_PASS"
    echo
    echo "NOTE: You can change your Outerbase Studio password in the wrangler.toml file and redeploy."
    echo
    echo "=========================================="
else
    echo "Error: Failed to create Outerbase Starlink session."
fi
