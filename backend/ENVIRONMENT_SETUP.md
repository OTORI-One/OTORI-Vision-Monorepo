# Environment Setup for OTORI Vision Backend

## Setting Up Environment Files

The OTORI Vision backend requires environment variables to configure various aspects of the system. These are stored in `.env.*` files, which contain sensitive information and should **never** be committed to the repository.

### Available Environment Files

- `.env.development` - Used for local development
- `.env.production` - Used for production deployment
- `.env.test` - Used for running tests

### Setup Instructions

1. Copy the example file to create your local environment file:
   ```bash
   cp .env.development.example .env.development
   ```

2. Edit the file to add your credentials:
   ```bash
   nano .env.development
   ```

3. Securely store your passwords or API keys in a password manager or secure vault, not in plain text files.

### Security Guidelines

- **NEVER commit `.env.*` files to the repository**
- **NEVER include real passwords in example files**
- Use environment-specific configuration for different deployment environments
- Consider using a secure vault (like HashiCorp Vault or AWS Secrets Manager) for production credentials
- Rotate credentials regularly

## SSH Authentication

For connecting to remote services like OrdPi:

1. Use SSH key-based authentication instead of passwords when possible
2. If passwords must be used, store them in a secure manner (not in environment files)
3. Consider using SSH config files for connection information

## Remote API Settings

The OTORI Vision backend connects to the OrdPi for Runes API functionality. Configure this in your `.env.development` file:

```
REMOTE_RUNES_API=http://your-ordpi-ip:9191
```

For secure connections, consider setting up an SSH tunnel:

```bash
ssh -L 9191:localhost:9191 username@your-ordpi-ip
```

Then set `REMOTE_RUNES_API=http://localhost:9191` in your environment file. 