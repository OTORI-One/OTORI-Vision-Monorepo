#!/bin/bash

# Test script for ord commands
# This script tests the ord commands used in the application

# Set color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Load environment variables from ecosystem.config.js
eval $(node -e "const config = require('../ecosystem.config.js').apps[0].env; Object.keys(config).forEach(key => console.log(\`export \${key}=\\\"\${config[key]}\\\"\`));")

# SSH command function with password redaction
ssh_execute() {
  local CMD="$1"
  echo -e "${YELLOW}Executing: sshpass -p \"[REDACTED]\" ssh -o StrictHostKeyChecking=no -p $ORDPI_SSH_PORT $ORDPI_SSH_USER@$ORDPI_SSH_HOST \"$CMD\"${NC}"
  
  # Execute the command securely
  RESULT=$(sshpass -p "$ORDPI_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no -p $ORDPI_SSH_PORT $ORDPI_SSH_USER@$ORDPI_SSH_HOST "$CMD" 2>&1)
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}Command succeeded with exit code $EXIT_CODE${NC}"
    echo "Result:"
    echo "$RESULT"
    return 0
  else
    echo -e "${RED}Command failed with exit code $EXIT_CODE${NC}"
    echo "Error output:"
    echo "$RESULT"
    return 1
  fi
}

# Print configuration (without passwords)
echo -e "${YELLOW}Testing with configuration:${NC}"
echo "OVT_RUNE_ID: $OVT_RUNE_ID"
echo "OVT_RUNE_NAME: $OVT_RUNE_NAME"
echo "LP_ADDRESS: $LP_ADDRESS"
echo "SSH Server: $ORDPI_SSH_USER@$ORDPI_SSH_HOST:$ORDPI_SSH_PORT"
echo

# Test 1: Basic ord connection and version
echo -e "${YELLOW}Test 1: Checking ord version${NC}"
ssh_execute "ord --version"
echo

# Test 2: Check wallet runics command
echo -e "${YELLOW}Test 2: Checking wallet runics command${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet runics"
echo

# Test 3: Check basic wallet status
echo -e "${YELLOW}Test 3: Checking wallet status${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet status"
echo

# Test 4: Help output for the send command
echo -e "${YELLOW}Test 4: Checking send command help${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet send --help"
echo

# Simulate a rune transfer command (dry-run)
RECIPIENT="tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
AMOUNT=1
DECIMAL_PLACES=2
AMOUNT_SCALED=$((AMOUNT * 10**DECIMAL_PLACES))

echo -e "${YELLOW}The following command would be used for transfers (not executing):${NC}"
echo "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet send --fee-rate 1 $RECIPIENT \"$OVT_RUNE_NAME\" $AMOUNT_SCALED"
echo

# Final summary
echo -e "${GREEN}Test complete!${NC}"
echo "Verify the commands above and confirm they match the expected ord command format."
echo "If successful, update the application code to use these commands."
echo "If errors occurred, check the error messages and update the commands accordingly." 