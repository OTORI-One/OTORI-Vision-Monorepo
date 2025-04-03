#!/bin/bash

# Script to test Rune transfers

# Set base directory to the directory containing this script
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$BASE_DIR")"
TEST_FILE="$API_DIR/tests/rune-transfer-test.js"

# Load environment variables from .env if it exists
ENV_FILE="$API_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "Loading environment variables from $ENV_FILE"
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

# Check if the test file exists
if [[ ! -f "$TEST_FILE" ]]; then
  echo "Test file not found: $TEST_FILE"
  exit 1
fi

# Print header
echo "===================================================="
echo "  OTORI Vision - Rune Transfer Tests"
echo "===================================================="
echo "Test file: $TEST_FILE"
echo "Environment: ${NODE_ENV:-development}"
echo ""

# Check if the Bitcoin node is accessible
echo "Checking Bitcoin node connectivity..."
if command -v bitcoin-cli &> /dev/null; then
  BITCOIN_INFO=$(bitcoin-cli --signet getnetworkinfo 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    echo "Bitcoin node is accessible"
  else
    echo "Warning: Bitcoin node is not accessible"
  fi
else
  echo "Warning: bitcoin-cli command not found"
fi

# Check if ord is installed
echo "Checking ord CLI availability..."
if command -v ord &> /dev/null; then
  ORD_VERSION=$(ord --version 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    echo "ord CLI is available: $ORD_VERSION"
  else
    echo "Warning: ord CLI is installed but not functioning correctly"
  fi
else
  echo "Warning: ord CLI command not found"
fi

# Check LP wallet balance
echo "Checking LP wallet balance..."
if [[ -n "$BITCOIN_WALLET" ]]; then
  WALLET_BALANCE=$(bitcoin-cli --signet -rpcwallet=$BITCOIN_WALLET getbalance 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    echo "LP wallet balance: $WALLET_BALANCE BTC"
  else
    echo "Warning: Could not check LP wallet balance"
  fi
else
  echo "Warning: BITCOIN_WALLET environment variable not set"
fi

# Set test mode to prevent accidental transfers
export TEST_MODE=true

echo ""
echo "Running tests..."
echo "===================================================="

# Run the test script
node "$TEST_FILE"
TEST_EXIT_CODE=$?

echo "===================================================="
if [[ $TEST_EXIT_CODE -eq 0 ]]; then
  echo "Tests completed successfully"
else
  echo "Tests failed with exit code $TEST_EXIT_CODE"
fi

echo ""
echo "Test execution completed at $(date)" 