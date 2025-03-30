# OTORI Vision Integration Services

This document outlines the integration services implemented to ensure seamless compatibility between various components of the OTORI Vision platform, particularly focusing on the trading service integration with the LP distribution and PSBT management scripts.

## 1. Configuration Service

The Configuration Service (`configService.js`) centralizes all configuration parameters used across the platform to ensure consistency and avoid duplication. This service:

- Loads configuration from environment variables and environment-specific config files
- Validates critical configuration parameters
- Provides a unified configuration interface for all services
- Creates necessary directories for data storage
- Supports configuration updates at runtime

### Key Features

- **Environment-Based Configuration**: Loads different configurations based on the current environment (development, production, etc.)
- **Deep Configuration Merging**: Intelligently merges configuration objects
- **Parameter Validation**: Validates critical parameters to catch configuration errors early
- **Centralized Default Values**: Provides sensible defaults for all configuration options

## 2. Command Execution Service

The Command Execution Service (`commandExecutionService.js`) standardizes command execution across different services and scripts. This service:

- Provides unified interfaces for local and remote command execution
- Implements robust error handling and retries with exponential backoff
- Masks sensitive information in logs
- Standardizes Bitcoin CLI command execution

### Key Features

- **Retry Logic**: Automatically retries failed commands with exponential backoff
- **SSH Support**: Executes commands on remote servers securely
- **Stream Handling**: Supports streaming output for long-running commands
- **Bitcoin CLI Wrapper**: Specialized methods for interacting with Bitcoin Core
- **Security**: Redacts sensitive information from logs

## 3. Transaction Format Service

The Transaction Format Service (`transactionFormatService.js`) ensures PSBT format compatibility between different components. This service:

- Standardizes transaction metadata across all services
- Provides utilities for saving and loading transaction data
- Converts between different transaction formats
- Analyzes PSBTs to extract key information

### Key Features

- **Standardized Metadata**: Creates consistent transaction metadata
- **Format Conversion**: Converts between internal, Runes API, and Bitcoin CLI formats
- **Transaction Storage**: Saves transactions to files with metadata
- **PSBT Analysis**: Extracts details from PSBT strings

## Integration with Existing Services

The integration services have been integrated with the following existing services:

### UTXO Service

The UTXO Service now uses the Configuration Service for parameters and the Command Execution Service for Bitcoin CLI interactions. This ensures:

- Consistent configuration across components
- Standardized error handling
- Improved Bitcoin CLI command execution

### Transaction Validation Service

The Transaction Validation Service now uses the Configuration Service for validation parameters and the Command Execution Service for Bitcoin CLI operations. This ensures:

- Consistent validation thresholds
- Standardized Bitcoin interaction
- Improved circuit breaker functionality

### Admin Service

The Admin Service now uses all three integration services to:

- Maintain consistent configuration for multi-signature requirements
- Standardize transaction format for admin operations
- Improve command execution for Bitcoin operations

## Usage Example

Here's an example of how these services work together:

1. The Trading Service needs to create a transaction
2. It gets configuration values from the Configuration Service
3. It uses the UTXO Service (which now uses Command Execution Service) to select UTXOs
4. It creates a transaction and standardizes it with Transaction Format Service
5. It validates the transaction using Transaction Validation Service
6. If the transaction involves Treasury addresses, it uses Admin Service for multi-signature approval

## Future Improvements

- Add support for more transaction formats
- Enhance remote command execution with more security features
- Implement more sophisticated configuration validation
- Develop a caching layer for frequently used configuration values

## Conclusion

These integration services provide a solid foundation for seamless interaction between different components of the OTORI Vision platform. By centralizing configuration, standardizing command execution, and ensuring transaction format compatibility, they enhance the overall reliability and maintainability of the system. 