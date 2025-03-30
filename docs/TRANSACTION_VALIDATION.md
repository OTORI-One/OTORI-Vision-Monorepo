# OTORI Vision Transaction Validation System

## Overview

The Transaction Validation System provides comprehensive validation for Bitcoin transactions in the OTORI Vision platform. It ensures that all transactions are valid, secure, and compliant with Bitcoin network rules before execution.

## Key Features

- **Input Validation**: Verifies UTXO existence and spendability
- **Output Validation**: Validates output addresses, amounts, and prevents dust outputs
- **Signature Verification**: Ensures transaction signatures are valid and complete
- **Fee Validation**: Checks that fees are reasonable and within acceptable limits
- **Audit Trail**: Maintains detailed logs of all validation attempts and results
- **Circuit Breaker**: Protects the system during Bitcoin node outages
- **Validation Statistics**: Tracks success/failure rates and other metrics

## API Endpoints

The Transaction Validation Service exposes the following REST API endpoints:

### Comprehensive Validation

```
POST /api/validation/validate
```

Validates a complete Bitcoin transaction, including inputs, outputs, and signatures.

**Request Body**:
```json
{
  "transaction": {
    "inputs": [
      {
        "txid": "hex_transaction_id",
        "vout": 0
      }
    ],
    "outputs": [
      {
        "address": "bitcoin_address",
        "value": 50000 // in satoshis
      }
    ],
    "psbt": "base64_encoded_psbt"
  }
}
```

**Response**:
```json
{
  "success": true,
  "validationResult": {
    "valid": true,
    "inputValidation": { /* input validation details */ },
    "outputValidation": { /* output validation details */ },
    "signatureValidation": { /* signature validation details */ },
    "fee": 5000, // in satoshis
    "isComplete": true
  },
  "timestamp": 1682345678901
}
```

### Component Validation

For more granular validation, the following endpoints are available:

#### Validate Inputs

```
POST /api/validation/validate-inputs
```

Validates transaction inputs only, checking UTXO existence and spendability.

#### Validate Outputs

```
POST /api/validation/validate-outputs
```

Validates transaction outputs only, checking addresses, amounts, and fees.

#### Validate Signature

```
POST /api/validation/validate-signature
```

Validates transaction signatures only, checking completeness and correctness.

### Statistics and Reporting

#### Get Validation Statistics

```
GET /api/validation/stats
```

Returns current validation statistics, including success rates and circuit breaker status.

**Response**:
```json
{
  "success": true,
  "stats": {
    "totalValidated": 120,
    "inputValidationFailures": 5,
    "outputValidationFailures": 3,
    "signatureValidationFailures": 2,
    "successRate": 91.67,
    "lastReset": 1682340000000,
    "circuitBreaker": {
      "state": "closed",
      "failures": 0,
      "lastFailure": null,
      "lastSuccess": 1682345678901
    },
    "configuredThresholds": {
      "confirmationThreshold": 1,
      "dustLimit": 546,
      "circuitBreakerThreshold": 5
    }
  },
  "timestamp": 1682345678901
}
```

Optional query parameter `reset=true` will reset statistics after retrieval.

#### Get Validation Report

```
GET /api/validation/report?period=day
```

Returns a detailed validation report for the specified period (day, week, or month).

**Response**:
```json
{
  "success": true,
  "report": {
    "period": "day",
    "startDate": "2023-04-24T00:00:00.000Z",
    "endDate": "2023-04-24T23:59:59.999Z",
    "validationCount": 120,
    "successCount": 110,
    "failureCount": 10,
    "successRate": 91.67,
    "failuresByType": {
      "input": 5,
      "output": 3,
      "signature": 2,
      "other": 0
    },
    "dailyStats": [
      {
        "date": "2023-04-24",
        "validationCount": 120,
        "successCount": 110,
        "failureCount": 10
      }
    ]
  },
  "timestamp": 1682345678901
}
```

## Integration with Trading Service

The Transaction Validation System is integrated with the Trading Service to validate all transactions before execution:

1. Trading Service creates a transaction (buy/sell order)
2. Transaction is validated through the validation service
3. If validation succeeds, the transaction is executed
4. If validation fails, the transaction is rejected with appropriate error messages
5. All validation results are logged for audit purposes

## Configuration

The validation service can be configured through environment variables:

- `CONFIRMATION_THRESHOLD`: Minimum confirmations required for UTXOs (default: 1)
- `BITCOIN_NETWORK`: Bitcoin network to use (testnet, regtest, mainnet) (default: testnet)
- `AUDIT_TRAIL_ENABLED`: Enable/disable audit trail logging (default: true)
- `CIRCUIT_BREAKER_THRESHOLD`: Number of failures before circuit breaker opens (default: 5)
- `CIRCUIT_BREAKER_RESET`: Time in ms before circuit breaker resets (default: 300000)
- `MAX_TX_INPUTS`: Maximum number of inputs allowed in a transaction (default: 100)
- `MAX_TX_OUTPUTS`: Maximum number of outputs allowed in a transaction (default: 100)
- `LOG_VERBOSITY`: Logging verbosity level (error, warn, info, debug, trace) (default: info)

## Logging and Audit Trail

The validation service maintains detailed logs of all validation attempts and results. These logs are stored in the `data/logs` directory with one log file per day, following the naming pattern `validation-YYYY-MM-DD.log`.

Each log entry contains:
- Timestamp
- Event type (validationStart, validationSuccess, validationFailure)
- Transaction ID
- Validation details
- Error information (if applicable)

## Error Handling

The validation service implements robust error handling with detailed error messages. Common error scenarios include:

- **UTXO Validation Errors**: UTXO doesn't exist, is already spent, or has insufficient confirmations
- **Address Validation Errors**: Invalid Bitcoin address format
- **Amount Validation Errors**: Dust outputs, insufficient funds, excessive fees
- **Signature Validation Errors**: Missing or invalid signatures
- **Bitcoin Node Errors**: Node unavailable, RPC errors

## Circuit Breaker Pattern

The validation service implements a circuit breaker pattern to handle Bitcoin node outages gracefully:

1. **Closed State**: Normal operation, all requests are processed
2. **Open State**: After consecutive failures, requests are rejected immediately
3. **Half-Open State**: After a timeout, a test request is allowed to check if the node is back online

This prevents cascading failures and provides a graceful degradation of service during outages.

## Development Guidelines

When working with the Transaction Validation System:

1. Always validate transactions before execution
2. Handle validation errors gracefully and provide clear error messages to users
3. Monitor validation statistics for potential security issues
4. Do not bypass validation for any transaction type
5. Keep Bitcoin node and validation service dependencies up-to-date

## Testing

The Transaction Validation System includes comprehensive unit tests to ensure reliability. Run tests with:

```bash
npm run test:validation
```

These tests cover all validation scenarios, including edge cases and error conditions. 