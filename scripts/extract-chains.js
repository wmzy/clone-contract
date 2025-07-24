#!/usr/bin/env node

import { writeFile } from "fs/promises";
import * as allChains from "viem/chains";

async function extractChainInfo() {
  const domainMap = {};
  let processed = 0;

  // 遍历所有导出的链
  for (const [exportName, chain] of Object.entries(allChains)) {
    try {
      // 跳过非链对象（如类型定义等）
      if (!chain || typeof chain !== 'object' || !chain.id || !chain.name) {
        continue;
      }

      const { id: chainId, blockExplorers } = chain;

      // 检查是否有默认的区块浏览器
      if (!blockExplorers?.default?.url) {
        continue;
      }

      const explorerUrl = blockExplorers.default.url;
      
      try {
        const domain = new URL(explorerUrl).hostname;
        
        // 只存储域名到 chainId 的映射，去掉冗余信息
        domainMap[domain] = chainId;
        
        console.log(`Extracted: ${chain.name} (${chainId}) -> ${domain}`);
        processed++;
      } catch {
        // 跳过无效的 URL
        continue;
      }
    } catch (error) {
      console.warn(`Failed to process chain ${exportName}:`, error.message);
    }
  }

  // 只保留域名到 chainId 的映射
  await writeFile("chains.json", JSON.stringify(domainMap, null, 2));
  console.log(
    `\n✅ Extracted ${processed} chains to chains.json`
  );
}

await extractChainInfo();
