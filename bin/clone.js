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
  const mergeIndex = Math.max(args.indexOf("-m"), args.indexOf("--merge"));
  let contract,
    outputRoot,
    chain,
    merge = false;

  // 处理 merge 参数
  if (mergeIndex !== -1) {
    merge = true;
    args = args.filter((_, index) => index !== mergeIndex);
  }

  // 重新计算 chainIndex（因为可能移除了 merge 参数）
  const updatedChainIndex = args.indexOf("--chain");

  if (updatedChainIndex === -1) {
    contract = args[0];
    outputRoot = args[1]; // 可选，如果不提供则后面根据 contractName 生成
  } else {
    chain = args[updatedChainIndex + 1];
    const remainingArgs = [
      ...args.slice(0, updatedChainIndex),
      ...args.slice(updatedChainIndex + 2),
    ];
    contract = remainingArgs[0];
    outputRoot = remainingArgs[1]; // 可选，如果不提供则后面根据 contractName 生成
  }
  const parsed = await tryParseExplorerUrl(contract);
  contract = parsed.contractAddress;
  chain = chain || parsed.chainId || "ethereum";

  return { chain, contract, outputRoot, merge };
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
        `❌ Error: Directory '${outputRoot}' is not empty. Please use an empty directory or use --merge flag.`
      );
      process.exit(1);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeSourceWithMerge(filePath, sourceCode, outputRoot) {
  const fullPath = join(outputRoot, filePath);
  await ensureDir(dirname(fullPath));

  const generateFileName = (counter) => {
    if (counter === 0) return fullPath;

    const baseName = fullPath.replace(/\.[^/.]+$/, "");
    const extension = fullPath.match(/\.[^/.]+$/)?.[0] || "";
    return `${baseName}.conflict${counter}${extension}`;
  };

  const tryWriteFile = async (counter = 0) => {
    if (counter > 1000) throw new Error("Too many conflicts");

    const targetPath = generateFileName(counter);

    try {
      await writeFile(targetPath, sourceCode, { encoding: "utf8", flag: "wx" });

      if (counter === 0) {
        console.log(`Wrote: ${targetPath}`);
      } else {
        console.log(`⚠️  Warning: File conflict detected for ${fullPath}`);
        console.log(`    Saved new content as: ${targetPath}`);
      }

      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      if (counter === 0) {
        const existingContent = await readFile(targetPath, "utf8");
        if (existingContent === sourceCode) {
          console.log(`Skipped: ${targetPath} (identical content)`);
          return;
        }
      }

      await tryWriteFile(counter + 1);
    }
  };

  await tryWriteFile();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: clone-contract [options] <contract> [directory]

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
  -m, --merge         Allow merging into non-empty directories
                      - Skip files with identical content
                      - Save conflicting files with .conflict suffix
                      - Show warnings for conflicts
  --help, -h          Show this help message

Examples:
  clone-contract 0x1234...abcd                                    # Save to ./ContractName
  clone-contract 0x1234...abcd ./contracts                        # Save to ./contracts
  clone-contract --chain polygon 0x1234...abcd                    # Use polygon chain
  clone-contract --chain 137 0x1234...abcd ./contracts            # Use chain ID 137
  clone-contract -m 0x1234...abcd ./existing-dir                  # Merge into existing directory
  clone-contract https://etherscan.io/address/0x1234...abcd       # From Etherscan URL
  clone-contract https://vscode.blockscan.com/5000/0x1234...abcd  # From Blockscan URL
    `);
    return;
  }

  const {
    chain,
    contract,
    outputRoot: providedOutputRoot,
    merge,
  } = await parseArgs(args);

  console.log(`Fetching contract source for ${contract} on ${chain}...`);

  try {
    const { sources, remappings, contractName } = await fetchSource(
      contract,
      chain
    );

    // 如果没有指定输出目录，使用当前目录 + contractName
    const outputRoot =
      providedOutputRoot ||
      `./${contractName || `Contract_${contract.slice(0, 8)}`}`;

    if (!merge) {
      await checkOutputDirectory(outputRoot);
    }

    await Promise.all(
      Object.entries(sources).map(([key, value]) =>
        writeSourceWithMerge(key, value.content, outputRoot)
      )
    );

    if (remappings) {
      const remappingContent = remappings.join("\n");
      await writeSourceWithMerge(
        "remappings.txt",
        remappingContent,
        outputRoot
      );
    }

    console.log("✅ Contract source code fetched successfully!");
  } catch (error) {
    console.error("❌ Error fetching contract source:", error);
    process.exit(1);
  }
}

await main();
