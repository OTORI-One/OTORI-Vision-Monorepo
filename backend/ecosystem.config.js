module.exports = {
  apps: [
    {
      name: 'otori-api',
      script: './api/index.js',
      watch: true,
      env: {
        NODE_ENV: 'development',
        PORT: 3030,
        ORDPI_SSH_PASSWORD: 'Bitcoin is Life',
        LP_ADDRESS: 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
        BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        // BITCOIN_WALLET: 'ovt_runes_wallet', //commented out to use default wallet
        BITCOIN_NETWORK: 'signet',
        OVT_RUNE_ID: '240249:101',
        OVT_TREASURY_ADDRESS: 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
        ORD_PATH: '/usr/local/bin/ord',
        ORD_DATADIR: '/home/BTCPi/.local/share/ord',
        ENABLE_RATE_LIMITING: 'true',
        MAX_REQUESTS_PER_MINUTE: '60',
        DEBUG_MODE: 'false'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3030,
        ORDPI_SSH_PASSWORD: 'Bitcoin is Life',
        LP_ADDRESS: 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
        BITCOIN_CLI_PATH: '/usr/local/bin/bitcoin-cli',
        // BITCOIN_WALLET: 'ovt_runes_wallet', //commented out to use default wallet
        BITCOIN_NETWORK: 'signet',
        OVT_RUNE_ID: '240249:101',
        OVT_TREASURY_ADDRESS: 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
        ORD_PATH: '/usr/local/bin/ord',
        ORD_DATADIR: '/home/BTCPi/.local/share/ord',
        ENABLE_RATE_LIMITING: 'true',
        MAX_REQUESTS_PER_MINUTE: '60',
        DEBUG_MODE: 'false'
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      time: true
    }
  ]
}; 