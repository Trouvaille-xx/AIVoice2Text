/**
 * 生成应用图标 (icon.png 256x256, tray.png 32x32)
 * 使用 Playwright 渲染 SVG → PNG
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
mkdirSync(buildDir, { recursive: true });

const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 1024 1024" fill="none">
  <g transform="translate(512 512) scale(1.1) translate(-512 -512)">
    <path d="M158 360C158 320.8 189.8 289 229 289C268.2 289 300 320.8 300 360V664C300 703.2 268.2 735 229 735C189.8 735 158 703.2 158 664V360Z" fill="#2F80ED"/>
    <path d="M342 172C342 131.7 374.7 99 415 99C455.3 99 488 131.7 488 172V852C488 892.3 455.3 925 415 925C374.7 925 342 892.3 342 852V172Z" fill="#16C7B0"/>
    <path d="M536 268C536 228.8 567.8 197 607 197C646.2 197 678 228.8 678 268V756C678 795.2 646.2 827 607 827C567.8 827 536 795.2 536 756V268Z" fill="#8B5CF6"/>
    <path d="M826 202L861 319L970 354L861 389L826 506L791 389L682 354L791 319L826 202Z" fill="#FFB020"/>
  </g>
</svg>`;

const trayIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <g transform="translate(16 16) scale(1.08) translate(-16 -16)">
    <rect x="6" y="10" width="4" height="10" rx="2" fill="#2F80ED"/>
    <rect x="11" y="5" width="4" height="20" rx="2" fill="#16C7B0"/>
    <rect x="16" y="9" width="4" height="12" rx="2" fill="#8B5CF6"/>
  </g>
</svg>`;

async function main() {
  const browser = await chromium.launch({ headless: true });

  // App icon 256x256
  const page256 = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page256.setContent(`<html><body style="margin:0;width:256px;height:256px">${appIconSvg}</body></html>`);
  await page256.screenshot({ path: join(buildDir, 'icon.png'), type: 'png', omitBackground: true });
  console.log('icon.png (256x256)');
  await page256.close();

  // Tray icon 32x32
  const page32 = await browser.newPage({ viewport: { width: 32, height: 32 } });
  await page32.setContent(`<html><body style="margin:0;width:32px;height:32px">${trayIconSvg}</body></html>`);
  await page32.screenshot({ path: join(buildDir, 'tray.png'), omitBackground: false });
  console.log('tray.png (32x32)');
  await page32.close();

  // Tray icon 16x16
  const page16 = await browser.newPage({ viewport: { width: 16, height: 16 } });
  await page16.setContent(`<html><body style="margin:0;width:16px;height:16px">${trayIconSvg}</body></html>`);
  await page16.screenshot({ path: join(buildDir, 'tray-16.png'), omitBackground: false });
  console.log('tray-16.png (16x16)');
  await page16.close();

  await browser.close();

  // 生成 ICO（Windows 需要 ico 格式用于 exe 图标和任务栏）
  const icon256 = readFileSync(join(buildDir, 'icon.png'));
  const icoBuf = await pngToIco([icon256]);
  writeFileSync(join(buildDir, 'icon.ico'), icoBuf);
  console.log('icon.ico');

  console.log('Done!');
}

main().catch((e) => { console.error(e); process.exit(1); });
