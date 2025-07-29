#!/usr/bin/env node

import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const chainsPath = join(__dirname, "..", "chains.json");

// 解析浏览器链接获取合约地址和链信息
async function tryParseExplorerUrl(url) {
  try {
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
        }
        chainId = chainIdentifier;
      }

      if (!chainId || !contractAddress) {
        throw new Error(
          "Invalid Blockscan URL format. Expected: /[chain-name|chain-id]/contractAddress"
        );
      }

      return {
        contractAddress,
        chainId,
      };
    }

    const domainMap = JSON.parse(await readFile(chainsPath, "utf-8"));

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

    console.log(`Detected Chain: ${chainId}`);
    console.log(`Contract: ${contractAddress}`);

    return {
      contractAddress,
      chainId,
    };
  } catch (error) {
    if (error.code === "ERR_INVALID_URL") {
      return {
        contractAddress: url,
      };
    }
    throw new Error(`Failed to parse explorer URL: ${error.message}`);
  }
}

async function parseArgs(args) {
  const chainIndex = args.indexOf("--chain");
  let contract, outputRoot, chain;

  if (chainIndex === -1) {
    contract = args[0];
    outputRoot = args[1]; // 可选，如果不提供则后面根据 contractName 生成
  } else {
    chain = args[chainIndex + 1];
    const remainingArgs = [
      ...args.slice(0, chainIndex),
      ...args.slice(chainIndex + 2),
    ];
    contract = remainingArgs[0];
    outputRoot = remainingArgs[1]; // 可选，如果不提供则后面根据 contractName 生成
  }
  const parsed = await tryParseExplorerUrl(contract);
  contract = parsed.contractAddress;
  chain = chain || parsed.chainId || "ethereum";

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

  if (!source) throw new Error("No source found");

  try {
    const result = JSON.parse(source);
    return {
      contractName,
      sources: result.sources,
      remappings: result.settings?.remappings,
    };
  } catch (e) {
    return {
      contractName,
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

async function checkOutputDirectory(outputRoot) {
  try {
    const files = await readdir(outputRoot);
    if (files.length > 0) {
      console.error(
        `❌ Error: Directory '${outputRoot}' is not empty. Please use an empty directory.`
      );
      process.exit(1);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
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

  if (args.length < 1 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: clone-contract [--chain <chain-name>] <contract> [directory]

Arguments:
  contract            Smart contract address or explorer URL
                      Examples: 0x1234...abcd
                                https://etherscan.io/address/0x1234...abcd
                                https://polygonscan.com/token/0x1234...abcd
                                https://vscode.blockscan.com/1/0x1234...abcd
                                https://vscode.blockscan.com/ethereum/0x1234...abcd
  directory           Directory where the source files will be saved (default: ./{contractName})

Options:
  --chain <name|id>   Blockchain network name or chain ID (default: ethereum)
                      Examples: ethereum, bsc, polygon, arbitrum, optimism
                      Or chain IDs: 1, 56, 137, 42161, 10, etc.
                      Note: Ignored when using explorer URL (chain auto-detected)
  --help, -h          Show this help message

Examples:
  clone-contract 0x1234...abcd                                    # Save to ./ContractName
  clone-contract 0x1234...abcd ./contracts                        # Save to ./contracts
  clone-contract --chain polygon 0x1234...abcd                    # Use polygon chain
  clone-contract --chain 137 0x1234...abcd ./contracts            # Use chain ID 137
  clone-contract https://etherscan.io/address/0x1234...abcd       # From Etherscan URL
  clone-contract https://vscode.blockscan.com/5000/0x1234...abcd  # From Blockscan URL
    `);
    return;
  }

  const {
    chain,
    contract,
    outputRoot: providedOutputRoot,
  } = await parseArgs(args);

  console.log(`Fetching contract source for ${contract} on ${chain}...`);

  try {
    const { sources, remappings, contractName } = await fetchSource(
      contract,
      chain
    );

    // 如果没有指定输出目录，使用当前目录 + contractName
    const outputRoot = providedOutputRoot || join(process.cwd(), contractName);

    await checkOutputDirectory(outputRoot);

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
