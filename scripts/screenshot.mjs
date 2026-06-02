// 截图脚本：截取浮窗的四种状态
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = 'http://127.0.0.1:5180/';
const OUT = 'D:/AISoftware/Voice2Text/screenshots';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  page.on('pageerror', (err) => console.log('[PAGE ERROR]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[CONSOLE ERR]', msg.text());
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // 桌面背景
  await page.evaluate(() => {
    document.body.style.background =
      'linear-gradient(135deg, #E0E7FF 0%, #F0E7FF 50%, #FFE7F0 100%)';
  });
  await page.waitForTimeout(200);

  // 1: idle
  await page.screenshot({ path: `${OUT}/01-idle.png` });
  console.log('✓ 01-idle.png');

  // 2: recording
  await page.evaluate(() => {
    const bubble = document.querySelector('.cursor-pointer');
    if (bubble) bubble.click();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02-recording.png` });
  console.log('✓ 02-recording.png');

  // 3: processing - 先点开右上角 demo 切换器
  await page.evaluate(() => {
    const gear = Array.from(document.querySelectorAll('button')).find(
      (b) => b.title?.includes('M1')
    );
    if (gear) gear.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'processing'
    );
    if (target) target.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/03-processing.png` });
  console.log('✓ 03-processing.png');

  // 4: preview
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'preview'
    );
    if (target) target.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-preview.png` });
  console.log('✓ 04-preview.png');

  await browser.close();
  console.log('\n所有截图已保存到', OUT);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
