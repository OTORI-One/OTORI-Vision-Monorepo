#!/bin/bash

# Script to check available ord commands and their expected formats
# This is more comprehensive than test-ord-commands.sh and focuses on discovering available commands

# Set color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
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
    echo "$RESULT"
    return 0
  else
    echo -e "${RED}Command failed with exit code $EXIT_CODE${NC}"
    echo "$RESULT"
    return 1
  fi
}

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  ORD COMMAND CHECKER FOR OTORI VISION      ${NC}"
echo -e "${BLUE}=============================================${NC}"
echo

# 1. Get ord version
echo -e "${BLUE}1. ORD VERSION${NC}"
ssh_execute "ord --version"
echo

# 2. List all commands
echo -e "${BLUE}2. AVAILABLE COMMANDS${NC}"
ssh_execute "ord --help"
echo

# 3. Check wallet commands
echo -e "${BLUE}3. WALLET COMMANDS${NC}"
ssh_execute "ord wallet --help"
echo

# 4. Check wallet send commands
echo -e "${BLUE}4. WALLET SEND COMMANDS${NC}"
ssh_execute "ord wallet send --help"
echo

# 5. Check rune commands
echo -e "${BLUE}5. RUNE COMMANDS${NC}"
ssh_execute "ord rune --help"
echo

# 6. Check runics commands
echo -e "${BLUE}6. RUNICS COMMANDS (if available)${NC}"
ssh_execute "ord runics --help" || echo -e "${YELLOW}Runics is not a top-level command, might be a subcommand${NC}"
echo

# 7. Check wallet runics commands
echo -e "${BLUE}7. WALLET RUNICS COMMANDS${NC}"
ssh_execute "ord wallet runics --help" || echo -e "${YELLOW}Wallet runics command might not exist or has another name${NC}"
echo

# 8. Check wallet balances
echo -e "${BLUE}8. WALLET BALANCES${NC}"
ssh_execute "ord --signet wallet balance" || echo -e "${YELLOW}Balance command might need different arguments${NC}"
echo

# 9. List all wallet subcommands to discover actual command names
echo -e "${BLUE}9. ALL WALLET SUBCOMMANDS${NC}"
ssh_execute "ord wallet" || echo -e "${YELLOW}Cannot list all wallet subcommands directly${NC}"
echo

# 10. Try alternative commands for runes/runics
echo -e "${BLUE}10. TRYING ALTERNATIVE RUNE COMMANDS${NC}"
echo -e "${YELLOW}Checking 'ord wallet runes'${NC}"
ssh_execute "ord --signet wallet runes" || echo -e "${YELLOW}Command not found${NC}"
echo

echo -e "${YELLOW}Checking 'ord wallet runic'${NC}"
ssh_execute "ord --signet wallet runic" || echo -e "${YELLOW}Command not found${NC}"
echo

echo -e "${YELLOW}Checking 'ord wallet runics'${NC}"
ssh_execute "ord --signet wallet runics" || echo -e "${YELLOW}Command not found${NC}"
echo

echo -e "${YELLOW}Checking 'ord runes'${NC}"
ssh_execute "ord --signet runes" || echo -e "${YELLOW}Command not found${NC}"
echo

# Summary
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  COMMAND DISCOVERY SUMMARY                 ${NC}"
echo -e "${BLUE}=============================================${NC}"
echo "Based on the output above, update the tradingService.js file to use the correct ord commands."
echo "Look for commands related to rune/runics listings and transfers."
echo "If none were found, consider checking the ord documentation or reaching out to the ord developers." 