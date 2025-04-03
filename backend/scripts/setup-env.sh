#!/bin/bash

# OTORI Vision - Environment Setup Script
# This script securely sets up environment variables for the OTORI Vision backend

# Base directory
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
ENV_FILE="$BASE_DIR/.env"

echo "================================="
echo "OTORI Vision Environment Setup"
echo "================================="
echo "This script will help you set up the required environment variables securely."
echo "Environment will be saved to: $ENV_FILE"
echo

# Check if .env file exists
if [ -f "$ENV_FILE" ]; then
  read -p "Environment file already exists. Overwrite? (y/n): " OVERWRITE
  if [ "$OVERWRITE" != "y" ]; then
    echo "Keeping existing environment file. Exiting."
    exit 0
  fi
fi

# Create or clear the .env file
echo "# OTORI Vision Environment Variables" > "$ENV_FILE"
echo "# Created: $(date)" >> "$ENV_FILE"
echo "# Note: This file contains sensitive information and should not be committed to version control" >> "$ENV_FILE"
echo "" >> "$ENV_FILE"

# Function to prompt for a variable and add it to .env
add_env_var() {
  local VAR_NAME=$1
  local VAR_DESC=$2
  local DEFAULT=$3
  local IS_SECRET=$4

  if [ "$IS_SECRET" = "true" ]; then
    echo -n "$VAR_DESC [$DEFAULT]: "
    read -s VALUE
    echo  # Add a newline after the password input
  else
    read -p "$VAR_DESC [$DEFAULT]: " VALUE
  fi

  if [ -z "$VALUE" ] && [ ! -z "$DEFAULT" ]; then
    VALUE=$DEFAULT
  fi

  echo "$VAR_NAME=$VALUE" >> "$ENV_FILE"
  echo "- Added $VAR_NAME"
}

# Bitcoin network settings
echo "Setting up Bitcoin network..."
add_env_var "BITCOIN_NETWORK" "Bitcoin network (mainnet, testnet, signet)" "signet" "false"
add_env_var "BITCOIN_RPC_HOST" "Bitcoin RPC host" "91.7.62.224" "false"
add_env_var "BITCOIN_RPC_PORT" "Bitcoin RPC port" "38332" "false"
add_env_var "BITCOIN_RPC_USER" "Bitcoin RPC username" "bitcoin" "false"
add_env_var "BITCOIN_RPC_PASSWORD" "Bitcoin RPC password" "" "true"
add_env_var "BITCOIN_WALLET" "Bitcoin wallet name" "ovt-LP-wallet" "false"

# SSH Connection settings
echo -e "\nSetting up SSH connection to OrdPi..."
add_env_var "ORDPI_SSH_HOST" "SSH host" "91.7.62.224" "false"
add_env_var "ORDPI_SSH_PORT" "SSH port" "2211" "false"
add_env_var "ORDPI_SSH_USER" "SSH username" "BTCPi" "false"
add_env_var "ORDPI_SSH_PASSWORD" "SSH password" "" "true"

# OVT Token settings
echo -e "\nSetting up OVT Token settings..."
add_env_var "OVT_RUNE_ID" "OVT Rune ID" "240249:101" "false"
add_env_var "OVT_RUNE_NAME" "OVT Rune Name" "OTORI•VISION•TOKEN" "false"
add_env_var "LP_ADDRESS" "Liquidity provider address" "tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f" "false"
add_env_var "OVT_TREASURY_ADDRESS" "OVT Treasury address" "tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd" "false"

# API settings
echo -e "\nSetting up API settings..."
add_env_var "PORT" "API port" "3030" "false"
add_env_var "ENABLE_RATE_LIMITING" "Enable rate limiting" "true" "false"
add_env_var "MAX_REQUESTS_PER_MINUTE" "Max requests per minute" "60" "false"
add_env_var "ENABLE_REAL_TRANSACTIONS" "Enable real transactions" "true" "false"

# Debug settings
echo -e "\nSetting up debug settings..."
add_env_var "DEBUG_MODE" "Enable debug mode" "false" "false"
add_env_var "NODE_ENV" "Node environment" "development" "false"

echo -e "\nEnvironment setup complete. Variables written to: $ENV_FILE"
echo "IMPORTANT: Make sure to keep this file secure and do not commit it to version control."

# Set permissions to restrict access
chmod 600 "$ENV_FILE"
echo "Permissions set to restrict access to the environment file." 