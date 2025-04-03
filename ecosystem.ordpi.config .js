module.exports = {
  apps: [
    {
      name: 'otori-trading-api',
      script: './api/index.js',
      cwd: '/home/BTCPi/OTORI-Vision/backend', // IMPORTANT: Set correct path
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3032, // Assigned port
        SERVICE_TYPE: 'trading', // Optional flag
        // Define URLs needed by Trading service (likely local on OrdPi)
        PRICE_API_URL: 'http://localhost:3033/api/price',
        VALIDATION_API_URL: 'http://localhost:3034/api/validation',
        RUNES_API_URL: 'http://localhost:9192', 
        // Inherit common vars from .env.ordpi or redefine here
        BITCOIN_NETWORK: 'signet',
        BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        // BITCOIN_WALLET: 'ovt-LP-wallet', //comment out to use default wallet
        // ... other vars needed by Trading API from .env.ordpi
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '250M',
      time: true
    },
    {
      name: 'otori-runes-api',
      script: './api/runes_API.js', // Specific script for Runes Facade
      cwd: '/home/BTCPi/OTORI-Vision/backend', // IMPORTANT: Set correct path
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 9192, // Assign a unique port for this facade service
        ORD_SERVER_URL: 'http://localhost:9191',  // Provide the URL for the underlying ord server (running via systemd)
        // Inherit common vars from .env.ordpi or redefine here
        BITCOIN_NETWORK: 'signet',
        BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        ORD_PATH: '/usr/local/bin/ord', // Make sure ORD_PATH is defined if execOrdCommand needs it
        ORD_CONFIG_PATH: '/home/BTCPi/.ord/ord.yaml', // Make sure ORD_CONFIG_PATH is defined
        NEXT_PUBLIC_OVT_RUNE_ID: '240249:101', // Renamed from OVT_RUNE_ID for consistency
        NEXT_PUBLIC_OVT_RUNE_SYMBOL: 'OTORI•VISION•TOKEN',
        NEXT_PUBLIC_OVT_RUNE_NAME: 'OTORI•VISION•TOKEN',
        NEXT_PUBLIC_OVT_RUNE_TICKER: 'OVT',
        NEXT_PUBLIC_LP_ADDRESS: 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f', // Renamed for consistency
        NEXT_PUBLIC_TREASURY_ADDRESS: 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd', // Added for consistency
        NEXT_PUBLIC_TREASURY_ADDRESS_2: 'tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3', // Added for consistency
        // ... other vars needed by Runes API from .env.ordpi
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '250M',
      time: true
    },
    {
      name: 'otori-price-api',
      script: './api/index.js',
      cwd: '/home/BTCPi/OTORI-Vision/backend', // IMPORTANT: Set correct path
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3033, // Assigned port
        SERVICE_TYPE: 'price', // Optional flag
         // Define URLs needed by Price service (likely local on OrdPi)
        RUNES_API_URL: 'http://localhost:9192',
        OVT_RUNE_SYMBOL: 'OTORI•VISION•TOKEN',
        OVT_RUNE_NAME: 'OTORI•VISION•TOKEN',
        OVT_RUNE_TICKER: 'OVT',
       // ... other vars needed by Price API from .env.ordpi
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '250M',
      time: true
    },
    {
      name: 'otori-validation-api',
      script: './api/index.js',
      cwd: '/home/BTCPi/OTORI-Vision/backend', // IMPORTANT: Set correct path
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3034, // Assigned port
        SERVICE_TYPE: 'validation', // Optional flag
        // Define URLs needed by Validation service (likely local on OrdPi)
         RUNES_API_URL: 'http://localhost:9192',
        OVT_RUNE_SYMBOL: 'OTORI•VISION•TOKEN',
        OVT_RUNE_NAME: 'OTORI•VISION•TOKEN',
        OVT_RUNE_TICKER: 'OVT',
        // ... other vars needed by Validation API from .env.ordpi
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '250M',
      time: true
    }
  ]
}; 