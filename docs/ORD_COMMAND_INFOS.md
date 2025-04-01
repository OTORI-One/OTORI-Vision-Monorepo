# Actual Command Syntax

Based on the actual `--help` output for ord commands:

```bash
# Mint a rune
ord wallet mint --fee-rate <FEE_RATE> --rune <RUNE> [--postage <POSTAGE>] [--destination <DESTINATION>]

# Create an inscription
ord wallet inscribe --fee-rate <FEE_RATE> --file <FILE> [--destination <DESTINATION>] [--dry-run]

# Batch create inscriptions and runes
ord wallet batch --fee-rate <FEE_RATE> --batch <BATCH_FILE> [--dry-run]

# Send Runes to an address
```bash
ord wallet send --rune <RUNE> --destination <DESTINATION>
```
# Example: send 999900 OVT to an LP  address with dry-run

```bash
ord --config ~/.ord/ord.yaml --signet wallet send --fee-rate 1 --sender tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3 tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f "999900:OTORI•VISION•TOKEN" --dry-run
```

### Full and actual 'ord' command syntax

````bash
Usage: ord [OPTIONS] <COMMAND>

Commands:
  balances  List all rune balances
  decode    Decode a transaction
  env       Start a regtest ord and bitcoind instance
  epochs    List the first satoshis of each reward epoch
  find      Find a satoshi's current location
  index     Index commands
  list      List the satoshis in an output
  parse     Parse a satoshi from ordinal notation
  runes     List all runes
  server    Run the explorer server
  settings  Display settings
  subsidy   Display information about a block's subsidy
  supply    Display Bitcoin supply information
  teleburn  Generate teleburn addresses
  traits    Display satoshi traits
  verify    Verify BIP322 signature
  wallet    Wallet commands
  wallets   List all Bitcoin Core wallets
  help      Print this message or the help of the given subcommand(s)

Options:
      --bitcoin-data-dir <BITCOIN_DATA_DIR>
          Load Bitcoin Core data dir from <BITCOIN_DATA_DIR>.
      --bitcoin-rpc-password <BITCOIN_RPC_PASSWORD>
          Authenticate to Bitcoin Core RPC with <BITCOIN_RPC_PASSWORD>.
      --bitcoin-rpc-url <BITCOIN_RPC_URL>
          Connect to Bitcoin Core RPC at <BITCOIN_RPC_URL>.
      --bitcoin-rpc-username <BITCOIN_RPC_USERNAME>
          Authenticate to Bitcoin Core RPC as <BITCOIN_RPC_USERNAME>.
      --bitcoin-rpc-limit <BITCOIN_RPC_LIMIT>
          Max <N> requests in flight. [default: 12]
      --chain <CHAIN_ARGUMENT>
          Use <CHAIN>. [default: mainnet] [possible values: mainnet, regtest, signet, testnet, testnet4]
      --commit-interval <COMMIT_INTERVAL>
          Commit to index every <COMMIT_INTERVAL> blocks. [default: 5000]
      --savepoint-interval <SAVEPOINT_INTERVAL>
          Create a savepoint every <SAVEPOINT_INTERVAL> blocks. [default: 10]
      --max-savepoints <MAX_SAVEPOINTS>
          Store maximum <MAX_SAVEPOINTS> blocks. [default: 2]
      --config <CONFIG>
          Load configuration from <CONFIG>.
      --config-dir <CONFIG_DIR>
          Load configuration from <CONFIG_DIR>.
      --cookie-file <COOKIE_FILE>
          Load Bitcoin Core RPC cookie file from <COOKIE_FILE>.
      --data-dir <DATA_DIR>
          Store index in <DATA_DIR>.
      --height-limit <HEIGHT_LIMIT>
          Limit index to <HEIGHT_LIMIT> blocks.
      --index <INDEX>
          Use index at <INDEX>.
      --index-addresses
          Track unspent output addresses.
      --index-cache-size <INDEX_CACHE_SIZE>
          Set index cache size to <INDEX_CACHE_SIZE> bytes. [default: 1/4 available RAM]
      --index-runes
          Track location of runes.
      --index-sats
          Track location of all satoshis.
      --index-transactions
          Store transactions in index.
      --integration-test
          Run in integration test mode.
  -f, --format <FORMAT>
          Specify output format. [default: json] [possible values: json, yaml, minify]
  -n, --no-index-inscriptions
          Do not index inscriptions.
      --server-password <SERVER_PASSWORD>
          Require basic HTTP authentication with <SERVER_PASSWORD>. Credentials are sent in cleartext. Consider using authentication in conjunction with HTTPS.
      --server-username <SERVER_USERNAME>
          Require basic HTTP authentication with <SERVER_USERNAME>. Credentials are sent in cleartext. Consider using authentication in conjunction with HTTPS.
  -r, --regtest
          Use regtest. Equivalent to `--chain regtest`.
  -s, --signet
          Use signet. Equivalent to `--chain signet`.
  -t, --testnet
          Use testnet. Equivalent to `--chain testnet`.
      --testnet4
          Use testnet4. Equivalent to `--chain testnet4`.
  -h, --help
          Print help
  -V, --version
          Print version
````

## Full 'wallet' command syntax
```bash
Wallet commands

Usage: ord wallet [OPTIONS] <COMMAND>

Commands:
  addresses     Get wallet addresses
  balance       Get wallet balance
  batch         Create inscriptions and runes
  burn          Burn an inscription
  cardinals     List unspent cardinal outputs in wallet
  create        Create new wallet
  dump          Dump wallet descriptors
  inscribe      Create inscription
  inscriptions  List wallet inscriptions
  label         Export output labels
  mint          Mint a rune
  offer         Offer commands
  outputs       List all unspent outputs in wallet
  pending       List pending etchings
  receive       Generate receive address
  restore       Restore wallet
  resume        Resume pending etchings
  runics        List unspent runic outputs in wallet
  sats          List wallet satoshis
  send          Send sat or inscription
  sign          Sign message
  split         Split outputs
  transactions  See wallet transactions
  help          Print this message or the help of the given subcommand(s)

Options:
      --name <NAME>              Use wallet named <WALLET>. [default: ord]
      --no-sync                  Do not update index.
      --server-url <SERVER_URL>  Use ord running at <SERVER_URL>. [default: http://localhost:80]

```

## Full 'wallet inscribe' command syntax
```bash
Create inscription

Usage: ord wallet inscribe [OPTIONS] --fee-rate <FEE_RATE> <--delegate <DELEGATE>|--file <FILE>>

Options:
      --commit-fee-rate <COMMIT_FEE_RATE>
          Use <COMMIT_FEE_RATE> sats/vbyte for commit transaction.
          Defaults to <FEE_RATE> if unset.
      --compress
          Compress inscription content with brotli.
      --fee-rate <FEE_RATE>
          Use fee rate of <FEE_RATE> sats/vB.
      --dry-run
          Don't sign or broadcast transactions.
      --no-backup
          Do not back up recovery key.
      --no-limit
          Allow transactions larger than MAX_STANDARD_TX_WEIGHT of 400,000 weight units and OP_RETURNs greater than 83 bytes. Transactions over this limit are nonstandard and will not be relayed by bitcoind in its default configuration. Do not use this flag unless you understand the implications.
      --cbor-metadata <CBOR_METADATA>
          Include CBOR in file at <METADATA> as inscription metadata
      --delegate <DELEGATE>
          Delegate inscription content to <DELEGATE>.
      --destination <DESTINATION>
          Send inscription to <DESTINATION>.
      --file <FILE>
          Inscribe sat with contents of <FILE>. May be omitted if `--delegate` is supplied.
      --json-metadata <JSON_METADATA>
          Include JSON in file at <METADATA> converted to CBOR as inscription metadata
      --metaprotocol <METAPROTOCOL>
          Set inscription metaprotocol to <METAPROTOCOL>.
      --parent <PARENT>
          Make inscription a child of <PARENT>.
      --postage <AMOUNT>
          Include <AMOUNT> postage with inscription. [default: 10000sat]
      --reinscribe
          Allow reinscription.
      --sat <SAT>
          Inscribe <SAT>.
      --satpoint <SATPOINT>
          Inscribe <SATPOINT>.
      --gallery <INSCRIPTION_ID>
          Include <INSCRIPTION_ID> in gallery.
  -h, --help
          Print help
```

## Full 'wallet batch' command syntax

````bash
Create inscriptions and runes

Usage: ord wallet batch [OPTIONS] --fee-rate <FEE_RATE> --batch <BATCH_FILE>

Options:
      --commit-fee-rate <COMMIT_FEE_RATE>
          Use <COMMIT_FEE_RATE> sats/vbyte for commit transaction.
          Defaults to <FEE_RATE> if unset.
      --compress
          Compress inscription content with brotli.
      --fee-rate <FEE_RATE>
          Use fee rate of <FEE_RATE> sats/vB.
      --dry-run
          Don't sign or broadcast transactions.
      --no-backup
          Do not back up recovery key.
      --no-limit
          Allow transactions larger than MAX_STANDARD_TX_WEIGHT of 400,000 weight units and OP_RETURNs greater than 83 bytes. Transactions over this limit are nonstandard and will not be relayed by bitcoind in its default configuration. Do not use this flag unless you understand the implications.
      --batch <BATCH_FILE>
          Inscribe multiple inscriptions and rune defined in YAML <BATCH_FILE>.
  -h, --help
          Print help
````

## Full 'wallet mint' command syntax
````bash
Mint a rune

Usage: ord wallet mint [OPTIONS] --fee-rate <FEE_RATE> --rune <RUNE>

Options:
      --fee-rate <FEE_RATE>        Use <FEE_RATE> sats/vbyte for mint transaction.
      --rune <RUNE>                Mint <RUNE>. May contain `.` or `•`as spacers.
      --postage <POSTAGE>          Include <AMOUNT> postage with mint output. [default: 10000sat]
      --destination <DESTINATION>  Send minted runes to <DESTINATION>.
  -h, --help                       Print help
````

# Batch Inscribing
================

Multiple inscriptions can be created at the same time using the
[pointer field](./../inscriptions/pointer.md). This is especially helpful for
collections, or other cases when multiple inscriptions should share the same
parent, since the parent can passed into a reveal transaction that creates
multiple children.

To create a batch inscription using a batchfile in `batch.yaml`, run the
following command:

```bash
ord wallet batch --fee-rate 21 --batch batch.yaml
```

Example `batch.yaml`
--------------------

```yaml
{{#include ../../../batch.yaml}}
```
# example batch file
```yml

# inscription modes:
# - `same-sat`: inscribe on the same sat
# - `satpoints`: inscribe on the first sat of specified satpoint's output
# - `separate-outputs`: inscribe on separate postage-sized outputs
# - `shared-output`: inscribe on a single output separated by postage
mode: separate-outputs

# parent inscriptions:
parents:
- 6ac5cacb768794f4fd7a78bf00f2074891fce68bd65c4ff36e77177237aacacai0

# postage for each inscription:
postage: 12345

# allow reinscribing
reinscribe: true

# sat to inscribe on, can only be used with `same-sat`:
# sat: 5000000000

# rune to etch (optional)
etching:
  # rune name
  rune: THE•BEST•RUNE
  # allow subdividing super-unit into `10^divisibility` sub-units
  divisibility: 2
  # premine
  premine: 1000.00
  # total supply, must be equal to `premine + terms.cap * terms.amount`
  supply: 10000.00
  # currency symbol
  symbol: $
  # mint terms (optional)
  terms:
    # amount per mint
    amount: 100.00
    # maximum number of mints
    cap: 90
    # mint start and end absolute block height (optional)
    height:
      start: 840000
      end: 850000
    # mint start and end block height relative to etching height (optional)
    offset:
      start: 1000
      end: 9000
  # future runes protocol changes may be opt-in. this may be for a variety of
  # reasons, including that they make light client validation harder, or simply
  # because they are too degenerate.
  #
  # setting `turbo` to `true` opts in to these future protocol changes,
  # whatever they may be.
  turbo: true

# inscriptions to inscribe
inscriptions:
  # path to inscription content
- file: mango.avif
  # inscription to delegate content to (optional)
  delegate: 6ac5cacb768794f4fd7a78bf00f2074891fce68bd65c4ff36e77177237aacacai0
  # destination (optional, if no destination is specified a new wallet change address will be used)
  destination: bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4
  # inscription metadata (optional)
  metadata:
    title: Delicious Mangos
    description: >
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aliquam semper,
      ligula ornare laoreet tincidunt, odio nisi euismod tortor, vel blandit
      metus est et odio. Nullam venenatis, urna et molestie vestibulum, orci
      mi efficitur risus, eu malesuada diam lorem sed velit. Nam fermentum
      dolor et luctus euismod.

- file: token.json
  # inscription metaprotocol (optional)
  metaprotocol: DOPEPROTOCOL-42069

- file: tulip.png
  destination: bc1pdqrcrxa8vx6gy75mfdfj84puhxffh4fq46h3gkp6jxdd0vjcsdyspfxcv6
  metadata:
    author: Satoshi Nakamoto

- file: gallery.png
  # gallery items
  gallery:
  - a4676e57277b70171d69dc6ad2781485b491fe0ff5870f6f6b01999e7180b29ei0
  - a4676e57277b70171d69dc6ad2781485b491fe0ff5870f6f6b01999e7180b29ei3
  ```
  