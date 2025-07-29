# clone-contract

A command-line tool to fetch smart contract source code from various blockchain networks.

## Installation

### Global Installation
```bash
npm install -g clone-contract
```

### Local Installation
```bash
npm install clone-contract
```
### Run without Installation
```bash
npx clone-contract ...
```


## Usage

### Command Line Interface

```bash
clone-contract [--chain <name|id>] <contract> [directory]
```

### Arguments

- `contract`: Smart contract address or blockchain explorer URL
  - Address format: `0x1234...abcd`
  - Explorer URL format: `https://etherscan.io/address/0x1234...abcd`
  - Blockscan format: `https://vscode.blockscan.com/chainId/0x1234...abcd` or `https://vscode.blockscan.com/chainName/0x1234...abcd`
- `directory`: Directory where the source files will be saved (default: `./{contractName}`)

### Options

- `--chain <name|id>`: Blockchain network name or chain ID (default: ethereum)
  - Supported networks: ethereum, bsc, polygon, arbitrum, optimism, fantom, avalanche, and more
  - Also supports chain IDs: 1 (ethereum), 56 (bsc), 137 (polygon), 42161 (arbitrum), 10 (optimism), etc.
  - **Note**: This parameter is ignored when using explorer URLs (chain is auto-detected)
- `--help, -h`: Show help message

### Examples

```bash
# Fetch to auto-generated directory (./ContractName)
clone-contract 0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c

# Fetch to specific directory
clone-contract 0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c ./contracts

# Use specific chain
clone-contract --chain polygon 0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c
clone-contract --chain 137 0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c ./contracts

# Use explorer URLs (auto-detects chain)
clone-contract https://etherscan.io/address/0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c
clone-contract https://polygonscan.com/token/0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c ./contracts

# Use Blockscan URLs
clone-contract https://vscode.blockscan.com/5000/0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c
clone-contract https://vscode.blockscan.com/mantle/0xA0b86a33E6441a9C7e0a4F7e1c8b9b8c6a1c1c1c ./contracts
```

## Features

- ✅ Supports multiple blockchain networks (560+ chains)
- ✅ **Auto-detects chain from explorer URLs** 
- ✅ Supports both contract addresses and explorer URLs
- ✅ **Supports Blockscan URLs with chain ID or chain name**
- ✅ Automatically handles proxy contracts
- ✅ Downloads all source files and dependencies
- ✅ Preserves directory structure
- ✅ Includes Solidity remappings when available
- ✅ Easy-to-use command-line interface
- ✅ Built from viem/chains data for accuracy

## Supported Networks

### Mainnet
- Ethereum (`ethereum` or `1`)
- Binance Smart Chain (`bsc` or `56`)
- Polygon (`polygon` or `137`)
- Arbitrum One (`arbitrum` or `42161`)
- Optimism (`optimism` or `10`)
- Fantom (`fantom` or `250`)
- Avalanche (`avalanche` or `43114`)
- Base (`base` or `8453`)
- Arbitrum Nova (`42170`)
- Moonbeam (`1284`)
- Cronos (`25`)
- zkSync Era (`324`)
- Linea (`59144`)
- Scroll (`534352`)
- opBNB (`204`)
- Blast (`81457`)
- Mantle (`5000`)
- And many more...

### Testnet
- Sepolia (`11155111`)
- Holesky (`17000`)
- BSC Testnet (`97`)
- Polygon Amoy (`80002`)
- Arbitrum Sepolia (`421614`)
- Base Sepolia (`84532`)
- And many more...

For a complete list of supported networks, visit [Blockscan](https://vscode.blockscan.com/).

## Output

The tool will create the specified output directory and save:

- All contract source files with their original directory structure
- `remappings.txt` file (if remappings are available)

## Requirements

- Node.js >= 20.0.0

## License

MIT 