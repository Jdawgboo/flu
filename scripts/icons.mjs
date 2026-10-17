// Renders app/icon.svg to the PNG icons the manifest and iOS need.
// Uses the preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH); never runs playwright install.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile(new URL('../app/icon.svg', import.meta.url), 'utf8');
// Full-bleed square so maskable crops and iOS rounding both look right.
const square = svg.replace(/ rx="112"/, '');
const sizes = [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${square.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL('../app/icons/' + name, import.meta.url).pathname, omitBackground: true });
  console.log('wrote app/icons/' + name);
}
await browser.close();
