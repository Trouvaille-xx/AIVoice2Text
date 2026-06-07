/**
 * 下载 whisper.cpp 引擎 (whisper-cli.exe) 到项目 bin/ 目录
 *
 * 国内走 gh-proxy.com 镜像（GitHub release 国内常被墙）；
 * 找不到镜像时回落到 GitHub 官方 release。
 *
 * 用法:
 *   node scripts/download-engine.mjs                 # 默认下载 v1.7.4
 *   node scripts/download-engine.mjs --version=v1.7.5
 *   node scripts/download-engine.mjs --direct        # 强制走 GitHub 官方
 *
 * 产出:
 *   bin/whisper-cli.exe
 */

import { createWriteStream, existsSync, mkdirSync, statSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BIN_DIR = join(ROOT, 'bin');
const EXE_PATH = join(BIN_DIR, 'whisper-cli.exe');

// ---- 参数解析 ----
const args = process.argv.slice(2);
const version = (args.find(a => a.startsWith('--version='))?.split('=')[1]) || 'v1.8.6';
const forceDirect = args.includes('--direct');

// ---- URL 候选 ----
const OFFICIAL = `https://github.com/ggml-org/whisper.cpp/releases/download/${version}/whisper-bin-x64.zip`;
const MIRRORS = [
  // gh-proxy 镜像（国内常用）
  `https://gh-proxy.com/${OFFICIAL}`,
  // cnpmjs 备用
  `https://ghproxy.cc/${OFFICIAL}`,
];
const URLS = forceDirect ? [OFFICIAL] : [...MIRRORS, OFFICIAL];

// ---- 工具：跟随重定向下载到文件 ----
function downloadToFile(urlStr, outPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { return reject(new Error(`Invalid URL: ${urlStr}`)); }
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.get(urlStr, { headers: { 'User-Agent': 'voiceflow-downloader' } }, (res) => {
      // 跟随重定向
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const next = res.headers.location;
        res.resume();
        if (!next) return reject(new Error(`Redirect with no location from ${urlStr}`));
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects from ${urlStr}`));
        // 相对路径重定向
        const nextUrl = new URL(next, url).toString();
        return downloadToFile(nextUrl, outPath, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${urlStr}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const file = createWriteStream(outPath);
      let received = 0;
      let lastPct = -1;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.round((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            process.stdout.write(`\r  ${pct}% (${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`);
            lastPct = pct;
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        process.stdout.write('\n');
        resolve();
      });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error(`Timeout: ${urlStr}`));
    });
  });
}

function unzip(zipPath, outDir) {
  // Windows 自带 PowerShell + Expand-Archive
  const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force"`;
  console.log(`  unzip → ${outDir}`);
  execSync(cmd, { stdio: 'inherit', timeout: 60000 });
}

async function tryDownload(zipPath) {
  let lastErr;
  for (const url of URLS) {
    process.stdout.write(`  trying ${url}\n`);
    try {
      await downloadToFile(url, zipPath);
      const size = statSync(zipPath).size;
      if (size < 1024 * 1024) {
        // 太小说明可能是 HTML 错误页
        throw new Error(`Downloaded file too small (${size} bytes), probably an error page`);
      }
      console.log(`  ✓ ok (${(size / 1024 / 1024).toFixed(1)} MB)`);
      return url;
    } catch (e) {
      lastErr = e;
      console.log(`  ✗ ${e.message}`);
      // 清理半成品
      try { if (existsSync(zipPath)) rmSync(zipPath); } catch {}
    }
  }
  throw lastErr || new Error('All download sources failed');
}

async function main() {
  if (existsSync(EXE_PATH)) {
    const size = statSync(EXE_PATH).size;
    console.log(`✓ bin/whisper-cli.exe already exists (${(size / 1024 / 1024).toFixed(1)} MB), skip`);
    console.log('  delete it and re-run to force download');
    return;
  }
  if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });

  const zipPath = join(BIN_DIR, 'whisper-cli.zip');
  console.log(`Downloading whisper.cpp ${version} (Windows x64)...`);
  const usedUrl = await tryDownload(zipPath);
  console.log(`From: ${usedUrl}`);

  unzip(zipPath, BIN_DIR);
  try { rmSync(zipPath); } catch {}

  if (!existsSync(EXE_PATH)) {
    // zip 里通常带 Release/ 前缀目录，递归找出 exe
    // 优先匹配 whisper-cli.exe（v1.7+），其次 main.exe（旧版本）
    const walk = (dir) => {
      let fallback = null;
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        if (statSync(full).isDirectory()) {
          const found = walk(full);
          if (found && found.endsWith('whisper-cli.exe')) return found;
          if (!fallback) fallback = found;
        } else if (f === 'whisper-cli.exe') {
          return full;
        } else if (f === 'main.exe' && !fallback) {
          fallback = full;
        }
      }
      return fallback;
    };
    const found = walk(BIN_DIR);
    if (found) {
      console.log(`  moving ${found} → ${EXE_PATH}`);
      renameSync(found, EXE_PATH);
    } else {
      throw new Error('Unzipped but whisper-cli.exe not found');
    }
  }

  // 把运行时需要的 DLL 也复制到 bin/ 根目录（与 exe 同目录才能被加载）
  const REQUIRED_DLLS = ['whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'];
  for (const dll of REQUIRED_DLLS) {
    const found = (() => {
      const walk = (dir) => {
        for (const f of readdirSync(dir)) {
          const full = join(dir, f);
          if (statSync(full).isDirectory()) {
            const r = walk(full);
            if (r) return r;
          } else if (f === dll) {
            return full;
          }
        }
        return null;
      };
      return walk(BIN_DIR);
    })();
    if (found) {
      const dest = join(BIN_DIR, dll);
      if (!existsSync(dest)) {
        console.log(`  copying ${found} → ${dest}`);
        renameSync(found, dest);
      }
    } else {
      console.warn(`  ⚠ ${dll} not found in archive`);
    }
  }

  const finalSize = statSync(EXE_PATH).size;
  console.log(`\n✓ Done: bin/whisper-cli.exe (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(`\n✗ Failed: ${e.message}`);
  process.exit(1);
});
