#!/usr/bin/env node

import { mkdir, writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const chainsPath = join(__dirname, "..", "chains.json");

// 解析浏览器链接获取合约地址和链信息
async function parseExplorerUrl(url) {
  try {
    const domainMap = JSON.parse(await readFile(chainsPath, "utf-8"));
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const pathSegments = urlObj.pathname.split("/").filter(Boolean);

    let chainId = null;
    let contractAddress = null;

    // 特殊处理 Blockscan 格式：vscode.blockscan.com/[chain-name|chain-id]/contractAddress
    if (domain === "vscode.blockscan.com") {
      if (pathSegments.length >= 2) {
        const chainIdentifier = pathSegments[0];
        const possibleAddress = pathSegments[1];

        // 验证第二个参数是合约地址
        if (/^0x[a-fA-F0-9]{40}$/.test(possibleAddress)) {
          contractAddress = possibleAddress;
          // 直接使用 chainIdentifier，无论是 chain name 还是 chain ID
          chainId = chainIdentifier;
        }
      }

      if (!chainId || !contractAddress) {
        throw new Error(
          "Invalid Blockscan URL format. Expected: /[chain-name|chain-id]/contractAddress"
        );
      }
    } else {
      // 普通浏览器格式
      chainId = domainMap[domain];
      if (!chainId) {
        throw new Error(`Unsupported explorer domain: ${domain}`);
      }

      // 提取合约地址 - 支持多种格式
      // 常见格式：
      // /address/0x123...
      // /token/0x123...
      // /contract/0x123...
      // /tx/0x123... (交易页面，但我们要合约地址)
      const addressIndex = pathSegments.findIndex((segment) =>
        ["address", "token", "contract"].includes(segment.toLowerCase())
      );

      if (addressIndex !== -1 && pathSegments[addressIndex + 1]) {
        contractAddress = pathSegments[addressIndex + 1];
      } else {
        // 如果没找到标准格式，尝试查找看起来像地址的片段
        contractAddress = pathSegments.find((segment) =>
          /^0x[a-fA-F0-9]{40}$/.test(segment)
        );
      }

      if (!contractAddress) {
        throw new Error("Contract address not found in URL");
      }
    }

    return {
      contractAddress,
      chainId,
    };
  } catch (error) {
    throw new Error(`Failed to parse explorer URL: ${error.message}`);
  }
}

function parseArgs(args) {
  const chainIndex = args.indexOf("--chain");
  let contract, outputRoot, chain;

  if (chainIndex === -1) {
    // 没有 --chain 参数
    contract = args[0];
    outputRoot = args[1];
    chain = "ethereum";
  } else {
    // 有 --chain 参数
    chain = args[chainIndex + 1];
    const remainingArgs = [
      ...args.slice(0, chainIndex),
      ...args.slice(chainIndex + 2),
    ];
    contract = remainingArgs[0];
    outputRoot = remainingArgs[1];
  }

  return { chain, contract, outputRoot };
}

async function fetchSource(contractAddress, chainOrChainId) {
  const response = await fetch(
    `https://vscode.blockscan.com/srcapi/${chainOrChainId}/${contractAddress}`,
    {
      headers: {
        accept: "application/json",
      },
    }
  );

  const api = await response.json();
  const [source, contractName, ext] = api.proxyAddress
    ? [api.proxyResult, api.proxyContractName, api.proxyExt]
    : [api.result, api.contractName, api.ext];
  try {
    const result = JSON.parse(source);
    return {
      sources: result.sources,
      remappings: result.settings?.remappings,
    };
  } catch (e) {
    return {
      sources: {
        [`${contractName}.${ext}`]: {
          content: source,
        },
      },
    };
  }
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function writeSource(filePath, sourceCode, outputRoot) {
  const fullPath = join(outputRoot, filePath);
  const dir = dirname(fullPath);
  await ensureDir(dir);
  await writeFile(fullPath, sourceCode, "utf8");
  console.log(`Wrote: ${fullPath}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: clone-contract [--chain <chain-name>] <contract> <directory>

Arguments:
  contract            Smart contract address or explorer URL
                      Examples: 0x1234...abcd
                                https://etherscan.io/address/0x1234...abcd
                                https://polygonscan.com/token/0x1234...abcd
                                https://vscode.blockscan.com/1/0x1234...abcd
                                https://vscode.blockscan.com/ethereum/0x1234...abcd
  directory           Directory where the source files will be saved

Options:
  --chain <name|id>   Blockchain network name or chain ID (default: ethereum)
                      Examples: ethereum, bsc, polygon, arbitrum, optimism
                      Or chain IDs: 1, 56, 137, 42161, 10, etc.
                      Note: Ignored when using explorer URL (chain auto-detected)
  --help, -h          Show this help message

Examples:
  clone-contract 0x1234...abcd ./contracts
  clone-contract --chain polygon 0x1234...abcd ./contracts
  clone-contract --chain 137 0x1234...abcd ./contracts
  clone-contract https://etherscan.io/address/0x1234...abcd ./contracts
  clone-contract https://polygonscan.com/token/0x1234...abcd ./contracts
  clone-contract https://vscode.blockscan.com/5000/0x1234...abcd ./contracts
  clone-contract https://vscode.blockscan.com/mantle/0x1234...abcd ./contracts
    `);
    return;
  }

  if (args.length < 2) {
    console.error("Error: Contract and directory are required");
    console.error("Use --help for usage information");
    process.exit(1);
  }

  const { chain, contract, outputRoot } = parseArgs(args);

  let contractAddress, finalChain;

  try {
    // 检查是否为浏览器链接
    if (contract.startsWith("https://") || contract.startsWith("http://")) {
      console.log("Parsing explorer URL...");
      const parsed = await parseExplorerUrl(contract);
      contractAddress = parsed.contractAddress;
      finalChain = parsed.chainId;
      console.log(`Detected Chain: ${parsed.chainId}`);
      console.log(`Contract: ${contractAddress}`);
    } else {
      // 直接使用地址
      contractAddress = contract;
      finalChain = chain;
    }

    console.log(
      `Fetching contract source for ${contractAddress} on ${finalChain}...`
    );

    const { sources, remappings } = await fetchSource(
      contractAddress,
      finalChain
    );

    await Promise.all(
      Object.entries(sources).map(([key, value]) =>
        writeSource(key, value.content, outputRoot)
      )
    );

    if (remappings) {
      const remappingPath = join(outputRoot, "remappings.txt");
      await writeFile(remappingPath, remappings.join("\n"), "utf8");
      console.log(`Wrote: ${remappingPath}`);
    }

    console.log("✅ Contract source code fetched successfully!");
  } catch (error) {
    console.error("❌ Error fetching contract source:", error.message);
    process.exit(1);
  }
}

await main();
