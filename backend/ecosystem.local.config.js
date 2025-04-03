module.exports = {
  apps: [
    {
      name: 'otori-api',
      script: './api/index.js',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 3030,
        ORDPI_SSH_PASSWORD: 'Bitcoin is Life',
        ORDPI_SSH_HOST: '91.7.62.224',
        ORDPI_SSH_PORT: '2211',
        ORDPI_SSH_USER: 'BTCPi',
        LP_ADDRESS: 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
        BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        BITCOIN_WALLET: 'ovt-LP-wallet', //comment out to use default wallet
        BITCOIN_NETWORK: 'signet',
        BITCOIN_RPC_HOST: '91.7.62.224', // Use IP of the remote Bitcoin node
        BITCOIN_RPC_PORT: '38332', // Signet RPC port
        BITCOIN_RPC_USER: 'bitcoin', // RPC username
        BITCOIN_RPC_PASSWORD: 'jSiQZPaAVSVg8UDlb05XYftmlATWvG++', // RPC password
        REMOTE_BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        USE_REMOTE_BITCOIN_CLI: 'true',
        ENABLE_EXTERNAL_WALLETS: 'true',
        OVT_RUNE_ID: '240249:101',
        OVT_RUNE_NAME: 'OTORI•VISION•TOKEN', // Actual human-readable Rune name
        OVT_TREASURY_ADDRESS: 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
        ORD_PATH: '/usr/local/bin/ord',
        ORD_DATADIR: '/home/BTCPi/.local/share/ord',
        ENABLE_RATE_LIMITING: 'true',
        MAX_REQUESTS_PER_MINUTE: '60',
        DEBUG_MODE: 'false',
        REMOTE_RUNES_API: 'http://192.168.178.54:9191',
        //        REMOTE_RUNES_API: 'http://localhost:9001', //for remote development via ssh tunnel
        ENABLE_REAL_TRANSACTIONS: 'true',
        NEXT_PUBLIC_OVT_RUNE_ID: '240249:101',
        API_BASE_URL: 'http://localhost:3030'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3030,
        ORDPI_SSH_PASSWORD: 'Bitcoin is Life',
        ORDPI_SSH_HOST: '91.7.62.224',
        ORDPI_SSH_PORT: '2211',
        ORDPI_SSH_USER: 'BTCPi',
        LP_ADDRESS: 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
        BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        BITCOIN_WALLET: 'ovt-LP-wallet', //comment to use default wallet
        BITCOIN_NETWORK: 'signet',
        BITCOIN_RPC_HOST: '91.7.62.224', // Use IP of the remote Bitcoin node
        BITCOIN_RPC_PORT: '38332', // Signet RPC port
        BITCOIN_RPC_USER: 'bitcoin', // RPC username
        BITCOIN_RPC_PASSWORD: 'jSiQZPaAVSVg8UDlb05XYftmlATWvG++', // RPC password
        REMOTE_BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        USE_REMOTE_BITCOIN_CLI: 'true',
        ENABLE_EXTERNAL_WALLETS: 'true',
        OVT_RUNE_ID: '240249:101',
        OVT_RUNE_NAME: 'OTORI•VISION•TOKEN', // Actual human-readable Rune name
        OVT_TREASURY_ADDRESS: 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
        ORD_PATH: '/usr/local/bin/ord',
        ORD_DATADIR: '/home/BTCPi/.local/share/ord',
        ENABLE_RATE_LIMITING: 'true',
        MAX_REQUESTS_PER_MINUTE: '60',
        DEBUG_MODE: 'false',
        REMOTE_RUNES_API: 'http://192.168.178.54:9191',
        //        REMOTE_RUNES_API: 'http://localhost:9191', //for remote development via ssh tunnel  
        ENABLE_REAL_TRANSACTIONS: 'true',
        NEXT_PUBLIC_OVT_RUNE_ID: '240249:101',
        API_BASE_URL: 'http://localhost:3030'
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      time: true
    }
  ]
}; 