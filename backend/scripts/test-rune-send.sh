#!/bin/bash

# Script to test different formats of the ord rune send command
# Based on documentation at https://docs.ordinals.com/guides/wallet.html#sending-runes

# Set color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Load environment variables from ecosystem.config.js
eval $(node -e "const config = require('../ecosystem.config.js').apps[0].env; Object.keys(config).forEach(key => console.log(\`export \${key}=\\\"\${config[key]}\\\"\`));")

# Test recipient address
TEST_RECIPIENT="tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
TEST_AMOUNT=10
FORMATTED_AMOUNT=$((TEST_AMOUNT * 100))  # For 2 decimal places

# SSH command function with password redaction
ssh_execute() {
  local CMD="$1"
  echo -e "${YELLOW}Executing: sshpass -p \"[REDACTED]\" ssh -o StrictHostKeyChecking=no -p $ORDPI_SSH_PORT $ORDPI_SSH_USER@$ORDPI_SSH_HOST \"$CMD\"${NC}"
  
  # Execute the command securely
  RESULT=$(sshpass -p "$ORDPI_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no -p $ORDPI_SSH_PORT $ORDPI_SSH_USER@$ORDPI_SSH_HOST "$CMD" 2>&1)
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}Command succeeded with exit code $EXIT_CODE${NC}"
    echo "$RESULT"
    return 0
  else
    echo -e "${RED}Command failed with exit code $EXIT_CODE${NC}"
    echo "$RESULT"
    return 1
  fi
}

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  RUNE SEND COMMAND TESTER                  ${NC}"
echo -e "${BLUE}=============================================${NC}"
echo

# Print info about what we're testing
echo -e "${YELLOW}Testing with:${NC}"
echo "Recipient: $TEST_RECIPIENT"
echo "Amount: $TEST_AMOUNT (formatted: $FORMATTED_AMOUNT)"
echo "Rune name: $OVT_RUNE_NAME"
echo

# 1. First check if we can get help for the wallet send command
echo -e "${BLUE}1. TESTING WALLET SEND HELP${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet send --help"
echo

# 2. Check the balance - what runes do we have to send?
echo -e "${BLUE}2. CHECKING WALLET BALANCE${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet balance"
echo

# 3. Try Format 1 - Using "RUNE_AMOUNT:RUNE_NAME" syntax (quoted)
RUNE_AMT_1="$FORMATTED_AMOUNT:$OVT_RUNE_NAME"
echo -e "${BLUE}3. TESTING FORMAT 1 - AMOUNT:NAME (DRY RUN)${NC}"
echo "Command would be: ord --config /home/BTCPi/.ord/ord.yaml --signet wallet send --fee-rate 1 $TEST_RECIPIENT \"$RUNE_AMT_1\""
echo -e "${YELLOW}Not executing to avoid real transaction${NC}"
echo

# 4. Try Format 2 - Using "RUNE_AMOUNT:RUNE_ID" syntax (OVT_RUNE_ID)
RUNE_AMT_2="$FORMATTED_AMOUNT:$OVT_RUNE_ID"
echo -e "${BLUE}4. TESTING FORMAT 2 - AMOUNT:ID (DRY RUN)${NC}"
echo "Command would be: ord --config /home/BTCPi/.ord/ord.yaml --signet wallet send --fee-rate 1 $TEST_RECIPIENT \"$RUNE_AMT_2\""
echo -e "${YELLOW}Not executing to avoid real transaction${NC}"
echo

# 5. Try using the exact format from the documentation
echo -e "${BLUE}5. USING DOCUMENTATION FORMAT (DRY RUN)${NC}"
echo "Command would be: ord --config /home/BTCPi/.ord/ord.yaml --signet wallet send --fee-rate 1 $TEST_RECIPIENT \"$FORMATTED_AMOUNT:EXAMPLE\""
echo -e "${YELLOW}Not executing to avoid real transaction${NC}"
echo

# 6. List available runes in the wallet 
echo -e "${BLUE}6. LISTING AVAILABLE RUNES${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet runes" || echo -e "${YELLOW}Command not found, try alternative commands${NC}"
echo

# 7. Try alternative rune listing commands
echo -e "${BLUE}7. TRYING ALTERNATIVE COMMANDS${NC}"
echo -e "${YELLOW}Trying 'wallet runics'${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet wallet runics" || echo -e "${YELLOW}Command not found${NC}"
echo

echo -e "${YELLOW}Trying 'rune list'${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet rune list" || echo -e "${YELLOW}Command not found${NC}"
echo

echo -e "${YELLOW}Trying 'runes'${NC}"
ssh_execute "ord --config /home/BTCPi/.ord/ord.yaml --signet runes" || echo -e "${YELLOW}Command not found${NC}"
echo

# Summary
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  COMMAND FORMATS SUMMARY                   ${NC}"
echo -e "${BLUE}=============================================${NC}"
echo "Based on the documentation and tests above:"
echo "1. Format: ord wallet send --fee-rate <FEE_RATE> <ADDRESS> <AMOUNT>:<RUNE_NAME>"
echo "2. Escape special characters in rune name"
echo "3. Wrap the amount:name part in quotes if it contains special characters"
echo 
echo "For OTORI•VISION•TOKEN, try: ord wallet send --fee-rate 1 <ADDRESS> \"<AMOUNT>:OTORI•VISION•TOKEN\""
echo "Or try with ID instead: ord wallet send --fee-rate 1 <ADDRESS> \"<AMOUNT>:240249\"" 