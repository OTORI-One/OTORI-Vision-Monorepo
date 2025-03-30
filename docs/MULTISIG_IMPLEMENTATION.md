# OTORI Vision Multi-Signature Implementation

## Overview

The OTORI Vision platform implements a robust multi-signature approval system for administrative operations, particularly for transactions originating from treasury addresses. This security measure ensures that critical operations require approval from multiple administrators, reducing the risk of unauthorized access or malicious actions.

## Key Features

- **3-of-5 Multi-Signature Requirement**: Treasury transactions require signatures from at least 3 out of 5 possible administrators.
- **Transparent Action Tracking**: All administrative actions are tracked, stored, and can be audited.
- **Secure Signature Verification**: Signatures are cryptographically verified to ensure authenticity.
- **Flexible Action Types**: Supports multiple types of administrative actions, including treasury transfers and token minting.
- **Integration with Existing Components**: Seamlessly integrates with the frontend MultiSigApproval component and backend validation services.

## Architecture

The multi-signature implementation consists of the following components:

### 1. Backend Components

- **adminService.js**: The core service that implements the multi-signature functionality.
- **adminRoutes.js**: API endpoints for creating, signing, and executing administrative actions.
- **Integration with tradingService.js**: Ensures that treasury transactions require multi-signature approval.

### 2. Frontend Components

- **MultiSigApproval.tsx**: A React component that handles the UI for collecting signatures from administrators.
- **Integration with admin dashboard**: Components that initiate actions requiring multi-signature approval.

## Workflow

The multi-signature workflow follows these steps:

1. **Action Creation**: An administrator initiates an action (e.g., treasury transfer, token minting).
2. **Signature Collection**: The frontend presents the action details to administrators, who can sign the action using their wallets.
3. **Threshold Verification**: The system verifies that at least 3 out of 5 administrators have signed the action.
4. **Action Execution**: Once the threshold is met, the action can be executed.

## Security Benefits

The multi-signature implementation provides several security benefits:

1. **Protection Against Single Points of Failure**: No single administrator can execute critical operations, reducing the risk of unauthorized access.
2. **Defense in Depth**: Even if one administrator's credentials are compromised, the attacker cannot execute treasury transactions without additional signatures.
3. **Transparent Decision Making**: All actions are recorded and can be audited, ensuring transparency in administrative operations.
4. **Configurable Security Level**: The threshold (currently 3-of-5) can be adjusted based on security requirements.

## API Reference

### Backend API Endpoints

#### Admin Actions

```
GET /api/admin/actions
```
Retrieves all pending administrative actions.

Query parameters:
- `status`: Filter by action status (pending, approved, executed)
- `type`: Filter by action type (TREASURY_TRANSFER, MINT_RUNE, etc.)

```
GET /api/admin/actions/:id
```
Retrieves a specific administrative action by ID.

```
POST /api/admin/actions
```
Creates a new administrative action.

Request body:
```json
{
  "actionType": "TREASURY_TRANSFER",
  "description": "Transfer from treasury to recipient",
  "data": {
    "recipient": "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    "amount": 10000
  }
}
```

```
POST /api/admin/actions/:id/sign
```
Adds a signature to an administrative action.

Request body:
```json
{
  "signature": "signatureHex",
  "publicKey": "publicKeyHex"
}
```

```
POST /api/admin/actions/:id/execute
```
Executes an approved administrative action.

#### Convenience Endpoints

```
POST /api/admin/treasury-transfer
```
Creates and optionally signs a treasury transfer action.

Request body:
```json
{
  "recipient": "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  "amount": 10000,
  "description": "Transfer for project funding",
  "signature": "signatureHex",  // Optional
  "publicKey": "publicKeyHex"   // Optional
}
```

```
POST /api/admin/mint-rune
```
Creates and optionally signs a rune minting action.

Request body:
```json
{
  "amount": 50000,
  "signature": "signatureHex",  // Optional
  "publicKey": "publicKeyHex"   // Optional
}
```

### Frontend Components

#### MultiSigApproval Component

```tsx
<MultiSigApproval
  isOpen={isOpen}
  onClose={handleClose}
  onComplete={handleComplete}
  action={{
    type: "TREASURY_TRANSFER",
    description: "Transfer to example address",
    data: {
      recipient: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      amount: 10000
    }
  }}
/>
```

## Implementation Examples

### Creating a Treasury Transfer Action

```javascript
// Backend example (Node.js)
const adminService = require('./adminService');

const action = adminService.createAdminAction(
  'TREASURY_TRANSFER',
  'Transfer funds to project wallet',
  {
    recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    amount: 10000
  }
);

console.log(`Created action with ID: ${action.id}`);
```

```typescript
// Frontend example (React)
import { useState } from 'react';
import { MultiSigApproval } from './components';

function AdminDashboard() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const handleTransfer = () => {
    const action = {
      type: 'TREASURY_TRANSFER',
      description: 'Transfer funds to project wallet',
      data: {
        recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        amount: 10000
      },
      execute: async (signatures) => {
        // Call the API to execute the action with collected signatures
        const response = await fetch('/api/admin/actions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionId: action.id,
            signatures
          })
        });
        
        return response.json();
      }
    };
    
    setPendingAction(action);
    setIsModalOpen(true);
  };

  const handleComplete = async (signatures) => {
    try {
      await pendingAction.execute(signatures);
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error executing action:', error);
    }
  };

  return (
    <div>
      <button onClick={handleTransfer}>Transfer from Treasury</button>
      
      <MultiSigApproval
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onComplete={handleComplete}
        action={pendingAction}
      />
    </div>
  );
}
```

## Configuration

The multi-signature implementation can be configured through environment variables:

- `REQUIRED_SIGNATURES`: Number of signatures required for approval (default: 3)
- `MAX_ADMINS`: Maximum number of administrators (default: 5)
- `NEXT_PUBLIC_TREASURY_ADDRESS`: Primary treasury address
- `NEXT_PUBLIC_TREASURY_ADDRESS_2`: Secondary treasury address (optional)

## Security Considerations

1. **Key Management**: Administrator keys must be securely stored and managed.
2. **Frontend Security**: The frontend must securely transmit signatures to the backend.
3. **Network Security**: All API endpoints should be properly secured with appropriate authentication and authorization.
4. **Transaction Validation**: All transactions must be properly validated before execution.
5. **Error Handling**: Proper error handling ensures that failed operations do not lead to security vulnerabilities.

## Testing

The multi-signature implementation includes comprehensive tests:

- **Unit Tests**: Test individual components such as action creation, signature verification, and threshold checking.
- **Integration Tests**: Test the interaction between components, ensuring that the entire workflow functions correctly.
- **Security Tests**: Test security measures such as signature verification and threshold requirements.

## Troubleshooting

### Common Issues

1. **Insufficient Signatures**: Actions cannot be executed with fewer than the required number of signatures (default: 3).
2. **Invalid Signatures**: Signatures must be properly formatted and cryptographically valid.
3. **Unknown Action Types**: Only supported action types (TREASURY_TRANSFER, MINT_RUNE, LP_REBALANCE) can be executed.
4. **Duplicate Signatures**: Each administrator can only sign an action once.

### Debugging

- Check the action status using the `/api/admin/actions/:id` endpoint.
- Verify that all signatures are valid and from different administrators.
- Ensure that the action type is supported and properly formatted.
- Check server logs for detailed error messages.

## Conclusion

The multi-signature implementation in OTORI Vision provides a robust security mechanism for administrative operations, particularly for treasury transactions. By requiring multiple signatures for critical operations, the system significantly reduces the risk of unauthorized access and provides transparent, auditable administrative actions. 